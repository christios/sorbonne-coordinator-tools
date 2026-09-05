"""The portal's courses, teachers and registrations: pulled by filter, reconciled, compared.

What matters is the same as for students — what a pull returned is in the portal, what a
filter held and the pull dropped has left — plus the one thing these lists are for: saying
where the registrar's registrations differ from the groups we placed a cohort in.
"""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import portal as api
from sorbonne.api import student_database as student_api
from sorbonne.main import app
from sorbonne.services.portal_lists import _SECTION_TITLE, PortalListStore
from sorbonne.services.student_database import StudentDatabase
from tests.conftest import TEST_DATABASE_URL

BASE = "/api/v1/portal"
TERM = "262710"
HUB_TERM = "term-1"


@pytest.fixture
def database() -> StudentDatabase:
    return StudentDatabase(TEST_DATABASE_URL)


@pytest.fixture(autouse=True)
def empty_tables() -> None:
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        for table in (
            "portal_filters",
            "portal_courses",
            "portal_teachers",
            "active_teachers",
            "active_courses",
            "active_course_crns",
            "student_registrations",
            "term_links",
            "students",
            "student_cohorts",
        ):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608


@pytest.fixture
def client(database: StudentDatabase) -> TestClient:
    store = PortalListStore(TEST_DATABASE_URL)
    app.dependency_overrides[api.get_store] = lambda: store
    app.dependency_overrides[api.get_database] = lambda: database
    app.dependency_overrides[student_api.get_database] = lambda: database
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def make_filter(client: TestClient, kind: str, name: str = "SCEN", criteria: dict | None = None) -> dict:
    response = client.post(
        f"{BASE}/filters", json={"kind": kind, "name": name, "filter": criteria or {"DEPT_CODE": ["SCEN"]}}
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def course(crn: str, code: str, teacher: str = "Dr Maaz") -> dict:
    return {
        "termCode": TERM,
        "crn": crn,
        "courseCode": code,
        "title": f"Course {code}",
        "teacherName": teacher,
        "registered": 12,
    }


# -------------------------------------------------------------------- filters


def test_a_filter_is_one_kind_and_named_once(client: TestClient):
    made = make_filter(client, "courses")
    assert made["kind"] == "courses"
    assert make_filter(client, "teachers") is not None  # the same name on another list is fine
    dup = client.post(f"{BASE}/filters", json={"kind": "courses", "name": "SCEN", "filter": {"DEPT_CODE": ["SCEN"]}})
    assert dup.status_code == status.HTTP_409_CONFLICT
    assert client.get(f"{BASE}/filters", params={"kind": "courses"}).json()["filters"][0]["id"] == made["id"]


def test_a_filter_may_name_a_description_the_portal_filters_by(client: TestClient):
    made = make_filter(client, "teachers", "Flying", {"TEACHER_TYPE_DESC": ["Flying-Professional Assignment"]})
    assert made["filter"] == {"TEACHER_TYPE_DESC": ["Flying-Professional Assignment"]}


def test_a_filter_refuses_a_sentence(client: TestClient):
    response = client.post(
        f"{BASE}/filters", json={"kind": "courses", "name": "x", "filter": {"DEPT_CODE": ["drop table; --"]}}
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# -------------------------------------------------------------------- courses


def test_courses_are_kept_and_a_dropped_one_is_marked_gone(client: TestClient):
    made = make_filter(client, "courses")
    first = client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={"rows": [course("22151", "MATH-001"), course("23652", "MATH-011")]},
    ).json()
    assert first == {"seen": 2, "added": 2, "missing": 0, "syncedAt": first["syncedAt"]}

    second = client.post(
        f"{BASE}/filters/{made['id']}/sync/courses", json={"rows": [course("22151", "MATH-001", "Dr Ahmed")]}
    ).json()
    assert (second["seen"], second["added"], second["missing"]) == (1, 0, 1)

    held = {row["crn"]: row for row in client.get(f"{BASE}/courses", params={"term": TERM}).json()["courses"]}
    assert held["22151"]["teacherName"] == "Dr Ahmed"
    assert held["22151"]["status"] == "in_portal"
    assert held["23652"]["status"] == "not_in_portal"
    assert client.get(f"{BASE}/filters", params={"kind": "courses"}).json()["filters"][0]["held"] == 1


def test_a_courses_pull_cannot_land_on_a_teachers_filter(client: TestClient):
    made = make_filter(client, "teachers")
    response = client.post(f"{BASE}/filters/{made['id']}/sync/courses", json={"rows": [course("22151", "MATH-001")]})
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ------------------------------------------------------------------- teachers


def test_teachers_are_kept_without_personal_fields(client: TestClient):
    made = make_filter(client, "teachers")
    rows = [
        {
            "teacherId": "a00015756",
            "fullName": "Ahlem TRABELSI",
            "type": "Part-Time",
            "psuadEmail": "Ahlem.Trabelsi@sorbonne.ae",
            "persEmail": "x@gmail.com",
        }
    ]
    client.post(f"{BASE}/filters/{made['id']}/sync/teachers", json={"rows": rows})

    [teacher] = client.get(f"{BASE}/teachers").json()["teachers"]
    assert teacher["teacherId"] == "A00015756"
    assert "persEmail" not in teacher and "x@gmail.com" not in str(teacher)


# ------------------------------------------------------------ active teachers


def seed_teachers(client: TestClient) -> None:
    made = make_filter(client, "teachers")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/teachers",
        json={
            "rows": [
                {
                    "teacherId": "A001",
                    "fullName": "Ahlem Trabelsi",
                    "type": "Part-Time",
                    "psuadEmail": "ahlem@sorbonne.ae",
                },
                {"teacherId": "A002", "fullName": "Bilal Maaz", "type": "Full Time", "psuadEmail": "bilal@sorbonne.ae"},
            ]
        },
    )


def test_active_teachers_are_chosen_from_the_portal_and_carry_its_facts(client: TestClient):
    seed_teachers(client)

    report = client.post(f"{BASE}/active-teachers", json={"portalTeacherIds": ["a001", "A999"]}).json()

    assert report == {"added": 1, "linked": 0, "skipped": 1}
    [active] = client.get(f"{BASE}/active-teachers").json()["teachers"]
    assert active["fullName"] == "Ahlem Trabelsi"
    assert active["type"] == "Part-Time"
    assert active["source"] == "portal"
    # Choosing them again is not a second row.
    assert client.post(f"{BASE}/active-teachers", json={"portalTeacherIds": ["A001"]}).json()["skipped"] == 1


def test_a_part_time_record_with_the_same_email_is_the_same_person(client: TestClient):
    seed_teachers(client)
    client.post(f"{BASE}/active-teachers", json={"portalTeacherIds": ["A001"]})

    report = client.post(
        f"{BASE}/active-teachers",
        json={
            "partTime": [
                {"id": "pt-1", "fullName": "Ahlem Trabelsi", "email": "AHLEM@sorbonne.ae"},
                {"id": "pt-2", "fullName": "Carla Nasr", "email": "carla@example.org"},
            ]
        },
    ).json()

    assert report == {"added": 1, "linked": 1, "skipped": 0}
    held = {row["fullName"]: row for row in client.get(f"{BASE}/active-teachers").json()["teachers"]}
    assert held["Ahlem Trabelsi"]["source"] == "both"
    assert held["Ahlem Trabelsi"]["partTimeTeacherId"] == "pt-1"
    assert held["Carla Nasr"]["source"] == "part-time"
    assert held["Carla Nasr"]["type"] == ""


def test_an_active_teacher_can_be_removed(client: TestClient):
    seed_teachers(client)
    client.post(f"{BASE}/active-teachers", json={"portalTeacherIds": ["A002"]})
    [active] = client.get(f"{BASE}/active-teachers").json()["teachers"]

    assert client.delete(f"{BASE}/active-teachers/{active['id']}").status_code == status.HTTP_204_NO_CONTENT
    assert client.get(f"{BASE}/active-teachers").json() == {"teachers": []}
    assert client.delete(f"{BASE}/active-teachers/{active['id']}").status_code == status.HTTP_404_NOT_FOUND


# ------------------------------------------------------------ active courses


def seed_courses(client: TestClient) -> None:
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={
            "rows": [
                course("22151", "MATH-001"),
                course("22152", "MATH-001", teacher="Dr Haddad"),
                {**course("22160", "PHYS-001"), "termCode": "262720", "title": "Mechanics"},
            ]
        },
    )


def test_active_courses_are_chosen_from_the_portal_by_code(client: TestClient):
    seed_courses(client)

    report = client.post(f"{BASE}/active-courses", json={"courseCodes": ["math-001", "PHYS-001", "CHEM-999"]}).json()

    assert report == {"added": 2, "skipped": 1}
    held = client.get(f"{BASE}/active-courses").json()["courses"]
    assert [(c["courseCode"], c["title"], c["crnCount"], c["lastTerm"]) for c in held] == [
        ("MATH-001", "Course MATH-001", 2, TERM),
        ("PHYS-001", "Mechanics", 1, "262720"),
    ]
    # Choosing the course took its CRNs into the register with it: two of one, one of the other.
    assert [row["crn"] for row in client.get(f"{BASE}/active-crns").json()["crns"]] == ["22151", "22152", "22160"]
    # Choosing a course again is not a second row.
    assert client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]}).json()["skipped"] == 1


def test_choosing_a_course_takes_its_crns_into_the_register(client: TestClient):
    seed_courses(client)

    client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]})

    register = client.get(f"{BASE}/active-crns").json()["crns"]
    assert [(row["crn"], row["courseCode"], row["parentCrn"]) for row in register] == [
        ("22151", "MATH-001", ""),
        ("22152", "MATH-001", ""),
    ]
    # The portal's facts travel with the row, so the page never has to join them itself.
    assert register[0]["portalTitle"] == "Course MATH-001"
    assert register[0]["teacherName"] == "Dr Maaz"
    assert register[0]["portalStatus"] == "in_portal"


def test_a_parent_crn_is_a_link_to_the_portal_s_own_row(client: TestClient):
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={
            "rows": [
                course("22151", "MATH-001"),
                course("22152", "MATH-001", teacher="Dr Haddad"),
                # The registrar's row for the course itself: plain name, no teacher, nobody in it.
                {**course("24226", "MATH-001", teacher=""), "title": "Pre Calculus 1", "registered": 0},
            ]
        },
    )
    client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]})

    # The course is named after its own row, and that row's CRN is offered as the parent.
    [held] = client.get(f"{BASE}/active-courses").json()["courses"]
    assert (held["title"], held["portalParentCrn"], held["crnCount"]) == ("Pre Calculus 1", "24226", 3)

    register = client.get(f"{BASE}/active-crns").json()["crns"]
    section = next(row for row in register if row["crn"] == "22151")
    linked = client.patch(f"{BASE}/active-crns/{section['id']}", json={"parentCrn": "24226"}).json()
    assert (linked["parentCrn"], linked["parentTitle"], linked["parentStatus"]) == (
        "24226",
        "Pre Calculus 1",
        "in_portal",
    )

    # A parent nothing in the portal answers to is shown as the dangling link it is.
    dangling = client.patch(f"{BASE}/active-crns/{section['id']}", json={"parentCrn": "24229"}).json()
    assert (dangling["parentCrn"], dangling["parentStatus"]) == ("24229", "not_listed")


@pytest.mark.parametrize(
    ("title", "is_section"),
    [
        # The registrar's own rows for a course, which carry its plain name.
        ("Geometric Optics", False),
        ("Graphs and Random Graphs", False),
        ("Pre Calculus 1", False),
        ("Mathematics Readiness course", False),
        ("Integration to World of Work 1", False),
        ("Intro to AI & ML -Tech Foundat", False),
        ("Mechanics-Physics 1", False),
        # And the rows for one group of it.
        ("Geometric Optics -CM", True),
        ("Geometric Optics G.B-TP", True),
        ("Pre-Calculus 1 G.A-CM", True),
        ("Analysis 1-TD", True),
        ("Maths Readiness G.5-TD", True),
        ("Intg to Wrld of Wrk1 G.1", True),
        ("Computer Science CM", True),
    ],
)
def test_a_group_marker_needs_its_dot_or_its_digit(title: str, is_section: bool):
    """A G and some letters is a word, not a group: "Geometric Optics" names a course."""
    assert bool(_SECTION_TITLE.search(title)) is is_section


def test_the_register_says_which_crns_are_parents_and_which_are_children(client: TestClient):
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={
            "rows": [
                course("22151", "MATH-001"),
                course("22152", "MATH-001", teacher="Dr Haddad"),
                {**course("24226", "MATH-001", teacher=""), "title": "Pre Calculus 1", "registered": 0},
            ]
        },
    )
    client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]})
    register = {row["crn"]: row for row in client.get(f"{BASE}/active-crns").json()["crns"]}
    for crn in ("22151", "22152"):
        client.patch(f"{BASE}/active-crns/{register[crn]['id']}", json={"parentCrn": "24226"})

    after = {row["crn"]: row for row in client.get(f"{BASE}/active-crns").json()["crns"]}

    # The one the sections hang from counts them; each section knows it is a child.
    assert (after["24226"]["childCount"], after["24226"]["parentCrn"]) == (2, "")
    assert (after["22151"]["childCount"], after["22151"]["parentCrn"]) == (0, "24226")
    assert (after["22152"]["childCount"], after["22152"]["parentCrn"]) == (0, "24226")


def test_a_parent_cannot_have_a_parent_and_a_child_cannot_be_one(client: TestClient):
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={
            "rows": [
                course("22151", "MATH-001"),
                course("22152", "MATH-001", teacher="Dr Haddad"),
                {**course("24226", "MATH-001", teacher=""), "title": "Pre Calculus 1", "registered": 0},
            ]
        },
    )
    client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]})
    register = {row["crn"]: row for row in client.get(f"{BASE}/active-crns").json()["crns"]}
    client.patch(f"{BASE}/active-crns/{register['22151']['id']}", json={"parentCrn": "24226"})

    # The register is two deep: the top of the course cannot hang from one of its sections…
    refused = client.patch(f"{BASE}/active-crns/{register['24226']['id']}", json={"parentCrn": "22152"})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "parent of 1" in refused.json()["detail"]

    # …and nothing may hang from a section that already hangs from something.
    chained = client.patch(f"{BASE}/active-crns/{register['22152']['id']}", json={"parentCrn": "22151"})
    assert chained.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "hangs from 24226 itself" in chained.json()["detail"]

    itself = client.patch(f"{BASE}/active-crns/{register['22152']['id']}", json={"parentCrn": "22152"})
    assert itself.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    # Clearing a parent is always allowed, which is how a mistake is undone.
    cleared = client.patch(f"{BASE}/active-crns/{register['22151']['id']}", json={"parentCrn": ""})
    assert cleared.status_code == status.HTTP_200_OK
    assert cleared.json()["parentCrn"] == ""


def test_the_register_says_where_the_portal_has_moved_away_from_it(client: TestClient):
    made = make_filter(client, "courses")
    sync = lambda rows: client.post(f"{BASE}/filters/{made['id']}/sync/courses", json={"rows": rows})  # noqa: E731
    sync([course("22151", "MATH-001"), course("22152", "MATH-001")])
    client.post(f"{BASE}/active-courses", json={"courseCodes": ["MATH-001"]})

    # The registrar drops one section and makes another.
    sync([course("22151", "MATH-001"), course("22153", "MATH-001")])
    report = client.get(f"{BASE}/register-check").json()

    assert [row["crn"] for row in report["gone"]] == ["22152"]
    assert [row["crn"] for row in report["arrived"]] == ["22153"]
    assert report["unregistered"] == []

    # Taking the new one in empties that half of the report.
    client.post(f"{BASE}/active-crns", json={"crns": [{"termCode": TERM, "crn": "22153"}]})
    after = client.get(f"{BASE}/register-check").json()
    assert after["arrived"] == []
    assert [row["crn"] for row in after["gone"]] == ["22152"]


def test_an_active_course_can_be_added_by_hand_and_given_its_ue(client: TestClient):
    report = client.post(
        f"{BASE}/active-courses", json={"byHand": [{"courseCode": "lang-a1", "title": "French A1"}]}
    ).json()
    assert report == {"added": 1, "skipped": 0}
    [held] = client.get(f"{BASE}/active-courses").json()["courses"]
    assert (held["courseCode"], held["title"], held["crnCount"]) == ("LANG-A1", "French A1", 0)

    changed = client.patch(
        f"{BASE}/active-courses/{held['id']}", json={"title": "French A1", "ue": "UL1LA001"}
    ).json()
    assert changed["ue"] == "UL1LA001"

    assert client.delete(f"{BASE}/active-courses/{held['id']}").status_code == status.HTTP_204_NO_CONTENT
    assert client.get(f"{BASE}/active-courses").json() == {"courses": []}
    assert client.patch(f"{BASE}/active-courses/{held['id']}", json={}).status_code == status.HTTP_404_NOT_FOUND


# -------------------------------------------------------------- registrations


def test_a_registration_is_a_student_id_and_a_crn_and_nothing_else(client: TestClient, database: StudentDatabase):
    made = make_filter(client, "registrations")
    rows = [
        {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001", "fullName": "Amira Haddad"},
        {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        {"studentId": "A002", "crn": "22151", "courseCode": "MATH-001"},
    ]
    report = client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations", json={"termCode": TERM, "rows": rows}
    ).json()
    assert (report["seen"], report["rows"], report["added"]) == (2, 3, 2)

    held = client.get(f"{BASE}/students/A001/registrations").json()["registrations"]
    assert [row["crn"] for row in held] == ["22151", "23652"]
    with database.engine.connect() as connection:
        columns = {
            row[0]
            for row in connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'student_registrations'")
            )
        }
    assert not {"full_name", "name"} & columns

    # Next pull: A001 dropped a course, A002 left the population.
    again = client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations", json={"termCode": TERM, "rows": rows[:1]}
    ).json()
    assert again["missing"] == 1
    held = {
        row["crn"]: row["status"] for row in client.get(f"{BASE}/students/A001/registrations").json()["registrations"]
    }
    assert held == {"22151": "in_portal", "23652": "not_in_portal"}
    assert client.get(f"{BASE}/students/A002/registrations").json()["registrations"][0]["status"] == "not_in_portal"


# ----------------------------------------------------------------- term links


def test_a_semester_can_be_linked_to_its_portal_term(client: TestClient):
    make_filter(client, "courses")
    assert client.get(f"{BASE}/term-links").json() == {"links": {}}
    assert client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM}).json() == {
        "termId": HUB_TERM,
        "portalTermCode": TERM,
    }
    assert client.get(f"{BASE}/term-links").json() == {"links": {HUB_TERM: TERM}}
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": ""})
    assert client.get(f"{BASE}/term-links").json() == {"links": {}}


def test_the_crns_of_a_linked_semester_come_keyed_by_crn(client: TestClient):
    made = make_filter(client, "courses")
    client.post(f"{BASE}/filters/{made['id']}/sync/courses", json={"rows": [course("22151", "MATH-001")]})
    assert client.get(f"{BASE}/terms/{HUB_TERM}/crns").json() == {"portalTermCode": "", "crns": {}}
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    payload = client.get(f"{BASE}/terms/{HUB_TERM}/crns").json()
    assert payload["portalTermCode"] == TERM
    assert payload["crns"]["22151"]["teacherName"] == "Dr Maaz"


# ------------------------------------------------------------- the comparison


def build_cohort(database: StudentDatabase) -> str:
    """Foundation Year on term-1: CM A (22151) and TD 1 (23652); A001 and A002 placed in both."""
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    with database.engine.begin() as connection:
        for student in ("A001", "A002", "A003"):
            connection.execute(
                text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)
                        VALUES (:id, 'in_portal', :cohort, 'now', 'now', 'now')"""),
                {"id": student, "cohort": cohort["id"]},
            )
    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id=HUB_TERM)
    td = database.add_scope(cohort["id"], code="TD", name="Tutorials", term_id=HUB_TERM)
    maths = database.add_course(cm, code="MATH-001")
    algorithms = database.add_course(td, code="MATH-011")
    group_a = database.add_group(cm, label="A")
    group_1 = database.add_group(td, label="1")
    database.set_cell(group_id=group_a, course_id=maths, crn="22151")
    database.set_cell(group_id=group_1, course_id=algorithms, crn="23652")
    for student in ("A001", "A002"):
        database.assign(student_id=student, scope_id=cm, group_id=group_a)
        database.assign(student_id=student, scope_id=td, group_id=group_1)
    return cohort["id"]


def test_the_check_says_where_the_registrar_differs_from_our_groups(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={
            "termCode": TERM,
            "rows": [
                # A001: right lecture, wrong tutorial section
                {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23653", "courseCode": "MATH-011"},
                # A002: lecture missing, tutorial right, plus a language course that is not ours
                {"studentId": "A002", "crn": "23652", "courseCode": "MATH-011"},
                {"studentId": "A002", "crn": "23302", "courseCode": "SCEN-101"},
                # A003: in no group, yet registered in the lecture
                {"studentId": "A003", "crn": "22151", "courseCode": "MATH-001"},
            ],
        },
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    assert sorted(
        (m["studentId"], m["courseCode"], m["kind"], m["expected"], tuple(m["registered"])) for m in found
    ) == [
        ("A001", "MATH-011", "wrong", "23652", ("23653",)),
        ("A002", "MATH-001", "missing", "22151", ()),
        ("A003", "MATH-001", "unplaced", "", ("22151",)),
    ]


def test_a_student_no_pull_has_returned_is_not_judged(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    # No registrations pull at all: nothing to hold anyone against.
    assert client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json() == {"mismatches": []}


def test_without_a_term_link_there_is_no_comparison(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database)
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={"termCode": TERM, "rows": [{"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"}]},
    )
    assert client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json() == {"mismatches": []}
