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
def empty_saved_searches() -> None:
    """Saved searches are shared and their names are unique, so each test starts clean."""
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(text("DELETE FROM roster_filters"))


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


# ------------------------------------------------------------------- members

STUDENTS = ["A00021503", "A00021505", "A00021509"]


def members_of(client: TestClient, cohort_id: str) -> list[str]:
    body = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/members").json()
    return [member["studentId"] for member in body["members"]]


def test_students_are_added_in_bulk_and_counted(client: TestClient, cohort_id: str):
    response = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/members", json={"studentIds": STUDENTS}
    )

    assert response.json() == {"added": len(STUDENTS)}
    assert members_of(client, cohort_id) == STUDENTS


def test_adding_the_same_students_again_adds_nobody(client: TestClient, cohort_id: str):
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/members", json={"studentIds": STUDENTS})

    again = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/members",
        json={"studentIds": [*STUDENTS, "A00021511"]},
    )

    assert again.json() == {"added": 1}
    assert len(members_of(client, cohort_id)) == len(STUDENTS) + 1


def test_ids_are_tidied_and_deduplicated_on_the_way_in(client: TestClient, cohort_id: str):
    response = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/members",
        json={"studentIds": [" a00021503 ", "A00021503", "", "A00021505"]},
    )

    assert response.json() == {"added": 2}
    assert members_of(client, cohort_id) == ["A00021503", "A00021505"]


def test_students_are_removed_in_bulk(client: TestClient, cohort_id: str):
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/members", json={"studentIds": STUDENTS})

    removed = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/members/remove",
        json={"studentIds": STUDENTS[:2]},
    )

    assert removed.json() == {"removed": 2}
    assert members_of(client, cohort_id) == STUDENTS[2:]


def test_the_member_list_carries_no_name(client: TestClient, cohort_id: str):
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/members", json={"studentIds": STUDENTS[:1]})

    member = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/members").json()["members"][0]

    assert set(member) == {"studentId", "addedAt", "addedBy", "groups"}


def test_the_cohort_list_counts_its_members(client: TestClient, cohort_id: str):
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/members", json={"studentIds": STUDENTS})

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
