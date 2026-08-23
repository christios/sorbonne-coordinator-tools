"""The Student Database's routes, as the screens use them."""

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import student_database as api
from sorbonne.main import app
from sorbonne.services.student_database import StudentDatabase
from tests.conftest import TEST_DATABASE_URL
from tests.test_group_reference_import import COHORT_HEADERS, COHORT_ROWS, workbook

SPREADSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# The fixture workbook holds two CM groups and three TD groups, and a full tutorial room is 24.
FIXTURE_GROUPS = 5
SEATS = 24


@pytest.fixture
def client() -> TestClient:
    database = StudentDatabase(TEST_DATABASE_URL)
    app.dependency_overrides[api.get_database] = lambda: database
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_database, None)


@pytest.fixture(autouse=True)
def empty_shared_tables() -> None:
    """Saved searches and student records are shared, so each test starts from nothing.

    A student record outlives every cohort by design — that is the point of the rewrite —
    so unlike a cohort's rows it will not disappear when the test's cohort does.
    """
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(text("DELETE FROM roster_filters"))
        connection.execute(text("DELETE FROM students"))


@pytest.fixture
def cohort_id(client: TestClient) -> str:
    response = client.post(
        "/api/v1/student-database/cohorts", json={"name": "Foundation Year", "term": "S1 2026-27"}
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()["id"]


def catalogue(client: TestClient, cohort_id: str) -> dict:
    response = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/catalogue")
    assert response.status_code == status.HTTP_200_OK, response.text
    return response.json()


def scope_of(body: dict, code: str) -> dict:
    return next(scope for scope in body["scopes"] if scope["code"] == code)


@pytest.mark.anonymous
def test_the_student_database_is_closed_to_a_signed_out_browser():
    with TestClient(app) as anonymous:
        assert (
            anonymous.get("/api/v1/student-database/cohorts").status_code == status.HTTP_401_UNAUTHORIZED
        )


def test_a_cohort_is_created_listed_and_deleted(client: TestClient):
    created = client.post(
        "/api/v1/student-database/cohorts", json={"name": "L2 — repeaters", "term": "S1 2026-27"}
    ).json()

    listed = client.get("/api/v1/student-database/cohorts").json()["cohorts"]
    assert created["id"] in {row["id"] for row in listed}

    assert (
        client.delete(f"/api/v1/student-database/cohorts/{created['id']}").status_code
        == status.HTTP_204_NO_CONTENT
    )


def test_uploading_a_workbook_reports_what_it_read(client: TestClient, cohort_id: str):
    response = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/catalogue/import",
        files={"workbook": ("FYS.xlsx", workbook(COHORT_HEADERS, COHORT_ROWS), SPREADSHEET)},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["style"] == "cohort"
    assert body["read"] == {"scopes": 2, "groups": 5, "crns": 6}
    assert body["added"]["groups"] == FIXTURE_GROUPS
    assert [scope["code"] for scope in catalogue(client, cohort_id)["scopes"]] == ["CM", "TD"]


def test_a_file_that_is_not_a_reference_sheet_is_explained(client: TestClient, cohort_id: str):
    response = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/catalogue/import",
        files={"workbook": ("notes.txt", b"not a workbook", "text/plain")},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "could not be read as an Excel workbook" in response.json()["detail"]


def test_a_block_a_group_and_a_crn_can_be_added_by_hand(client: TestClient, cohort_id: str):
    scope = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD", "name": "Tutorials"}
    ).json()
    course = client.post(
        f"/api/v1/student-database/scopes/{scope['id']}/courses",
        json={"code": "MATH001", "name": "Pre-calculus 1", "component": "TD"},
    ).json()
    group = client.post(
        f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1", "capacity": SEATS}
    ).json()

    saved = client.put(
        f"/api/v1/student-database/groups/{group['id']}/courses/{course['id']}",
        json={"crn": "23223", "teacher": "Dr Ghantous"},
    )

    assert saved.status_code == status.HTTP_200_OK
    stored = scope_of(catalogue(client, cohort_id), "TD")["groups"][0]
    assert stored["crns"][course["id"]] == {"crn": "23223", "teacher": "Dr Ghantous"}
    assert stored["capacity"] == SEATS


def test_a_repeated_group_label_is_refused_with_a_reason(client: TestClient, cohort_id: str):
    scope = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"}
    ).json()
    client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"})

    repeated = client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"})

    assert repeated.status_code == status.HTTP_409_CONFLICT
    assert "already a group called 1" in repeated.json()["detail"]


def test_an_empty_crn_clears_the_cell(client: TestClient, cohort_id: str):
    scope = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"}).json()
    course = client.post(
        f"/api/v1/student-database/scopes/{scope['id']}/courses", json={"code": "MATH001"}
    ).json()
    group = client.post(
        f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"}
    ).json()
    client.put(
        f"/api/v1/student-database/groups/{group['id']}/courses/{course['id']}", json={"crn": "23223"}
    )

    client.put(f"/api/v1/student-database/groups/{group['id']}/courses/{course['id']}", json={"crn": ""})

    assert scope_of(catalogue(client, cohort_id), "TD")["groups"][0]["crns"] == {}


def test_an_unknown_cohort_answers_404(client: TestClient):
    assert (
        client.get("/api/v1/student-database/cohorts/nope/catalogue").status_code
        == status.HTTP_404_NOT_FOUND
    )


# ------------------------------------------------------------------ students

STUDENTS = ["A00021503", "A00021505", "A00021509"]


def sync(client: TestClient, ids: list[str], *, full: bool = True) -> dict:
    return client.post(
        "/api/v1/student-database/students/sync", json={"studentIds": ids, "full": full}
    ).json()


def students_of(client: TestClient) -> list[dict]:
    return client.get("/api/v1/student-database/students").json()["students"]


def test_a_sync_records_every_id_the_portal_returned(client: TestClient):
    report = sync(client, STUDENTS)

    assert report["seen"] == len(STUDENTS)
    assert report["added"] == len(STUDENTS)
    assert [row["studentId"] for row in students_of(client)] == STUDENTS
    assert {row["status"] for row in students_of(client)} == {"in_portal"}


def test_syncing_again_adds_nobody_and_keeps_the_first_sighting(client: TestClient):
    sync(client, STUDENTS)
    first_seen = students_of(client)[0]["firstSeenAt"]

    again = sync(client, STUDENTS)

    assert again["added"] == 0
    assert students_of(client)[0]["firstSeenAt"] == first_seen


def test_a_full_sync_marks_the_students_it_no_longer_returns(client: TestClient):
    sync(client, STUDENTS)

    report = sync(client, STUDENTS[:1])

    assert report["missing"] == 2
    statuses = {row["studentId"]: row["status"] for row in students_of(client)}
    assert statuses == {
        "A00021503": "in_portal",
        "A00021505": "not_in_portal",
        "A00021509": "not_in_portal",
    }


def test_a_filtered_sync_never_marks_anybody_missing(client: TestClient):
    # The bug this pins: a narrow search used to read as a mass exodus. Absent from one
    # filtered search is not the same fact as absent from the portal.
    sync(client, STUDENTS)

    report = sync(client, STUDENTS[:1], full=False)

    assert report["missing"] == 0
    assert {row["status"] for row in students_of(client)} == {"in_portal"}


def test_a_student_the_portal_returns_again_comes_back(client: TestClient):
    sync(client, STUDENTS)
    sync(client, [])

    sync(client, STUDENTS)

    assert {row["status"] for row in students_of(client)} == {"in_portal"}


def test_ids_are_tidied_and_deduplicated_on_the_way_in(client: TestClient):
    report = sync(client, [" a00021503 ", "A00021503", "", "A00021505"])

    assert report["seen"] == 2
    assert [row["studentId"] for row in students_of(client)] == ["A00021503", "A00021505"]


def test_students_are_moved_into_a_cohort_in_bulk(client: TestClient, cohort_id: str):
    sync(client, STUDENTS)

    moved = client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS[:2], "cohortId": cohort_id},
    )

    assert moved.json() == {"moved": 2}
    holding = {row["studentId"]: row["cohortId"] for row in students_of(client)}
    assert holding == {"A00021503": cohort_id, "A00021505": cohort_id, "A00021509": None}


def test_a_null_cohort_takes_students_out_of_the_one_they_are_in(client: TestClient, cohort_id: str):
    sync(client, STUDENTS)
    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": cohort_id},
    )

    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS[:1], "cohortId": None},
    )

    holding = {row["studentId"]: row["cohortId"] for row in students_of(client)}
    assert holding["A00021503"] is None
    assert holding["A00021505"] == cohort_id


def test_moving_into_a_cohort_that_is_gone_is_a_404(client: TestClient):
    sync(client, STUDENTS)

    response = client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": "nope"},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_the_student_record_carries_no_name(client: TestClient):
    sync(client, STUDENTS[:1])

    row = students_of(client)[0]

    assert set(row) == {
        "studentId",
        "status",
        "cohortId",
        "cohortName",
        "firstSeenAt",
        "lastSeenAt",
        "groups",
    }


def test_the_cohort_list_counts_the_students_in_it(client: TestClient, cohort_id: str):
    sync(client, STUDENTS)
    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": cohort_id},
    )

    cohorts = client.get("/api/v1/student-database/cohorts").json()["cohorts"]

    assert next(row for row in cohorts if row["id"] == cohort_id)["memberCount"] == len(STUDENTS)


# ------------------------------------------------------------- saved searches

FY_ACTIVE = {"YEARLEVEL_CODE": ["FY"], "STST_CODE": ["AS"]}
# What the portal returned for that search when it was last verified.
FY_COUNT = 245


def test_a_search_is_saved_listed_and_removed(client: TestClient):
    created = client.post(
        "/api/v1/student-database/filters",
        json={"name": "SCEN — First Year (active)", "filter": FY_ACTIVE, "expectedCount": FY_COUNT},
    )

    assert created.status_code == status.HTTP_201_CREATED, created.text
    body = created.json()
    assert body["filter"] == FY_ACTIVE
    assert body["expectedCount"] == FY_COUNT
    assert body["updatedBy"]  # the coordinator who wrote it

    listed = client.get("/api/v1/student-database/filters").json()["filters"]
    assert body["id"] in {row["id"] for row in listed}

    assert (
        client.delete(f"/api/v1/student-database/filters/{body['id']}").status_code
        == status.HTTP_204_NO_CONTENT
    )


def test_a_search_can_be_edited_in_place(client: TestClient):
    created = client.post(
        "/api/v1/student-database/filters", json={"name": "L1", "filter": {"YEARLEVEL_CODE": ["L1"]}}
    ).json()

    updated = client.put(
        f"/api/v1/student-database/filters/{created['id']}",
        json={"name": "L1 — Physics", "filter": {"YEARLEVEL_CODE": ["L1"], "MAJOR_CODE": ["PHYS"]}},
    )

    assert updated.status_code == status.HTTP_200_OK
    assert updated.json()["filter"]["MAJOR_CODE"] == ["PHYS"]


def test_only_portal_codes_are_accepted(client: TestClient):
    # Nothing about a student may be stored, and nothing that is not a code may be sent on.
    for bad in (
        {"FULL_NAME": ["Amira Haddad"]},
        {"YEARLEVEL_CODE": ["'; DROP TABLE students; --"]},
        {"bad key": ["FY"]},
        {"YEARLEVEL_CODE": []},
        {},
    ):
        response = client.post("/api/v1/student-database/filters", json={"name": "bad", "filter": bad})
        assert response.status_code == status.HTTP_400_BAD_REQUEST, bad


def test_a_name_is_kept_when_it_is_a_field_name(client: TestClient):
    # FULL_NAME is a portal field, so the *field* is fine — it is the value that is not.
    response = client.post(
        "/api/v1/student-database/filters",
        json={"name": "By surname", "filter": {"FULL_NAME": ["Haddad"]}},
    )

    assert response.status_code == status.HTTP_201_CREATED


def test_two_searches_cannot_share_a_name(client: TestClient):
    client.post("/api/v1/student-database/filters", json={"name": "First Year", "filter": FY_ACTIVE})

    repeated = client.post(
        "/api/v1/student-database/filters", json={"name": "First Year", "filter": FY_ACTIVE}
    )

    assert repeated.status_code == status.HTTP_409_CONFLICT
    assert "already a saved search called First Year" in repeated.json()["detail"]


def test_an_unknown_search_is_a_404(client: TestClient):
    assert (
        client.delete("/api/v1/student-database/filters/nope").status_code == status.HTTP_404_NOT_FOUND
    )
