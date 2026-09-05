"""Publishing a semester: what it says before it writes, and what it sends when it does.

The interesting cases are the refusals. A semester nobody has set up, a cohort with students
in no group, a CRN the timetable has never heard of — each of these publishes *something*
if nobody checks, and what it publishes is a student without a timetable.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import publication as api
from sorbonne.api import student_database as student_api
from sorbonne.api import timetables as timetables_api
from sorbonne.main import app
from sorbonne.services.student_database import StudentDatabase
from sorbonne.services.student_timetables import StudentPlatformClient
from tests.conftest import TEST_DATABASE_URL

TERM = "term-1"
OTHER_TERM = "term-2"

MONDAY = {"date": "2026-08-31", "start": "08:30:00", "end": "10:00:00", "isExam": False}
SECTIONS = [
    {"crn": "22151", "code": "MATH-001-CM-GR.A", "kind": "Lecture", "groupLabel": "Gr. A", "sessions": [MONDAY]},
    {"crn": "23652", "code": "MATH-011-TD-Gr.1", "kind": "Tutorial", "groupLabel": "Gr. 1", "sessions": [MONDAY]},
    {"crn": "23653", "code": "MATH-011-TD-Gr.2", "kind": "Tutorial", "groupLabel": "Gr. 2"},
]


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
    # Publishing reads one database and assigning writes it; both must be the test's.
    app.dependency_overrides[api.get_database] = lambda: database
    app.dependency_overrides[student_api.get_database] = lambda: database
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def platform(handler) -> StudentPlatformClient:
    return StudentPlatformClient("https://platform.example", "secret", transport=httpx.MockTransport(handler))


def use(client: TestClient, handler) -> TestClient:
    app.dependency_overrides[timetables_api.require_client] = lambda: platform(handler)
    return client


def sections_then(payload, status_code=status.HTTP_200_OK):
    """A handler that answers /sections, and everything else with `payload`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        return httpx.Response(status_code, json=payload)

    return handler


def build_cohort(database: StudentDatabase, *, term_id: str = TERM, assign: bool = True) -> dict:
    """Foundation Year: one CM scope, one TD scope, two students in group A and 1."""
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    with database.engine.begin() as connection:
        for student in ("A001", "A002"):
            connection.execute(
                text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at,
                                              last_seen_at, updated_at)
                        VALUES (:id, 'in_portal', :cohort, 'now', 'now', 'now')"""),
                {"id": student, "cohort": cohort["id"]},
            )

    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id=term_id)
    td = database.add_scope(cohort["id"], code="TD", name="Tutorials", term_id=term_id)
    maths = database.add_course(cm, code="MATH-001")
    algorithms = database.add_course(td, code="MATH-011")
    group_a = database.add_group(cm, label="A")
    group_1 = database.add_group(td, label="1")
    database.set_cell(group_id=group_a, course_id=maths, crn="22151")
    database.set_cell(group_id=group_1, course_id=algorithms, crn="23652")

    if assign:
        for student in ("A001", "A002"):
            database.assign(student_id=student, scope_id=cm, group_id=group_a)
            database.assign(student_id=student, scope_id=td, group_id=group_1)

    return {"cohort": cohort, "cm": cm, "td": td, "groupA": group_a, "group1": group_1}


# ------------------------------------------------------------------- readiness


def test_a_semester_nobody_has_set_up_is_not_ready(client: TestClient, database: StudentDatabase):
    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    assert payload["cohorts"] == []
    assert payload["isReady"] is False


def test_a_fully_assigned_cohort_is_ready(client: TestClient, database: StudentDatabase):
    build_cohort(database)
    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    assert payload["isReady"] is True
    assert payload["cohorts"][0]["cohort"] == "Foundation Year"
    assert payload["cohorts"][0]["students"] == 2  # noqa: PLR2004
    assert payload["resolved"] == {"students": 2, "enrolments": 4}


def test_students_in_no_group_stop_it_being_ready_and_are_named(client: TestClient, database: StudentDatabase):
    build_cohort(database, assign=False)
    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    report = payload["cohorts"][0]
    assert payload["isReady"] is False
    assert "2 with no Lectures group" in report["warnings"]
    assert report["unassigned"]["CM"] == ["A001", "A002"]


def test_groups_that_meet_at_the_same_hour_are_named_with_who_sits_in_both(
    client: TestClient, database: StudentDatabase
):
    # CM A and TD 1 both meet Monday 08:30, and both students are in both. Not a blocker —
    # the timetable is what it is — but it is said where the placing happens.
    build_cohort(database)

    report = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    [clash] = report["cohorts"][0]["clashes"]
    assert [f"{group['scopeCode']} {group['label']}" for group in clash["groups"]] == ["CM A", "TD 1"]
    assert clash["windows"] == [
        {"weekday": "Mon", "start": "08:30", "end": "10:00", "crns": ["22151", "23652"], "dates": 1}
    ]
    assert clash["students"] == ["A001", "A002"]
    assert report["isReady"] is True


def test_a_cohort_set_up_for_another_semester_is_not_this_ones_business(client: TestClient, database: StudentDatabase):
    build_cohort(database, term_id=OTHER_TERM)
    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    assert payload["cohorts"] == []


def test_every_crn_is_checked_against_the_timetable(client: TestClient, database: StudentDatabase):
    built = build_cohort(database)
    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()

    verdicts = payload["validation"]
    assert verdicts[f"{built['groupA']}|MATH-001"]["status"] == "matched"
    assert verdicts[f"{built['group1']}|MATH-011"]["status"] == "matched"


def test_a_crn_the_timetable_lacks_is_reported_rather_than_published_silently(
    client: TestClient, database: StudentDatabase
):
    built = build_cohort(database)
    database.set_cell(group_id=built["groupA"], course_id=_course_of(database, built["cm"]), crn="99999")

    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()
    assert payload["validation"][f"{built['groupA']}|MATH-001"]["status"] == "unknown"


def test_a_bad_crn_stops_the_semester_being_ready_even_with_everybody_assigned(
    client: TestClient, database: StudentDatabase
):
    """Found in the real catalogue: a whole group pointing at sections that do not exist."""
    built = build_cohort(database)
    database.set_cell(group_id=built["groupA"], course_id=_course_of(database, built["cm"]), crn="99999")

    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()
    assert payload["cohorts"][0]["isReady"] is True  # every student has a group
    assert payload["unmatchedCrns"] == 1
    assert payload["isReady"] is False  # but the semester is not publishable


def _course_of(database: StudentDatabase, scope_id: str) -> str:
    with database.engine.connect() as connection:
        return connection.execute(
            text("SELECT id FROM scope_courses WHERE scope_id = :id"), {"id": scope_id}
        ).scalar_one()


# ------------------------------------------------------------ preview and publish


def test_the_preview_sends_what_was_resolved_and_writes_nothing_here(client: TestClient, database: StudentDatabase):
    build_cohort(database)
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        seen["path"] = request.url.path
        seen["body"] = request.content.decode()
        return httpx.Response(status.HTTP_200_OK, json={"summary": {"enrolmentsAdded": 4}})

    response = use(client, handler).post(f"/api/v1/publication/terms/{TERM}/preview")

    assert response.status_code == status.HTTP_200_OK
    assert seen["path"] == f"/api/v1/admin/terms/{TERM}/enrolments/preview"
    assert json.loads(seen["body"])["enrolments"] == {
        "A001": ["22151", "23652"],
        "A002": ["22151", "23652"],
    }


def test_publishing_sends_every_cohort_on_the_semester(client: TestClient, database: StudentDatabase):
    build_cohort(database)
    second = database.create_cohort(name="L1", term="2026-27")
    with database.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at,
                                          last_seen_at, updated_at)
                    VALUES ('A003', 'in_portal', :cohort, 'now', 'now', 'now')"""),
            {"cohort": second["id"]},
        )
    scope = database.add_scope(second["id"], code="TD", name="Tutorials", term_id=TERM)
    course = database.add_course(scope, code="MATH-011")
    group = database.add_group(scope, label="2")
    database.set_cell(group_id=group, course_id=course, crn="23653")
    database.assign(student_id="A003", scope_id=scope, group_id=group)

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        seen["method"] = request.method
        seen["body"] = request.content.decode()
        return httpx.Response(status.HTTP_200_OK, json={"studentCount": 3})

    response = use(client, handler).post(f"/api/v1/publication/terms/{TERM}/publish", json={})

    assert response.status_code == status.HTTP_200_OK
    assert seen["method"] == "PUT"
    assert "A003" in seen["body"]
    assert "23653" in seen["body"]


def test_publishing_a_semester_with_no_blocks_is_refused_before_the_platform_is_called(
    client: TestClient,
):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        raise AssertionError("the platform should not be asked to publish nothing")

    response = use(client, handler).post(f"/api/v1/publication/terms/{TERM}/publish", json={})

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "nothing to publish" in response.json()["detail"]


def test_a_stale_publish_keeps_the_platforms_own_refusal(client: TestClient, database: StudentDatabase):
    build_cohort(database)
    handler = sections_then(
        {"detail": "This semester was changed by somebody else since you checked."},
        status.HTTP_409_CONFLICT,
    )

    response = use(client, handler).post(f"/api/v1/publication/terms/{TERM}/publish", json={"base_updated_at": "stale"})

    assert response.status_code == status.HTTP_409_CONFLICT
    assert "changed by somebody else" in response.json()["detail"]


def put_assignment(client: TestClient, scope_id: str, group_id: str | None, student: str = "A001"):
    return client.put(
        f"/api/v1/student-database/scopes/{scope_id}/assignments",
        json={"studentIds": [student], "groupId": group_id},
    )


# ------------------------------------------------------------------- assigning


def test_assigning_puts_a_student_in_a_group_and_replaces_what_they_had(client: TestClient, database: StudentDatabase):
    """One group per scope: assigning again moves them rather than adding a second."""
    built = build_cohort(database, assign=False)
    other = database.add_group(built["cm"], label="B")

    put_assignment(client, built["cm"], built["groupA"])
    put_assignment(client, built["cm"], other)

    assert database.assignments_of(built["cohort"]["id"])["A001"] == {built["cm"]: other}


def test_assigning_to_nothing_leaves_them_undecided_rather_than_enrolled(client: TestClient, database: StudentDatabase):
    built = build_cohort(database)
    put_assignment(client, built["cm"], None)

    payload = use(client, sections_then({})).get(f"/api/v1/publication/terms/{TERM}").json()
    assert "1 with no Lectures group" in payload["cohorts"][0]["warnings"]


def test_a_group_from_another_scope_is_refused(client: TestClient, database: StudentDatabase):
    built = build_cohort(database)
    response = put_assignment(client, built["cm"], built["group1"])
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_publishing_tells_the_platform_which_cohort_each_student_is_in(client: TestClient, database: StudentDatabase):
    """The platform has no notion of cohorts otherwise, and a notice addressed to one has
    to reach the right people."""
    build_cohort(database)

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        seen["body"] = json.loads(request.content.decode())
        return httpx.Response(status.HTTP_200_OK, json={"studentCount": 2})

    use(client, handler).post(f"/api/v1/publication/terms/{TERM}/publish", json={})

    cohorts = seen["body"]["cohorts"]
    assert cohorts, "cohort membership was not sent at all"
    assert all(set(entry) == {"key", "name"} for entry in cohorts.values())
    assert {entry["name"] for entry in cohorts.values()} == {"Foundation Year"}


def test_a_student_nobody_has_placed_still_gets_a_cohort(client: TestClient, database: StudentDatabase):
    """They resolve to no enrolments at all, and are the likeliest to need telling why."""
    build_cohort(database)
    cohort = database.list_cohorts()[0]
    with database.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at,
                                          last_seen_at, updated_at)
                    VALUES ('A-unplaced', 'in_portal', :cohort, 'now', 'now', 'now')"""),
            {"cohort": cohort["id"]},
        )

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sections"):
            return httpx.Response(status.HTTP_200_OK, json={"sections": SECTIONS})
        seen["body"] = json.loads(request.content.decode())
        return httpx.Response(status.HTTP_200_OK, json={"studentCount": 3})

    use(client, handler).post(f"/api/v1/publication/terms/{TERM}/publish", json={})

    assert "A-unplaced" not in seen["body"]["enrolments"]
    assert seen["body"]["cohorts"]["A-unplaced"]["name"] == "Foundation Year"


def test_a_section_without_a_crn_or_retired_enrols_nobody(client: TestClient, database: StudentDatabase):
    built = build_cohort(database)
    # A third course in the TD block whose section has details but no CRN yet, and a
    # retired section for a fourth: neither may reach the platform as an enrolment.
    pending = database.add_course(built["td"], code="PHYS-001")
    database.update_section(group_id=built["group1"], course_id=pending, hours="30")
    retired = database.add_course(built["td"], code="CHEM-001")
    database.set_cell(group_id=built["group1"], course_id=retired, crn="29999")
    database.update_section(group_id=built["group1"], course_id=retired, retired=True)

    resolved = api._resolve_term(database.term_publication(TERM))

    assert resolved["A001"] == ["22151", "23652"]
