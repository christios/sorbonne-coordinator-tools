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
        connection.execute(text("DELETE FROM student_views"))
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


def preview_workbook(client: TestClient, cohort_id: str, content: bytes, name: str = "FYS.xlsx"):
    return client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/workbook/preview",
        data={"term_id": ""},
        files={"workbook": (name, content, SPREADSHEET)},
    )


def test_a_workbook_says_what_it_would_add_before_adding_it(client: TestClient, cohort_id: str):
    response = preview_workbook(client, cohort_id, workbook(COHORT_HEADERS, COHORT_ROWS))

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["style"] == "cohort"
    assert body["reference"]["summary"]["groupsAdded"] == FIXTURE_GROUPS
    # A preview writes nothing, so the catalogue is still empty.
    assert catalogue(client, cohort_id)["scopes"] == []


def test_the_approved_rows_become_the_catalogue(client: TestClient, cohort_id: str):
    body = preview_workbook(client, cohort_id, workbook(COHORT_HEADERS, COHORT_ROWS)).json()
    rows = [row for block in body["reference"]["blocks"] for row in block["rows"]]

    applied = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/workbook/apply",
        json={"termId": "", "operations": rows},
    )

    assert applied.status_code == status.HTTP_200_OK, applied.text
    assert applied.json()["groups"] == FIXTURE_GROUPS
    assert [scope["code"] for scope in catalogue(client, cohort_id)["scopes"]] == ["CM", "TD"]


def test_a_file_that_is_not_a_reference_sheet_is_explained(client: TestClient, cohort_id: str):
    response = preview_workbook(client, cohort_id, b"not a workbook", name="notes.txt")

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


@pytest.fixture
def view_id(client: TestClient) -> str:
    response = client.post(
        "/api/v1/student-database/views",
        json={"name": "Foundation Year", "filter": {"YEARLEVEL_CODE": ["FY"]}},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()["id"]


def sync(client: TestClient, view: str, ids: list[str]) -> dict:
    response = client.post(f"/api/v1/student-database/views/{view}/sync", json={"studentIds": ids})
    assert response.status_code == status.HTTP_200_OK, response.text
    return response.json()


def students_of(client: TestClient, view: str = "") -> list[dict]:
    path = f"/api/v1/student-database/students{f'?view={view}' if view else ''}"
    return client.get(path).json()["students"]


def views_of(client: TestClient) -> list[dict]:
    return client.get("/api/v1/student-database/views").json()["views"]


def test_a_view_fixes_its_filter_when_it_is_made(client: TestClient, view_id: str):
    view = next(row for row in views_of(client) if row["id"] == view_id)

    assert view["filter"] == {"YEARLEVEL_CODE": ["FY"]}
    # There is no route that would change it: a different question means a different view.
    # Deleting one lives on this path, so it is editing in particular that has to be absent.
    methods = client.app.openapi()["paths"].get("/api/v1/student-database/views/{view_id}", {})
    assert set(methods) == {"delete"}


def test_two_views_cannot_share_a_name(client: TestClient, view_id: str):
    again = client.post(
        "/api/v1/student-database/views", json={"name": "Foundation Year", "filter": {"YEARLEVEL_CODE": ["L1"]}}
    )

    assert again.status_code == status.HTTP_409_CONFLICT


def test_a_seed_sync_brings_the_view_its_students(client: TestClient, view_id: str):
    report = sync(client, view_id, STUDENTS)

    assert report["seen"] == len(STUDENTS)
    assert report["added"] == len(STUDENTS)
    assert [row["studentId"] for row in students_of(client, view_id)] == STUDENTS
    assert next(row for row in views_of(client) if row["id"] == view_id)["held"] == len(STUDENTS)


def test_a_later_sync_marks_who_the_view_stopped_returning(client: TestClient, view_id: str):
    sync(client, view_id, STUDENTS)

    report = sync(client, view_id, STUDENTS[:1])

    assert report["missing"] == 2
    statuses = {row["studentId"]: row["status"] for row in students_of(client, view_id)}
    assert statuses == {
        "A00021503": "in_portal",
        "A00021505": "not_in_portal",
        "A00021509": "not_in_portal",
    }


def test_two_views_may_disagree_about_a_student(client: TestClient, view_id: str):
    # The reason a view owns its membership: leaving one population is not leaving them all.
    other = client.post(
        "/api/v1/student-database/views", json={"name": "Everyone", "filter": {}}
    ).json()["id"]
    sync(client, view_id, STUDENTS)
    sync(client, other, STUDENTS)

    sync(client, view_id, STUDENTS[:1])

    here = {row["studentId"]: row["status"] for row in students_of(client, view_id)}
    there = {row["studentId"]: row["status"] for row in students_of(client, other)}
    assert here["A00021505"] == "not_in_portal"
    assert there["A00021505"] == "in_portal"
    # Globally they are still a student, because a view still returns them.
    assert {row["studentId"]: row["status"] for row in students_of(client)}["A00021505"] == "in_portal"


def test_a_student_no_view_returns_is_gone_from_the_record(client: TestClient, view_id: str):
    sync(client, view_id, STUDENTS)

    sync(client, view_id, STUDENTS[:1])

    assert {row["studentId"]: row["status"] for row in students_of(client)}["A00021505"] == (
        "not_in_portal"
    )


def test_the_student_record_is_shared_between_views(client: TestClient, view_id: str):
    other = client.post("/api/v1/student-database/views", json={"name": "Everyone", "filter": {}}).json()["id"]
    sync(client, view_id, STUDENTS)

    sync(client, other, STUDENTS)

    # One row per id however many views hold them.
    assert len(students_of(client)) == len(STUDENTS)


def test_ids_are_tidied_and_deduplicated_on_the_way_in(client: TestClient, view_id: str):
    report = sync(client, view_id, [" a00021503 ", "A00021503", "", "A00021505"])

    assert report["seen"] == 2
    assert [row["studentId"] for row in students_of(client, view_id)] == ["A00021503", "A00021505"]


def test_students_are_moved_into_a_cohort_in_bulk(client: TestClient, cohort_id: str, view_id: str):
    sync(client, view_id, STUDENTS)

    moved = client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS[:2], "cohortId": cohort_id},
    )

    assert moved.json() == {"moved": 2}
    holding = {row["studentId"]: row["cohortId"] for row in students_of(client, view_id)}
    assert holding == {"A00021503": cohort_id, "A00021505": cohort_id, "A00021509": None}


def test_a_null_cohort_takes_students_out_of_the_one_they_are_in(
    client: TestClient, cohort_id: str, view_id: str
):
    sync(client, view_id, STUDENTS)
    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": cohort_id},
    )

    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS[:1], "cohortId": None},
    )

    holding = {row["studentId"]: row["cohortId"] for row in students_of(client, view_id)}
    assert holding["A00021503"] is None
    assert holding["A00021505"] == cohort_id


def test_moving_into_a_cohort_that_is_gone_is_a_404(client: TestClient, view_id: str):
    sync(client, view_id, STUDENTS)

    response = client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": "nope"},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_the_student_record_carries_no_name(client: TestClient, view_id: str):
    sync(client, view_id, STUDENTS[:1])

    row = students_of(client, view_id)[0]

    assert set(row) == {
        "studentId",
        "status",
        "cohortId",
        "cohortName",
        "firstSeenAt",
        "lastSeenAt",
        "groups",
    }


def test_the_cohort_list_counts_the_students_in_it(client: TestClient, cohort_id: str, view_id: str):
    sync(client, view_id, STUDENTS)
    client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": STUDENTS, "cohortId": cohort_id},
    )

    cohorts = client.get("/api/v1/student-database/cohorts").json()["cohorts"]

    assert next(row for row in cohorts if row["id"] == cohort_id)["memberCount"] == len(STUDENTS)


def test_a_view_takes_portal_codes_only(client: TestClient):
    refused = client.post(
        "/api/v1/student-database/views", json={"name": "Bad", "filter": {"PASSPORT_NUMBER": ["X1"]}}
    )

    assert refused.status_code == status.HTTP_400_BAD_REQUEST


def test_deleting_a_view_takes_its_membership_with_it(client: TestClient, view_id: str):
    sync(client, view_id, STUDENTS)

    removed = client.delete(f"/api/v1/student-database/views/{view_id}")

    assert removed.status_code == status.HTTP_204_NO_CONTENT
    assert views_of(client) == []
    # The students themselves are a record of their own and stay.
    assert len(students_of(client)) == len(STUDENTS)


def test_only_an_administrator_may_define_a_view(client: TestClient, monkeypatch):
    _as_ordinary_coordinator(monkeypatch)

    refused = client.post("/api/v1/student-database/views", json={"name": "Mine", "filter": {}})

    assert refused.status_code == status.HTTP_403_FORBIDDEN
    assert views_of(client) == []


def test_only_an_administrator_may_delete_a_view(client: TestClient, view_id: str, monkeypatch):
    sync(client, view_id, STUDENTS)
    _as_ordinary_coordinator(monkeypatch)

    refused = client.delete(f"/api/v1/student-database/views/{view_id}")

    assert refused.status_code == status.HTTP_403_FORBIDDEN
    assert len(views_of(client)) == 1


def test_syncing_a_view_is_open_to_any_coordinator(client: TestClient, view_id: str, monkeypatch):
    # A sync asks the question the view already fixed, so it is not a decision to guard.
    _as_ordinary_coordinator(monkeypatch)

    assert (
        client.post(f"/api/v1/student-database/views/{view_id}/sync", json={"studentIds": STUDENTS})
    ).status_code == status.HTTP_200_OK


def _as_ordinary_coordinator(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sign the rest of the test in as somebody who is not an administrator."""
    from sorbonne.services import auth_gate
    from sorbonne.services.staff_auth import StaffUser

    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(
            email="colleague@sorbonne.ae", name="Colleague", is_admin=False
        ),
    )


