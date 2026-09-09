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
    response = client.post("/api/v1/student-database/cohorts", json={"name": "Foundation Year", "term": "S1 2026-27"})
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
        assert anonymous.get("/api/v1/student-database/cohorts").status_code == status.HTTP_401_UNAUTHORIZED


def test_a_cohort_is_created_listed_and_deleted(client: TestClient):
    created = client.post(
        "/api/v1/student-database/cohorts", json={"name": "L2 — repeaters", "term": "S1 2026-27"}
    ).json()

    listed = client.get("/api/v1/student-database/cohorts").json()["cohorts"]
    assert created["id"] in {row["id"] for row in listed}

    assert client.delete(f"/api/v1/student-database/cohorts/{created['id']}").status_code == status.HTTP_204_NO_CONTENT


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
    cell = stored["crns"][course["id"]]
    assert cell == {**cell, "crn": "23223", "teacher": "Dr Ghantous"}
    assert stored["capacity"] == SEATS


def test_a_repeated_group_label_is_refused_with_a_reason(client: TestClient, cohort_id: str):
    scope = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"}).json()
    client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"})

    repeated = client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"})

    assert repeated.status_code == status.HTTP_409_CONFLICT
    assert "already a group called 1" in repeated.json()["detail"]


def test_an_empty_crn_clears_the_cell(client: TestClient, cohort_id: str):
    scope = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"}).json()
    course = client.post(f"/api/v1/student-database/scopes/{scope['id']}/courses", json={"code": "MATH001"}).json()
    group = client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"}).json()
    client.put(f"/api/v1/student-database/groups/{group['id']}/courses/{course['id']}", json={"crn": "23223"})

    client.put(f"/api/v1/student-database/groups/{group['id']}/courses/{course['id']}", json={"crn": ""})

    assert scope_of(catalogue(client, cohort_id), "TD")["groups"][0]["crns"] == {}


def test_an_unknown_cohort_answers_404(client: TestClient):
    assert client.get("/api/v1/student-database/cohorts/nope/catalogue").status_code == status.HTTP_404_NOT_FOUND


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
    other = client.post("/api/v1/student-database/views", json={"name": "Everyone", "filter": {}}).json()["id"]
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

    assert {row["studentId"]: row["status"] for row in students_of(client)}["A00021505"] == ("not_in_portal")


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


def test_a_null_cohort_takes_students_out_of_the_one_they_are_in(client: TestClient, cohort_id: str, view_id: str):
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
        "cohortSince",
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
    refused = client.post("/api/v1/student-database/views", json={"name": "Bad", "filter": {"PASSPORT_NUMBER": ["X1"]}})

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
        lambda *_args, **_kwargs: StaffUser(email="colleague@sorbonne.ae", name="Colleague", is_admin=False),
    )


# ------------------------------------------------- placing students in a block


def block_with_a_group(client: TestClient, cohort_id: str, code: str = "TD") -> tuple[str, str]:
    scope = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": code}).json()
    group = client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "1"}).json()
    return scope["id"], group["id"]


def place(client: TestClient, scope_id: str, student_ids: list[str], group_id: str | None) -> dict:
    response = client.put(
        f"/api/v1/student-database/scopes/{scope_id}/assignments",
        json={"studentIds": student_ids, "groupId": group_id},
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    return response.json()


def in_cohort(client: TestClient, view_id: str, cohort_id: str, ids: list[str]) -> None:
    sync(client, view_id, ids)
    client.post("/api/v1/student-database/students/cohort", json={"studentIds": ids, "cohortId": cohort_id})


def test_students_are_placed_in_a_group_in_one_go(client: TestClient, cohort_id: str, view_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    in_cohort(client, view_id, cohort_id, STUDENTS)

    report = place(client, scope_id, STUDENTS, group_id)

    assert report["assigned"] == len(STUDENTS)
    assert report["skipped"] == []
    held = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/assignments").json()["assignments"]
    assert {student: by_scope[scope_id] for student, by_scope in held.items()} == {
        student: group_id for student in STUDENTS
    }


def test_a_student_this_cohort_does_not_hold_is_skipped_and_named(client: TestClient, cohort_id: str, view_id: str):
    """A block belongs to one cohort, so its groups are not open to everybody.

    Placing an outsider would write a row saying they are in a cohort they are not in, and
    their enrolment would follow. The same rule the workbook upload follows.
    """
    scope_id, group_id = block_with_a_group(client, cohort_id)
    in_cohort(client, view_id, cohort_id, STUDENTS[:1])
    sync(client, view_id, [*STUDENTS[:1], "A00099999"])

    report = place(client, scope_id, [STUDENTS[0], "A00099999"], group_id)

    assert report["assigned"] == 1
    assert report["skipped"] == ["A00099999"]


def test_a_whole_fill_lands_in_one_go(client: TestClient, cohort_id: str, view_id: str):
    scope_id, group_1 = block_with_a_group(client, cohort_id)
    group_2 = client.post(f"/api/v1/student-database/scopes/{scope_id}/groups", json={"label": "2"}).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)
    sync(client, view_id, [*STUDENTS, "A00099999"])

    response = client.put(
        f"/api/v1/student-database/scopes/{scope_id}/placements",
        json={"placements": {group_1: [STUDENTS[0], "A00099999"], group_2: STUDENTS[1:]}},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json() == {"assigned": len(STUDENTS), "skipped": ["A00099999"]}
    held = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/assignments").json()["assignments"]
    assert held[STUDENTS[0]][scope_id] == group_1
    assert all(held[student][scope_id] == group_2 for student in STUDENTS[1:])


def test_a_fill_naming_a_group_of_another_block_writes_nothing(client: TestClient, cohort_id: str, view_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    _, other = block_with_a_group(client, cohort_id, code="CM")
    in_cohort(client, view_id, cohort_id, STUDENTS)

    response = client.put(
        f"/api/v1/student-database/scopes/{scope_id}/placements",
        json={"placements": {group_id: STUDENTS[:1], other: STUDENTS[1:]}},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    held = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/assignments").json()["assignments"]
    assert held == {}


def test_a_group_remembers_the_programme_it_prefers(client: TestClient, cohort_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)

    client.patch(
        f"/api/v1/student-database/groups/{group_id}",
        json={"label": "1", "capacity": 24, "note": "", "program": "Physics"},
    )

    group = scope_of(catalogue(client, cohort_id), "TD")["groups"][0]
    assert group["program"] == "Physics"
    assert group["capacity"] == SEATS


def test_placing_nobody_in_a_group_takes_them_out_of_the_block(client: TestClient, cohort_id: str, view_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, scope_id, STUDENTS, group_id)

    place(client, scope_id, STUDENTS, None)

    held = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/assignments").json()["assignments"]
    assert held == {}


def test_a_group_from_another_block_is_refused(client: TestClient, cohort_id: str, view_id: str):
    scope_id, _ = block_with_a_group(client, cohort_id)
    _, elsewhere = block_with_a_group(client, cohort_id, code="CM")
    in_cohort(client, view_id, cohort_id, STUDENTS)

    response = client.put(
        f"/api/v1/student-database/scopes/{scope_id}/assignments",
        json={"studentIds": STUDENTS, "groupId": elsewhere},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_a_student_carries_the_groups_they_are_in_by_name(client: TestClient, cohort_id: str, view_id: str):
    """Ids are no use to a table. "TD 1" is what a coordinator recognises."""
    scope_id, group_id = block_with_a_group(client, cohort_id)
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, scope_id, STUDENTS[:1], group_id)

    held = {row["studentId"]: row["groups"] for row in students_of(client)}

    # The id travels too, and only for the Meets column: the label alone cannot be joined
    # to the CRNs a group holds, and "TD 1" is a different group in a different set.
    assert held[STUDENTS[0]] == [
        {"termId": "", "scopeCode": "TD", "groupLabel": "1", "groupId": group_id, "openToAll": False}
    ]
    assert held[STUDENTS[1]] == []


# ------------------------------------------------------------ discrepancies


def test_the_rules_start_empty_and_come_back_as_saved(client: TestClient) -> None:
    client.put("/api/v1/student-database/discrepancy-rules", json={"rules": []})
    assert client.get("/api/v1/student-database/discrepancy-rules").json() == {"rules": []}

    saved = client.put(
        "/api/v1/student-database/discrepancy-rules",
        json={"rules": [{"field": "STST_CODE", "kind": "changed_to", "values": ["WD"]}]},
    )

    assert saved.status_code == status.HTTP_200_OK
    [rule] = saved.json()["rules"]
    assert (rule["field"], rule["kind"], rule["values"]) == ("STST_CODE", "changed_to", ["WD"])
    assert rule["id"]
    assert client.get("/api/v1/student-database/discrepancy-rules").json()["rules"] == [rule]


def test_a_rule_that_cannot_mean_anything_says_why(client: TestClient) -> None:
    response = client.put(
        "/api/v1/student-database/discrepancy-rules",
        json={"rules": [{"field": "STST_CODE", "kind": "differs"}]},
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "differ from" in response.json()["detail"]


def test_a_cohort_carries_its_majors_terms_and_year(client: TestClient) -> None:
    made = client.post(
        "/api/v1/student-database/cohorts",
        json={"name": "L1 Maths", "majors": ["MATH", "PHYS"], "terms": ["262710"], "yearLevel": "L1"},
    )

    assert made.status_code == status.HTTP_201_CREATED
    assert made.json()["majors"] == ["MATH", "PHYS"]
    assert made.json()["terms"] == ["262710"]
    assert made.json()["yearLevel"] == "L1"


# ------------------------------------------------------------- the request


def test_sets_are_read_in_the_order_the_coordinator_puts_them_in(client: TestClient, cohort_id: str):
    made = [
        client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": code}).json()["id"]
        for code in ("TD", "RDNS", "CM")
    ]
    codes = lambda: [scope["code"] for scope in catalogue(client, cohort_id)["scopes"]]  # noqa: E731

    assert codes() == ["TD", "RDNS", "CM"]

    # CM up twice puts the lectures first, where the page should read them.
    for _ in range(2):
        assert client.post(f"/api/v1/student-database/scopes/{made[2]}/move", json={"by": -1}).status_code == status.HTTP_200_OK
    assert codes() == ["CM", "TD", "RDNS"]

    client.post(f"/api/v1/student-database/scopes/{made[0]}/move", json={"by": 1})
    assert codes() == ["CM", "RDNS", "TD"]


def test_a_set_at_the_end_of_the_order_stays_there(client: TestClient, cohort_id: str):
    first = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "CM"}).json()["id"]
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"})

    # Nothing above it, so nothing happens — rather than an error the page has to handle.
    assert client.post(f"/api/v1/student-database/scopes/{first}/move", json={"by": -1}).status_code == status.HTTP_200_OK
    assert [scope["code"] for scope in catalogue(client, cohort_id)["scopes"]] == ["CM", "TD"]


def test_a_set_that_is_not_there_cannot_be_moved(client: TestClient):
    assert client.post("/api/v1/student-database/scopes/nope/move", json={"by": 1}).status_code == status.HTTP_404_NOT_FOUND


def test_a_cohort_says_what_its_sheet_in_the_timetable_workbook_is_called(client: TestClient, cohort_id: str):
    # Licence 2's first semester is called S3, because the workbook numbers across the
    # degree. No rule can derive that, so the cohort is asked.
    response = client.patch(
        f"/api/v1/student-database/cohorts/{cohort_id}",
        json={"name": "BSc Mathematics & Physics — Licence 2", "workbookTab": "BSc-L2", "firstSemester": 3},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json()["workbookTab"] == "BSc-L2"
    assert response.json()["firstSemester"] == 3
    held = client.get("/api/v1/student-database/cohorts").json()["cohorts"]
    assert [c["workbookTab"] for c in held if c["id"] == cohort_id] == ["BSc-L2"]


def test_a_cohort_that_has_not_been_asked_says_nothing_about_its_sheet(client: TestClient, cohort_id: str):
    held = next(
        cohort
        for cohort in client.get("/api/v1/student-database/cohorts").json()["cohorts"]
        if cohort["id"] == cohort_id
    )

    assert held["workbookTab"] == ""
    assert held["firstSemester"] == 0


def test_a_section_carries_the_timetable_request_beyond_its_crn(client: TestClient, cohort_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    course = client.post(
        f"/api/v1/student-database/scopes/{scope_id}/courses",
        json={"code": "MATH-001", "name": "Pre-calculus 1", "component": "TD"},
    ).json()
    client.put(f"/api/v1/student-database/groups/{group_id}/courses/{course['id']}", json={"crn": "23223"})

    response = client.patch(
        f"/api/v1/student-database/groups/{group_id}/courses/{course['id']}",
        json={
            "teacherId": "act-1",
            "hours": "50",
            "sessionsPerWeek": "2 sessions - weeks 2 to 14",
            "duration": "1.5",
            "anticipated": 33,
            "constraints": "Should NOT be in parallel with G.2",
            "comments": "Mutualized with Maths",
        },
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    block = scope_of(catalogue(client, cohort_id), "TD")
    # The UE and parent CRN are the active course's, not the set's — see test_portal_api.
    assert set(block["courses"][0]) == {"id", "code", "name", "component", "request"}
    # Nothing has been asked of the course itself, so its own request is empty.
    assert block["courses"][0]["request"]["hours"] == ""
    section = block["groups"][0]["crns"][course["id"]]
    assert section["crn"] == "23223"
    assert section["teacherId"] == "act-1"
    assert section["anticipated"] == SEATS + 9
    assert section["constraints"] == "Should NOT be in parallel with G.2"
    assert section["retired"] is False


def test_a_course_asks_for_things_of_its_own_and_the_sections_are_left_as_they_were(
    client: TestClient, cohort_id: str
):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    course = client.post(
        f"/api/v1/student-database/scopes/{scope_id}/courses",
        json={"code": "MATH-001", "name": "Pre-calculus 1", "component": "TD"},
    ).json()
    client.patch(
        f"/api/v1/student-database/groups/{group_id}/courses/{course['id']}",
        json={"hours": "36", "anticipated": 12},
    )

    response = client.patch(
        f"/api/v1/student-database/courses/{course['id']}/request",
        json={
            "hours": "50",
            "weeks": "2-14",
            "anticipated": 33,
            "roomPref": "Amphitheatre",
            "constraints": "Never on a Friday",
        },
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    block = scope_of(catalogue(client, cohort_id), "TD")
    asked = block["courses"][0]["request"]
    assert asked["hours"] == "50"
    assert asked["weeks"] == "2-14"
    assert asked["anticipated"] == 33
    assert asked["roomPref"] == "Amphitheatre"
    assert asked["constraints"] == "Never on a Friday"
    # The section keeps its own answers; nothing was pushed into it.
    section = block["groups"][0]["crns"][course["id"]]
    assert section["hours"] == "36"
    assert section["anticipated"] == 12
    assert section["constraints"] == ""


def test_a_course_that_is_not_there_cannot_be_asked_for_anything(client: TestClient, cohort_id: str):
    response = client.patch(
        "/api/v1/student-database/courses/does-not-exist/request", json={"hours": "50"}
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_renaming_a_course_leaves_what_it_asks_for_alone(client: TestClient, cohort_id: str):
    scope_id, _group_id = block_with_a_group(client, cohort_id)
    course = client.post(
        f"/api/v1/student-database/scopes/{scope_id}/courses", json={"code": "MATH-001"}
    ).json()
    client.patch(f"/api/v1/student-database/courses/{course['id']}/request", json={"hours": "50"})

    client.patch(
        f"/api/v1/student-database/courses/{course['id']}",
        json={"code": "MATH-001", "name": "Pre-calculus 1", "component": "TD"},
    )

    course_row = scope_of(catalogue(client, cohort_id), "TD")["courses"][0]
    assert course_row["name"] == "Pre-calculus 1"
    assert course_row["request"]["hours"] == "50"


def test_a_section_may_exist_before_the_portal_has_a_crn_for_it(client: TestClient, cohort_id: str):
    scope_id, group_id = block_with_a_group(client, cohort_id)
    course = client.post(f"/api/v1/student-database/scopes/{scope_id}/courses", json={"code": "MATH-001"}).json()

    client.patch(f"/api/v1/student-database/groups/{group_id}/courses/{course['id']}", json={"hours": "50"})

    section = scope_of(catalogue(client, cohort_id), "TD")["groups"][0]["crns"][course["id"]]
    assert section == {**section, "crn": "", "hours": "50"}


def test_a_group_set_knows_its_kind_and_a_group_its_parent(client: TestClient, cohort_id: str):
    td = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"}).json()
    td_group = client.post(f"/api/v1/student-database/scopes/{td['id']}/groups", json={"label": "2"}).json()
    tp = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes",
        json={"code": "TP", "kind": "nested", "parentScopeId": td["id"]},
    ).json()
    client.post(
        f"/api/v1/student-database/scopes/{tp['id']}/groups",
        json={"label": "2A", "capacity": 20, "parentGroupId": td_group["id"]},
    )

    held = catalogue(client, cohort_id)
    assert scope_of(held, "TD")["kind"] == "shared"
    assert scope_of(held, "TP")["kind"] == "nested"
    assert scope_of(held, "TP")["parentScopeId"] == td["id"]
    assert scope_of(held, "TP")["groups"][0]["parentGroupId"] == td_group["id"]
    # A kind nobody has heard of is treated as the ordinary one, not refused.
    odd = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "X", "kind": "weird"}
    ).json()
    assert next(s for s in catalogue(client, cohort_id)["scopes"] if s["id"] == odd["id"])["kind"] == "shared"


def test_a_set_open_to_every_cohort_holds_the_whole_department(client: TestClient, cohort_id: str, view_id: str):
    """Languages are one set of classes for everybody: the level decides the group, not the degree."""
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2 for languages"}).json()
    sync(client, view_id, ["A001", "A002"])
    client.post("/api/v1/student-database/students/cohort", json={"studentIds": ["A001"], "cohortId": cohort_id})
    client.post("/api/v1/student-database/students/cohort", json={"studentIds": ["A002"], "cohortId": other["id"]})

    scope = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes",
        json={"code": "LANG", "openToAll": True},
    ).json()
    group = client.post(f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "A1-G1"}).json()

    placed = client.put(
        f"/api/v1/student-database/scopes/{scope['id']}/placements",
        json={"placements": {group["id"]: ["A001", "A002"]}},
    ).json()

    # The set belongs to one cohort and holds students from both, counting all of them.
    both = 2
    assert (placed["assigned"], placed["skipped"]) == (both, [])
    block = scope_of(catalogue(client, cohort_id), "LANG")
    assert block["openToAll"] is True
    assert block["groups"][0]["assigned"] == both
    # And each student is filed under their own cohort, not under the set's owner.
    mine = client.get(f"/api/v1/student-database/cohorts/{other['id']}/assignments").json()["assignments"]
    assert mine["A002"][scope["id"]] == group["id"]


def test_a_shared_set_is_answered_for_every_cohort_when_asked(client: TestClient, cohort_id: str):
    """The row has to live under some cohort; the set belongs to the department.

    Reaching it only from whichever cohort happened to hold it is what made the languages
    look like Foundation Year's, so a page may ask for the shared ones too — and is told
    whose row each is, so it can keep them apart.
    """
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2 elsewhere"}).json()
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "LANG", "openToAll": True})
    client.post(f"/api/v1/student-database/cohorts/{other['id']}/scopes", json={"code": "TD"})

    own = client.get(f"/api/v1/student-database/cohorts/{other['id']}/catalogue").json()
    with_shared = client.get(
        f"/api/v1/student-database/cohorts/{other['id']}/catalogue", params={"with_shared": True}
    ).json()

    # Asked plainly, the cohort has only its own; asked for the shared ones, LANG is there.
    assert [scope["code"] for scope in own["scopes"]] == ["TD"]
    codes = [scope["code"] for scope in with_shared["scopes"]]
    assert "TD" in codes
    mine = [scope for scope in with_shared["scopes"] if scope["cohortId"] == cohort_id]
    assert [scope["code"] for scope in mine] == ["LANG"]
    assert mine[0]["openToAll"] is True


def test_a_set_of_one_cohort_still_turns_outsiders_away(client: TestClient, cohort_id: str, view_id: str):
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2 apart"}).json()
    sync(client, view_id, ["A001", "A002"])
    client.post("/api/v1/student-database/students/cohort", json={"studentIds": ["A001"], "cohortId": cohort_id})
    client.post("/api/v1/student-database/students/cohort", json={"studentIds": ["A002"], "cohortId": other["id"]})
    scope_id, group_id = block_with_a_group(client, cohort_id)

    placed = client.put(
        f"/api/v1/student-database/scopes/{scope_id}/placements",
        json={"placements": {group_id: ["A001", "A002"]}},
    ).json()

    assert (placed["assigned"], placed["skipped"]) == (1, ["A002"])


def test_the_cards_list_every_cohort_at_once(client: TestClient, cohort_id: str):
    block_with_a_group(client, cohort_id)
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L1", "term": "S1 2026-27"}).json()
    block_with_a_group(client, other["id"], code="CM")

    payload = client.get("/api/v1/student-database/course-cards").json()

    # By id, not by name: cohorts are shared and long-lived, and two of them may be called
    # the same thing — only the ids this test made say which entry is which.
    by_id = {entry["cohort"]["id"]: entry for entry in payload["cohorts"]}
    assert [scope["code"] for scope in by_id[cohort_id]["scopes"]] == ["TD"]
    assert [scope["code"] for scope in by_id[other["id"]]["scopes"]] == ["CM"]
    assert by_id[cohort_id]["cohort"]["name"] == "Foundation Year"


def test_renaming_a_set_onto_another_is_refused_not_a_crash(client: TestClient, cohort_id: str):
    """Making a duplicate is refused; renaming onto one used to reach the constraint raw."""
    client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "TD"})
    other = client.post(f"/api/v1/student-database/cohorts/{cohort_id}/scopes", json={"code": "CM"}).json()

    clash = client.patch(f"/api/v1/student-database/scopes/{other['id']}", json={"code": "TD"})

    assert clash.status_code == status.HTTP_409_CONFLICT
    # And the set is untouched: a refused rename must not half-apply.
    assert scope_of(catalogue(client, cohort_id), "CM")["code"] == "CM"


def test_renaming_a_group_onto_a_sibling_is_refused_not_a_crash(client: TestClient, cohort_id: str):
    scope_id, first = block_with_a_group(client, cohort_id)
    second = client.post(f"/api/v1/student-database/scopes/{scope_id}/groups", json={"label": "2"}).json()

    clash = client.patch(
        f"/api/v1/student-database/groups/{second['id']}", json={"label": "1", "capacity": 0, "note": ""}
    )

    assert clash.status_code == status.HTTP_409_CONFLICT
    assert first is not None


def test_our_own_planning_cannot_put_a_student_in_two_groups_of_one_set(
    client: TestClient, cohort_id: str, view_id: str
):
    """The registrar can do it; we cannot, and the schema is why.

    `student_registrations` happily holds a student in two groups of one set — that is the
    `doubled` verdict on the Cohorts page, and it is the registrar's contradiction to
    explain. Our own planning has no such state: `group_assignments` is keyed on
    (cohort, student, scope), so placing somebody again MOVES them.

    Pinned here because the plan scheduled a report for the planning half of this, and a
    report of something that cannot happen is a page nobody can ever act on. If the key
    ever widens, this test is what says the report has become worth writing.
    """
    scope_id, first = block_with_a_group(client, cohort_id)
    second = client.post(
        f"/api/v1/student-database/scopes/{scope_id}/groups", json={"label": "2"}
    ).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)

    place(client, scope_id, STUDENTS[:1], first)
    place(client, scope_id, STUDENTS[:1], second)

    [held] = [row["groups"] for row in students_of(client) if row["studentId"] == STUDENTS[0]]
    assert [group["groupLabel"] for group in held] == ["2"]


def shared_block(client: TestClient, cohort_id: str) -> tuple[str, str]:
    """A set open to every cohort — the languages — with one group in it."""
    scope = client.post(
        f"/api/v1/student-database/cohorts/{cohort_id}/scopes",
        json={"code": "LANG", "openToAll": True},
    ).json()
    group = client.post(
        f"/api/v1/student-database/scopes/{scope['id']}/groups", json={"label": "A1"}
    ).json()
    return scope["id"], group["id"]


def move(client: TestClient, student_ids: list[str], cohort_id: str | None, keep_shared: bool = False):
    return client.post(
        "/api/v1/student-database/students/cohort",
        json={"studentIds": student_ids, "cohortId": cohort_id, "keepShared": keep_shared},
    )


def test_a_move_drops_the_leaving_cohorts_groups_but_may_keep_a_shared_one(
    client: TestClient, cohort_id: str, view_id: str
):
    """The languages are the university's set, not the cohort's.

    A student moving from L1 to L2 does not thereby stop being in French A1, and dropping
    it was silent — a placement nobody knew to redo.
    """
    own_scope, own_group = block_with_a_group(client, cohort_id)
    lang_scope, lang_group = shared_block(client, cohort_id)
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2"}).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, own_scope, STUDENTS[:1], own_group)
    place(client, lang_scope, STUDENTS[:1], lang_group)

    assert move(client, STUDENTS[:1], other, keep_shared=True).status_code == status.HTTP_200_OK

    [held] = [row["groups"] for row in students_of(client) if row["studentId"] == STUDENTS[0]]
    # The cohort's own group is gone; the language group came along.
    assert [group["scopeCode"] for group in held] == ["LANG"]


def test_a_shared_placement_survives_a_move_back_to_a_cohort_it_once_held(
    client: TestClient, cohort_id: str, view_id: str
):
    """A→B→A. The primary key is (cohort, student, scope), so a bare UPDATE would collide.

    Reachable by anybody who corrects a move, and it would have been an IntegrityError in
    front of a coordinator rather than a message.
    """
    lang_scope, lang_group = shared_block(client, cohort_id)
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2"}).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, lang_scope, STUDENTS[:1], lang_group)

    assert move(client, STUDENTS[:1], other, keep_shared=True).status_code == status.HTTP_200_OK
    assert move(client, STUDENTS[:1], cohort_id, keep_shared=True).status_code == status.HTTP_200_OK

    [held] = [row["groups"] for row in students_of(client) if row["studentId"] == STUDENTS[0]]
    assert [group["scopeCode"] for group in held] == ["LANG"]


def test_a_move_that_does_not_ask_to_keep_shared_still_drops_everything(
    client: TestClient, cohort_id: str, view_id: str
):
    """Every existing caller is byte-identical, which is the point of the default."""
    lang_scope, lang_group = shared_block(client, cohort_id)
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2"}).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, lang_scope, STUDENTS[:1], lang_group)

    move(client, STUDENTS[:1], other)

    [held] = [row["groups"] for row in students_of(client) if row["studentId"] == STUDENTS[0]]
    assert held == []


def test_a_placement_is_filed_under_the_students_own_cohort(client: TestClient, cohort_id: str, view_id: str):
    """And not under the cohort that happens to own the set — which is what makes moves safe.

    `group_assignments` is keyed on (cohort, student, scope). If a placement were filed
    under the SET's owner, a student in another cohort would end up with two rows for one
    scope, and `set_cohort(keep_shared=True)` would collide on the primary key while moving
    them — an IntegrityError in front of a coordinator rather than a message. It is not,
    and this is what says so.
    """
    lang_scope, lang_group = shared_block(client, cohort_id)
    other = client.post("/api/v1/student-database/cohorts", json={"name": "L2"}).json()["id"]
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, lang_scope, STUDENTS[:1], lang_group)

    # Moved out and placed again from there: the row follows the student, not the set.
    move(client, STUDENTS[:1], other, keep_shared=True)
    place(client, lang_scope, STUDENTS[:1], lang_group)
    assert move(client, STUDENTS[:1], cohort_id, keep_shared=True).status_code == status.HTTP_200_OK

    [held] = [row["groups"] for row in students_of(client) if row["studentId"] == STUDENTS[0]]
    assert [group["scopeCode"] for group in held] == ["LANG"]


# --------------------------------------------------- a section taught in parts


def course_in(client: TestClient, scope_id: str, code: str = "MATH-351") -> str:
    return client.post(
        f"/api/v1/student-database/scopes/{scope_id}/courses",
        json={"code": code, "name": "Algebra & Cryptography", "component": "CM"},
    ).json()["id"]


def set_part(client: TestClient, group_id: str, course_id: str, crn: str, teacher: str = "", part: int = 1):
    return client.put(
        f"/api/v1/student-database/groups/{group_id}/courses/{course_id}",
        json={"crn": crn, "teacher": teacher, "part": part},
    )


def cell_of(client: TestClient, cohort_id: str, group_id: str, course_id: str) -> dict:
    catalogue = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/catalogue").json()
    for scope in catalogue["scopes"]:
        for group in scope["groups"]:
            if group["id"] == group_id and course_id in (group.get("crns") or {}):
                return group["crns"][course_id]
    raise AssertionError("no such cell")


def test_a_course_handed_over_mid_semester_holds_a_crn_for_each_professor(
    client: TestClient, cohort_id: str
):
    """MATH-351 is Grace Younes to late October and Sudarshan Shinde after it.

    The registrar answers that with a CRN per half. The cell used to hold one, so the
    second half had nowhere to go: a coordinator's only options were to invent a group
    nobody is in, or to leave eleven students' registrations unexaminable.
    """
    scope_id, group_id = block_with_a_group(client, cohort_id, code="CM")
    course_id = course_in(client, scope_id)

    assert set_part(client, group_id, course_id, "23436", "Grace Younes", part=1).status_code == 200
    assert set_part(client, group_id, course_id, "24311", "Sudarshan Shinde", part=2).status_code == 200

    cell = cell_of(client, cohort_id, group_id, course_id)
    assert [(part["part"], part["crn"], part["teacher"]) for part in cell["parts"]] == [
        (1, "23436", "Grace Younes"),
        (2, "24311", "Sudarshan Shinde"),
    ]
    # The first part still stands at the top level, so everything written before parts
    # existed goes on being right about a section taught by one person.
    assert cell["crn"] == "23436"
    assert cell["teacher"] == "Grace Younes"


def test_each_part_carries_its_own_hours_and_weeks(client: TestClient, cohort_id: str):
    # The whole reason the halves are told apart: they are different teaching, with
    # different hours belonging to different people.
    scope_id, group_id = block_with_a_group(client, cohort_id, code="CM")
    course_id = course_in(client, scope_id)
    set_part(client, group_id, course_id, "23436", part=1)
    set_part(client, group_id, course_id, "24311", part=2)

    for part, hours, weeks in ((1, "15", "weeks 1-8"), (2, "15", "weeks 7-14")):
        answer = client.patch(
            f"/api/v1/student-database/groups/{group_id}/courses/{course_id}",
            json={"part": part, "hours": hours, "weeks": weeks},
        )
        assert answer.status_code == 200, answer.text

    cell = cell_of(client, cohort_id, group_id, course_id)
    assert [(part["hours"], part["weeks"]) for part in cell["parts"]] == [
        ("15", "weeks 1-8"),
        ("15", "weeks 7-14"),
    ]


def test_clearing_one_part_leaves_the_other_rather_than_emptying_the_cell(
    client: TestClient, cohort_id: str
):
    # Undoing a split is not dropping the course. Deleting the whole cell here would take
    # the half that is still taught with it, silently.
    scope_id, group_id = block_with_a_group(client, cohort_id, code="CM")
    course_id = course_in(client, scope_id)
    set_part(client, group_id, course_id, "23436", part=1)
    set_part(client, group_id, course_id, "24311", part=2)

    set_part(client, group_id, course_id, "", part=2)

    cell = cell_of(client, cohort_id, group_id, course_id)
    assert [part["crn"] for part in cell["parts"]] == ["23436"]


def test_a_part_is_numbered_from_one_and_a_typo_is_refused(client: TestClient, cohort_id: str):
    # The cap is what stops a mistyped part number quietly creating a hundredth section.
    scope_id, group_id = block_with_a_group(client, cohort_id, code="CM")
    course_id = course_in(client, scope_id)

    assert set_part(client, group_id, course_id, "23436", part=0).status_code == 422
    assert set_part(client, group_id, course_id, "23436", part=99).status_code == 422


# ------------------------------------------------------------------ exemptions


def test_an_exemption_counts_against_the_section_and_not_against_the_group(
    client: TestClient, cohort_id: str, view_id: str
):
    """They are still in the group; they just do not take one of its courses.

    So the group's own count is untouched — it is the same people at the same seats for
    everything else in the set — and it is the section that teaches one fewer, which is
    the number a room is booked against.
    """
    scope_id, group_id = block_with_a_group(client, cohort_id)
    course_id = course_in(client, scope_id, code="MATH-011")
    set_part(client, group_id, course_id, "23652")
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, scope_id, STUDENTS, group_id)

    client.put(
        f"/api/v1/student-database/students/{STUDENTS[0]}/exemptions/{course_id}",
        json={"reason": "Credit from SUAD"},
    )

    catalogue = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/catalogue").json()
    group = catalogue["scopes"][0]["groups"][0]
    assert group["assigned"] == len(STUDENTS)
    assert group["crns"][course_id]["exempt"] == 1


def test_an_exemption_is_listed_with_the_reason_it_was_given(client: TestClient, cohort_id: str, view_id: str):
    # A reason in the coordinator's own words, because the reasons vary and an enumeration
    # of them would be wrong within a year — and an exemption nobody can account for later
    # is one nobody dares lift.
    scope_id, group_id = block_with_a_group(client, cohort_id)
    course_id = course_in(client, scope_id, code="MATH-011")
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, scope_id, STUDENTS, group_id)
    client.put(
        f"/api/v1/student-database/students/{STUDENTS[0]}/exemptions/{course_id}",
        json={"reason": "Credit from SUAD"},
    )

    listed = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/exemptions").json()["exemptions"]

    assert [(row["studentId"], row["courseCode"], row["reason"]) for row in listed] == [
        (STUDENTS[0], "MATH-011", "Credit from SUAD")
    ]


def test_an_exemption_survives_a_move_between_groups_of_the_same_set(
    client: TestClient, cohort_id: str, view_id: str
):
    # It is about the student and the course, not about where they sit. Moving somebody
    # from TD 1 to TD 2 does not change what they have credit for, and an exemption that
    # evaporated on a move would come back as a warning nobody could explain.
    scope_id, first = block_with_a_group(client, cohort_id)
    second = client.post(f"/api/v1/student-database/scopes/{scope_id}/groups", json={"label": "2"}).json()["id"]
    course_id = course_in(client, scope_id, code="MATH-011")
    set_part(client, first, course_id, "23652")
    set_part(client, second, course_id, "23653")
    in_cohort(client, view_id, cohort_id, STUDENTS)
    place(client, scope_id, STUDENTS[:1], first)
    client.put(f"/api/v1/student-database/students/{STUDENTS[0]}/exemptions/{course_id}", json={"reason": ""})

    place(client, scope_id, STUDENTS[:1], second)

    catalogue = client.get(f"/api/v1/student-database/cohorts/{cohort_id}/catalogue").json()
    groups = {group["id"]: group for group in catalogue["scopes"][0]["groups"]}
    assert groups[second]["crns"][course_id]["exempt"] == 1
    assert groups[first]["crns"][course_id]["exempt"] == 0
