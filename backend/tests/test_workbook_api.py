"""One workbook, both halves, reviewed before anything is written.

The Reference sheet and the student tabs were two uploads and are one, because they were
always one document. These tests are about the two things that used to happen silently: a
CRN being rewritten, and a student being moved between groups.
"""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import student_database as api
from sorbonne.main import app
from sorbonne.services.student_database import StudentDatabase
from tests.conftest import TEST_DATABASE_URL

SPREADSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TERM = "term-1"
WORKBOOK = (
    "/Users/chriscay/Documents/scen-student-platform/sample-data/group-templates/"
    "FYS-Groups-26-27-S1_filled.xlsx"
)


@pytest.fixture
def database() -> StudentDatabase:
    return StudentDatabase(TEST_DATABASE_URL)


@pytest.fixture(autouse=True)
def empty_shared_tables() -> None:
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(text("DELETE FROM students"))
        connection.execute(text("DELETE FROM student_cohorts"))


@pytest.fixture
def client(database: StudentDatabase) -> TestClient:
    app.dependency_overrides[api.get_database] = lambda: database
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def content() -> bytes:
    try:
        with open(WORKBOOK, "rb") as handle:  # noqa: PTH123
            return handle.read()
    except FileNotFoundError:  # pragma: no cover - the sample lives in the other repo
        pytest.skip("the filled sample workbook is not checked out")


def preview(client: TestClient, cohort_id: str, content: bytes, term_id: str = TERM):
    return client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/workbook/preview",
        data={"term_id": term_id},
        files={"workbook": ("FYS.xlsx", content, SPREADSHEET)},
    )


def apply(client: TestClient, cohort_id: str, operations: list[dict], term_id: str = TERM):
    return client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/workbook/apply",
        json={"termId": term_id, "operations": operations},
    )


def rows_of(payload: dict) -> list[dict]:
    return [row for block in payload["reference"]["blocks"] for row in block["rows"]]


def test_a_first_upload_offers_every_block_as_new(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    payload = preview(client, cohort["id"], content).json()

    assert payload["sheet"] == "Reference"
    assert payload["style"] == "cohort"
    assert payload["reference"]["summary"]["blocksNew"] == 3
    assert payload["reference"]["summary"]["unchanged"] == 0


def test_a_preview_writes_nothing(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    preview(client, cohort["id"], content)

    assert database.catalogue_for_diff(cohort["id"], TERM) == {}


def test_only_the_ticked_rows_land(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    payload = preview(client, cohort["id"], content).json()

    one_group = next(row for row in rows_of(payload) if row["kind"] == "group")
    response = apply(client, cohort["id"], [one_group])

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json()["groups"] == 1
    held = database.catalogue_for_diff(cohort["id"], TERM)
    assert sum(len(scope["groups"]) for scope in held.values()) == 1


def test_re_uploading_what_is_already_there_asks_for_nothing(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    first = preview(client, cohort["id"], content).json()
    apply(client, cohort["id"], rows_of(first))

    again = preview(client, cohort["id"], content).json()
    assert again["reference"]["summary"]["decisions"] == 0
    assert again["reference"]["summary"]["unchanged"] > 0


def test_a_corrected_crn_shows_both_values_and_is_not_applied_until_ticked(
    client: TestClient, database, content
):
    cohort = database.create_cohort(name="Foundation Year")
    payload = preview(client, cohort["id"], content).json()
    apply(client, cohort["id"], rows_of(payload))

    # A coordinator corrects one cell by hand; the workbook still holds the old number.
    held = database.catalogue_for_diff(cohort["id"], TERM)
    scope = held["CM"]
    group = next(iter(scope["groups"].values()))
    course_code, original = next(iter(group["crns"].items()))
    database.apply_workbook_changes(
        cohort["id"],
        TERM,
        [
            {
                "op": "setCell",
                "scopeCode": "CM",
                "groupLabel": group["label"],
                "courseCode": course_code,
                "crn": "99999",
            }
        ],
    )

    again = preview(client, cohort["id"], content).json()
    changed = [row for row in rows_of(again) if row["kind"] == "cell" and row["status"] == "changed"]
    assert len(changed) == 1
    assert changed[0]["before"] == "99999"
    assert changed[0]["after"] == original

    # Left unticked, the coordinator's correction survives.
    apply(client, cohort["id"], [])
    still = database.catalogue_for_diff(cohort["id"], TERM)["CM"]["groups"][group["label"]]
    assert still["crns"][course_code] == "99999"


def test_approving_nothing_is_refused(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    response = apply(client, cohort["id"], [])
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ------------------------------------------------------------------- placements


def seed_students(database: StudentDatabase, cohort_id: str, ids: list[str]) -> None:
    with database.engine.begin() as connection:
        for student in ids:
            connection.execute(
                text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at,
                                              last_seen_at, updated_at)
                        VALUES (:id, 'in_portal', :cohort, 'now', 'now', 'now')
                        ON CONFLICT (student_id) DO UPDATE SET cohort_id = :cohort"""),
                {"id": student, "cohort": cohort_id},
            )


def test_placements_are_offered_once_the_blocks_they_need_exist(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    first = preview(client, cohort["id"], content).json()
    # No blocks yet, so the workbook's groups cannot be matched.
    assert first["placements"]["summary"]["decisions"] == 0
    assert first["placements"]["unknownGroups"]

    apply(client, cohort["id"], rows_of(first))
    seed_students(database, cohort["id"], ["A00021503", "A00021506"])

    again = preview(client, cohort["id"], content).json()
    assert again["placements"]["summary"]["placed"] > 0
    assert again["placements"]["unknownGroups"] == []


def test_a_placement_lands_only_when_ticked(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    first = preview(client, cohort["id"], content).json()
    apply(client, cohort["id"], rows_of(first))
    seed_students(database, cohort["id"], ["A00021503"])

    payload = preview(client, cohort["id"], content).json()
    mine = [row for row in payload["placements"]["rows"] if row["studentId"] == "A00021503"]
    assert mine

    apply(client, cohort["id"], mine[:1])
    assert database.assignments_of(cohort["id"])["A00021503"]


def test_a_student_the_workbook_would_move_says_where_from(client: TestClient, database, content):
    cohort = database.create_cohort(name="Foundation Year")
    first = preview(client, cohort["id"], content).json()
    apply(client, cohort["id"], rows_of(first))
    seed_students(database, cohort["id"], ["A00021503"])

    payload = preview(client, cohort["id"], content).json()
    row = next(row for row in payload["placements"]["rows"] if row["studentId"] == "A00021503")
    apply(client, cohort["id"], [row])

    # Put them somewhere else, then look again: the workbook now proposes a move.
    groups = database.group_ids_by_label(cohort["id"], TERM)[row["scopeCode"].upper()]
    elsewhere = next(gid for label, gid in groups.items() if label != row["after"].upper())
    database.apply_workbook_changes(
        cohort["id"], TERM, [{"op": "place", "studentId": "A00021503", "groupId": elsewhere}]
    )

    again = preview(client, cohort["id"], content).json()
    moved = next(
        row
        for row in again["placements"]["rows"]
        if row["studentId"] == "A00021503" and row["scopeCode"] == row["scopeCode"]
    )
    assert moved["status"] == "moved"
    assert moved["before"]
