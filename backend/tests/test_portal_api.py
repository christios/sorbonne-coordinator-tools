"""The portal's courses, teachers and registrations: pulled by filter, reconciled, compared.

What matters is the same as for students — what a pull returned is in the portal, what a
filter held and the pull dropped has left — plus the one thing these lists are for: saying
where the registrar's registrations differ from the groups we placed a cohort in.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import portal as api
from sorbonne.api import student_database as student_api
from sorbonne.main import app
from sorbonne.services.facility_timetable import FacilityTimetableStore
from sorbonne.services.portal_lists import _SECTION_TITLE, _expected_on, PortalListStore
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
            "facility_meetings",
            "facility_sections",
            "facility_pulls",
            # A settled collision outlives the pull it was about, which is the point — and
            # exactly why a test that settles one must not leave it for the next.
            "section_collision_notes",
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
    # Without this the facilities routes reach for config.database_url — the DEVELOPER's
    # own database — so the tests would read and write real local data and leak state
    # between themselves. Every store the router builds must be overridden, not most.
    app.dependency_overrides[api.get_facilities] = lambda: FacilityTimetableStore(TEST_DATABASE_URL)
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


def test_a_course_teacher_reads_as_a_name_not_as_a_list(client: TestClient):
    """The portal ends its list of teachers with a comma even when only one name is in it."""
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={
            "rows": [
                course("22151", "MATH-001", "Bilal Maaz,"),
                course("23652", "MATH-011", "Wafa Ahmed , Giulia Demasi ,"),
                course("23653", "MATH-012", ","),
            ]
        },
    )

    listed = client.get(f"{BASE}/courses", params={"term": TERM}).json()["courses"]
    held = {row["crn"]: row["teacherName"] for row in listed}
    assert held["22151"] == "Bilal Maaz"
    assert held["23652"] == "Wafa Ahmed, Giulia Demasi"  # two teachers still read as two
    assert held["23653"] == ""


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


def test_a_part_timer_the_portal_has_started_returning_is_offered_as_a_match(client: TestClient):
    seed_teachers(client)
    # Brought from the part-time database with the personal address they had then, which is
    # why no e-mail match will save us later.
    client.post(
        f"{BASE}/active-teachers",
        json={"partTime": [{"id": "pt-1", "fullName": "Dr Ahlem TRABELSI", "email": "ahlem@gmail.com"}]},
    )

    [match] = client.get(f"{BASE}/active-teachers/matches").json()["matches"]

    assert match["activeName"] == "Dr Ahlem TRABELSI"
    assert match["portalTeacherId"] == "A001"
    assert match["portalEmail"] == "ahlem@sorbonne.ae"

    # Linking makes them one row, and the portal is the one that leads.
    active_id = client.get(f"{BASE}/active-teachers").json()["teachers"][0]["id"]
    linked = client.post(f"{BASE}/active-teachers/{active_id}/link", json={"portalTeacherId": "a001"})
    assert linked.status_code == status.HTTP_200_OK

    [held] = client.get(f"{BASE}/active-teachers").json()["teachers"]
    assert held["source"] == "both"
    assert held["partTimeTeacherId"] == "pt-1"
    # The portal's spelling and the portal's address, not the ones the department typed.
    assert held["fullName"] == "Ahlem Trabelsi"
    assert held["email"] == "ahlem@sorbonne.ae"
    assert held["type"] == "Part-Time"
    # And nothing is offered any more.
    assert client.get(f"{BASE}/active-teachers/matches").json()["matches"] == []


def test_a_name_two_portal_profiles_answer_to_is_not_offered(client: TestClient):
    seed_teachers(client)
    second = make_filter(client, "teachers", name="Another list")
    client.post(
        f"{BASE}/filters/{second['id']}/sync/teachers",
        json={"rows": [{"teacherId": "A003", "fullName": "Ahlem Trabelsi", "psuadEmail": "ahlem2@sorbonne.ae"}]},
    )
    client.post(
        f"{BASE}/active-teachers",
        json={"partTime": [{"id": "pt-1", "fullName": "Ahlem Trabelsi", "email": "ahlem@gmail.com"}]},
    )

    # Two people of that name in the portal: which one is a question for a person, not a guess.
    assert client.get(f"{BASE}/active-teachers/matches").json()["matches"] == []


def test_a_portal_profile_can_only_be_one_person_on_the_list(client: TestClient):
    seed_teachers(client)
    client.post(f"{BASE}/active-teachers", json={"portalTeacherIds": ["A001"]})
    client.post(
        f"{BASE}/active-teachers",
        json={"partTime": [{"id": "pt-9", "fullName": "Somebody Else", "email": "else@example.org"}]},
    )
    other = next(
        row for row in client.get(f"{BASE}/active-teachers").json()["teachers"] if row["fullName"] == "Somebody Else"
    )

    answer = client.post(f"{BASE}/active-teachers/{other['id']}/link", json={"portalTeacherId": "A001"})

    assert answer.status_code == status.HTTP_409_CONFLICT
    # A profile the portal does not hold, and a teacher the list does not hold.
    unknown = client.post(f"{BASE}/active-teachers/{other['id']}/link", json={"portalTeacherId": "A404"})
    nobody = client.post(f"{BASE}/active-teachers/nope/link", json={"portalTeacherId": "A001"})
    assert unknown.status_code == status.HTTP_404_NOT_FOUND
    assert nobody.status_code == status.HTTP_404_NOT_FOUND


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


def test_a_course_says_whether_it_is_taught_to_both_degrees_at_once(client: TestClient):
    """L2 and L3 are one cohort reading two degrees; some of their courses are shared."""
    client.post(f"{BASE}/active-courses", json={"byHand": [{"courseCode": "MATH-222", "title": "Analysis 1"}]})
    [held] = client.get(f"{BASE}/active-courses").json()["courses"]

    changed = client.patch(
        f"{BASE}/active-courses/{held['id']}", json={"title": held["title"], "ue": "", "mutualized": "yes"}
    ).json()
    assert changed["mutualized"] == "yes"
    assert client.get(f"{BASE}/active-courses").json()["courses"][0]["mutualized"] == "yes"

    # Taught to one degree alone is the other answer; anything else is neither.
    assert client.patch(
        f"{BASE}/active-courses/{held['id']}", json={"title": "", "ue": "", "mutualized": "no"}
    ).json()["mutualized"] == "no"
    refused = client.patch(
        f"{BASE}/active-courses/{held['id']}", json={"title": "", "ue": "", "mutualized": "sometimes"}
    )
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


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
    # Nobody has said whether it is mutualized, and that is a state of its own.
    assert changed["mutualized"] == ""

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


def build_cohort(database: StudentDatabase, maths_in_tutorials: str = "") -> str:
    """Foundation Year on term-1: CM A (22151) and TD 1 (23652); A001 and A002 placed in both.

    `maths_in_tutorials` gives the tutorial group a section of MATH-001 too, the way a
    course taught as a lecture and a tutorial really is.
    """
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
    if maths_in_tutorials:
        database.set_cell(group_id=group_1, course_id=database.add_course(td, code="MATH-001"), crn=maths_in_tutorials)
    for student in ("A001", "A002"):
        database.assign(student_id=student, scope_id=cm, group_id=group_a)
        database.assign(student_id=student, scope_id=td, group_id=group_1)
    return cohort["id"]


def day(offset: int) -> str:
    """A date relative to the day the check judges, which is today in UTC."""
    return (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()


def timetable(client: TestClient, windows: dict[str, tuple[int, int]]) -> None:
    """Tell the store when each of these sections runs, as a complete pull would.

    Two meetings per section — the first and the last day — because the window is all the
    expectation rule reads and a section with one meeting would not have one.
    """
    client.post(
        f"{BASE}/facility-timetable",
        json={
            "termCode": TERM,
            "asked": sorted(windows),
            "sections": [
                {
                    "crn": crn,
                    "ours": True,
                    "meetings": [
                        {"meetsOn": day(first), "startsAt": "08:30", "endsAt": "10:00"},
                        {"meetsOn": day(last), "startsAt": "08:30", "endsAt": "10:00"},
                    ],
                }
                for crn, (first, last) in sorted(windows.items())
            ],
            "silent": [],
            "failed": [],
            "complete": True,
        },
    )


def registrations(client: TestClient, rows: list[dict[str, str]]) -> None:
    made = make_filter(client, "registrations")
    client.post(f"{BASE}/filters/{made['id']}/sync/registrations", json={"termCode": TERM, "rows": rows})


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
        (m["studentId"], m["courseCode"], m["kind"], tuple(m["expected"]), tuple(m["registered"])) for m in found
    ) == [
        ("A001", "MATH-011", "wrong", ("23652",), ("23653",)),
        ("A002", "MATH-001", "missing", ("22151",), ()),
        ("A003", "MATH-001", "unplaced", (), ("22151",)),
    ]


def test_a_course_taught_twice_over_expects_both_of_its_sections(client: TestClient, database: StudentDatabase):
    """A lecture group and a tutorial group may carry the same course: both are right.

    Foundation Year MATH-001 is taught as CM B and TD 2 at once, and the registrar
    registers a student in both. Keeping only one of them read every correctly registered
    student as registered somewhere they should not be.
    """
    # The tutorial group carries MATH-001 as well; A001 and A002 are in both groups.
    cohort_id = build_cohort(database, maths_in_tutorials="23561")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={
            "termCode": TERM,
            "rows": [
                # A001 is registered in both sections of MATH-001, which is exactly right.
                {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23561", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
                # A002 has the lecture but not the tutorial: one section is genuinely absent.
                {"studentId": "A002", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A002", "crn": "23652", "courseCode": "MATH-011"},
            ],
        },
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    seen = [(m["studentId"], m["courseCode"], m["kind"], tuple(m["expected"]), tuple(m["registered"])) for m in found]
    assert seen == [("A002", "MATH-001", "missing", ("22151", "23561"), ("22151",))]


def test_two_groups_of_one_set_is_flagged_however_they_were_placed(
    client: TestClient, database: StudentDatabase
):
    """A student sits in one group of a set; the registrar having them in two is a fault.

    It needs no opinion from us about where they belong — it is a contradiction inside the
    registration — so it is found for a student we placed and for one we never placed.
    """
    cohort_id = build_cohort(database)
    # A second tutorial group, which nobody is placed in.
    with database.engine.begin() as connection:
        td = connection.execute(text("SELECT id FROM cohort_scopes WHERE code = 'TD'")).scalar_one()
        course = connection.execute(text("SELECT id FROM scope_courses WHERE code = 'MATH-011'")).scalar_one()
    second = database.add_group(td, label="2")
    database.set_cell(group_id=second, course_id=course, crn="23653")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={
            "termCode": TERM,
            "rows": [
                # Placed in TD 1, and the registrar has them in TD 1 and TD 2 both.
                {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
                {"studentId": "A001", "crn": "23653", "courseCode": "MATH-011"},
                # Never placed in anything, and in two tutorial groups all the same.
                {"studentId": "A003", "crn": "23652", "courseCode": "MATH-011"},
                {"studentId": "A003", "crn": "23653", "courseCode": "MATH-011"},
            ],
        },
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]
    doubled = [m for m in found if m["kind"] == "doubled"]

    assert [(m["studentId"], m["scopeCode"], m["courseCode"], tuple(m["registered"])) for m in doubled] == [
        ("A001", "TD", "1, 2", ("23652", "23653")),
        ("A003", "TD", "1, 2", ("23652", "23653")),
    ]


def test_one_group_of_a_set_is_several_registrations_and_no_fault(
    client: TestClient, database: StudentDatabase
):
    """A set carries several courses, so one group of it is a CRN for each — all correct."""
    cohort_id = build_cohort(database, maths_in_tutorials="23561")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={
            "termCode": TERM,
            "rows": [
                # Both of TD 1's courses, which is exactly what one tutorial group means.
                {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23561", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
            ],
        },
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    assert [m for m in found if m["kind"] == "doubled" and m["studentId"] == "A001"] == []


def test_a_student_no_pull_has_returned_is_not_judged(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    # No registrations pull at all: nothing to hold anyone against. The silence stands —
    # and it is now counted, so it can no longer be read as agreement.
    answer = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()
    assert answer["mismatches"] == []
    assert answer["coverage"] == [
        {
            "termId": HUB_TERM,
            "termCode": TERM,
            "members": 3,
            "judged": 0,
            "blind": 3,
            "skipped": ["A001", "A002", "A003"],
            "pulledInTerm": 0,
            # Nobody has pulled the registrar's timetable, so no section can be told to be
            # over and all of them go on being expected. Named, so the fallback is visible.
            "undatedCrns": ["22151", "23652"],
        }
    ]


def test_the_check_says_how_many_students_it_could_not_see(client: TestClient, database: StudentDatabase):
    """A pull that returned two of three students is not a clean bill of health for three."""
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={
            "termCode": TERM,
            "rows": [
                {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
                {"studentId": "A002", "crn": "22151", "courseCode": "MATH-001"},
                {"studentId": "A002", "crn": "23652", "courseCode": "MATH-011"},
            ],
        },
    )
    answer = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()

    # The two the pull returned are registered in exactly what we placed them in.
    assert answer["mismatches"] == []
    # And the third is not a third clean student. It is a student nobody asked about.
    assert answer["coverage"] == [
        {
            "termId": HUB_TERM,
            "termCode": TERM,
            "members": 3,
            "judged": 2,
            "blind": 1,
            "skipped": ["A003"],
            "pulledInTerm": 2,
            "undatedCrns": ["22151", "23652"],
        }
    ]


def test_a_pull_that_returned_somebody_elses_cohort_is_not_a_check_of_this_one(
    client: TestClient, database: StudentDatabase
):
    """`pulledInTerm` separates "nothing was pulled" from "something was, and none of it ours"."""
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={"termCode": TERM, "rows": [{"studentId": "Z999", "crn": "22151", "courseCode": "MATH-001"}]},
    )
    coverage = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["coverage"]

    # A filter scoped to the wrong population reads exactly like a filter that was never
    # run, unless the count of who it DID return is on the wire.
    assert coverage[0]["judged"] == 0
    assert coverage[0]["blind"] == 3
    assert coverage[0]["pulledInTerm"] == 1


def test_without_a_term_link_there_is_no_comparison(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database)
    made = make_filter(client, "registrations")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/registrations",
        json={"termCode": TERM, "rows": [{"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"}]},
    )
    answer = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()

    assert answer["mismatches"] == []
    # No comparison, and — the point of this — it says so. An unlinked semester used to be
    # walked straight past, so a cohort nobody had ever checked was indistinguishable from
    # one the registrar agreed with entirely.
    assert answer["coverage"] == [
        {
            "termId": HUB_TERM,
            "termCode": "",
            "members": 3,
            "judged": 0,
            "blind": 3,
            "skipped": ["A001", "A002", "A003"],
            "pulledInTerm": 0,
            # Nobody has pulled the registrar's timetable, so no section can be told to be
            # over and all of them go on being expected. Named, so the fallback is visible.
            "undatedCrns": ["22151", "23652"],
        }
    ]


def test_a_cohort_present_only_through_a_shared_set_is_still_covered(
    client: TestClient, database: StudentDatabase
):
    """The language hour is the case that hides. A set open to every cohort sits on ONE
    cohort's row, so a cohort whose only presence in a semester is that set has no
    `cohort_scopes` row for it — and reading the cohort's own sets alone would report
    nothing about the semester, which is exactly how the languages went unchecked.
    """
    owner = build_cohort(database)
    other = database.create_cohort(name="L1 Maths", term="2026-27")
    with database.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)
                    VALUES ('B001', 'in_portal', :cohort, 'now', 'now', 'now')"""),
            {"cohort": other["id"]},
        )
    lang = database.add_scope(owner, code="LANG", name="Languages", term_id=HUB_TERM, open_to_all=True)
    french = database.add_group(lang, label="F1")
    database.set_cell(group_id=french, course_id=database.add_course(lang, code="FREN-101"), crn="24001")
    database.assign(student_id="B001", scope_id=lang, group_id=french)

    # L1 Maths has no set of its own anywhere, and is still on this semester.
    coverage = client.get(f"{BASE}/cohorts/{other['id']}/registration-check").json()["coverage"]

    assert [term["termId"] for term in coverage] == [HUB_TERM]
    assert coverage[0]["members"] == 1
    assert coverage[0]["blind"] == 1


def test_a_semester_the_cohort_is_not_taught_in_says_nothing_at_all(
    client: TestClient, database: StudentDatabase
):
    """A floor is not a flag, and "0 of 3 checked" about a semester we do not teach is neither."""
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    client.put(f"{BASE}/term-links/some-other-semester", json={"portalTermCode": "262720"})

    coverage = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["coverage"]

    assert [term["termId"] for term in coverage] == [HUB_TERM]


# ------------------------------------------- the registrar's own timetable


def test_the_extension_is_told_which_crns_to_ask_about_and_whose_they_are(client: TestClient):
    # Split, because asking the registrar about another department's rooms is a different
    # question from asking about our own, and shipping with that half off must stay possible.
    with PortalListStore(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO student_registrations
                        (term_code, student_id, crn, course_code, status, first_seen_at, last_seen_at)
                    VALUES ('262710','A001','23425','MATH-001','in_portal','now','now'),
                           ('262710','A001','20581','ENGL-604','in_portal','now','now'),
                           ('262710','A002','23425','MATH-001','in_portal','now','now')"""),
        )
        connection.execute(
            text("""INSERT INTO active_course_crns (id, term_code, crn, course_code, added_at, added_by)
                    VALUES ('a1','262710','23425','MATH-001','now','')"""),
        )

    payload = client.get("/api/v1/portal/terms/262710/timetable-targets").json()

    assert payload == {"ours": ["23425"], "registered": ["20581"]}


def test_a_timetable_pull_is_written_down_with_what_it_could_not_answer(client: TestClient):
    answer = client.post(
        "/api/v1/portal/facility-timetable",
        json={
            "termCode": "262710",
            "asked": ["23425", "23426", "23427"],
            "sections": [
                {
                    "crn": "23425", "courseCode": "MATH-001", "ours": True,
                    "meetings": [{"meetsOn": "2026-09-07", "startsAt": "08:30", "endsAt": "10:00"}],
                }
            ],
            "silent": ["23426"],
            "failed": ["23427"],
            "complete": True,
        },
    )

    assert answer.status_code == status.HTTP_200_OK
    assert answer.json() == {"asked": 3, "answered": 1, "silent": 1, "failed": 1, "complete": True}


def test_a_pull_that_does_not_account_for_what_it_asked_is_refused(client: TestClient):
    answer = client.post(
        "/api/v1/portal/facility-timetable",
        json={"termCode": "262710", "asked": ["23425", "23426"], "sections": [], "silent": [], "failed": [],
              "complete": True},
    )

    assert answer.status_code == status.HTTP_400_BAD_REQUEST
    assert "neither answered" in answer.json()["detail"]


def test_clashes_are_readable_without_the_student_hub(client: TestClient, database: StudentDatabase):
    # The whole point of the facilities record: a clash it can settle must not be
    # unanswerable because a separate deployment is unconfigured or down.
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    with database.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO students (student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)
                    VALUES ('A001','in_portal',:c,'now','now','now')"""),
            {"c": cohort["id"]},
        )
    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id="term-1")
    td = database.add_scope(cohort["id"], code="TD", name="Tutorials", term_id="term-1")
    maths = database.add_course(cm, code="MATH-001")
    algo = database.add_course(td, code="MATH-011")
    group_a = database.add_group(cm, label="A")
    group_1 = database.add_group(td, label="1")
    database.set_cell(group_id=group_a, course_id=maths, crn="22151")
    database.set_cell(group_id=group_1, course_id=algo, crn="23652")
    database.assign(student_id="A001", scope_id=cm, group_id=group_a)
    database.assign(student_id="A001", scope_id=td, group_id=group_1)

    client.put("/api/v1/portal/term-links/term-1", json={"portalTermCode": "262710"})
    meeting = {"meetsOn": "2026-09-07", "startsAt": "08:30", "endsAt": "10:00"}
    client.post(
        "/api/v1/portal/facility-timetable",
        json={
            "termCode": "262710", "asked": ["22151", "23652"],
            "sections": [
                {"crn": "22151", "ours": True, "meetings": [meeting]},
                {"crn": "23652", "ours": True, "meetings": [meeting]},
            ],
            "silent": [], "failed": [], "complete": True,
        },
    )

    payload = client.get("/api/v1/portal/terms/term-1/clashes").json()

    assert payload["linked"] is True
    [clash] = payload["cohorts"][0]["clashes"]
    assert sorted(f"{g['scopeCode']} {g['label']}" for g in clash["groups"]) == ["CM A", "TD 1"]
    assert clash["students"] == ["A001"]
    assert payload["coverage"]["blind"] == []


def test_a_section_with_no_published_times_is_named_as_blind_not_counted_as_clean(
    client: TestClient, database: StudentDatabase
):
    # A clash total over sections nobody has times for is a floor. One that does not say so
    # is worse than none, because it reads as "checked, nothing found".
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id="term-1")
    maths = database.add_course(cm, code="MATH-001")
    group_a = database.add_group(cm, label="A")
    database.set_cell(group_id=group_a, course_id=maths, crn="22151")
    client.put("/api/v1/portal/term-links/term-1", json={"portalTermCode": "262710"})

    payload = client.get("/api/v1/portal/terms/term-1/clashes").json()

    assert payload["coverage"]["blind"] == ["22151"]
    assert payload["cohorts"][0]["clashes"] == []


# ------------------------------------------- a course taught in two halves


"""
`expected` used to be every section our planning holds for a course code, all year.

MATH-351 runs as one CRN until 26 October and another from 2 November; both were expected
every day, so ten students were reported missing from a section that had not started, and
would later be reported missing from one that had finished. Wrong every day, in both
directions, and the loudest wrong thing on the page.
"""


def test_a_section_that_has_finished_is_not_still_expected(client: TestClient, database: StudentDatabase):
    cohort_id = build_cohort(database, maths_in_tutorials="23820")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    # 22151 ran and is over; 23820 is running now. The students moved with the course.
    timetable(client, {"22151": (-60, -10), "23820": (-5, 40), "23652": (-60, 40)})
    registrations(
        client,
        [
            {"studentId": "A001", "crn": "23820", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        ],
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    # A001 is registered in exactly the half that is running. Nothing is missing.
    assert [m for m in found if m["studentId"] == "A001"] == []


def test_the_two_halves_of_a_handover_are_never_both_expected_on_one_day(
    client: TestClient, database: StudentDatabase
):
    cohort_id = build_cohort(database, maths_in_tutorials="23820")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    # The week between the halves: the first has finished, the second has not begun.
    timetable(client, {"22151": (-60, -10), "23820": (10, 60), "23652": (-60, 60)})
    registrations(client, [{"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"}])

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]
    maths = [m for m in found if m["studentId"] == "A001" and m["courseCode"] == "MATH-001"]

    # One verdict about the course, naming the half to be registered in — not both.
    assert len(maths) == 1
    assert maths[0]["expected"] == ["23820"]


def test_a_crn_the_registrar_has_not_timetabled_stays_expected_and_is_counted(
    client: TestClient, database: StudentDatabase
):
    """Fail open, and say so. A section we have no dates for cannot be told to be over."""
    cohort_id = build_cohort(database, maths_in_tutorials="23820")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    # 23820 is not in the pull at all.
    timetable(client, {"22151": (-60, 40), "23652": (-60, 40)})
    registrations(
        client,
        [
            {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        ],
    )

    answer = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()
    maths = [m for m in answer["mismatches"] if m["studentId"] == "A001" and m["courseCode"] == "MATH-001"]

    # Still expected — we have no grounds to drop it — and named, so the fallback is not silent.
    assert maths and maths[0]["expected"] == ["22151", "23820"]
    assert answer["coverage"][0]["undatedCrns"] == ["23820"]


def test_a_course_whose_sections_have_all_finished_does_not_turn_everyone_unplaced(
    client: TestClient, database: StudentDatabase
):
    """The fall-through that matters most, because narrowing here inverts every verdict.

    An empty `expected` makes `_judge` call every registration `unplaced`. So a term that
    has ended — or one the registrar's timetable has run past — would fill the screen with
    warnings about students who are placed exactly right.
    """
    cohort_id = build_cohort(database)
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    timetable(client, {"22151": (-90, -30), "23652": (-90, -30)})
    registrations(
        client,
        [
            {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        ],
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    assert [m for m in found if m["studentId"] == "A001"] == []


def test_the_expectation_ladder_falls_through_in_order():
    """The three tiers on their own, since two of them only show at the edges of a term."""
    windows = {"first": ("2026-09-01", "2026-10-26"), "second": ("2026-11-02", "2026-12-20")}
    both = ["first", "second"]

    # Running today wins.
    assert _expected_on(both, windows, "2026-09-15") == ["first"]
    assert _expected_on(both, windows, "2026-11-10") == ["second"]
    # In the gap, the half still to come — never both.
    assert _expected_on(both, windows, "2026-10-29") == ["second"]
    # Once everything has finished, everything again: narrowing to nothing is far worse.
    assert _expected_on(both, windows, "2027-01-05") == ["first", "second"]
    # A section with no dates is kept whichever tier wins.
    assert _expected_on([*both, "undated"], windows, "2026-09-15") == ["first", "undated"]
    # And with no dates at all, nothing is narrowed.
    assert _expected_on(both, {}, "2026-09-15") == ["first", "second"]


def test_a_finished_section_a_student_is_still_registered_in_is_not_a_surplus(
    client: TestClient, database: StudentDatabase
):
    """The trap the first version of this fell into, found by running it on real data.

    Narrowing `expected` to what is running today and then judging BOTH sides against it
    turns everyone who has come through a handover into an `extra`: the registrar keeps a
    student registered in the finished half for the grade, and that half is no longer
    expected, so it reads as a section that is no group of theirs. Sixteen students on one
    real course. Swapping one false warning for another is not a fix.
    """
    cohort_id = build_cohort(database, maths_in_tutorials="23820")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    timetable(client, {"22151": (-60, -10), "23820": (-5, 40), "23652": (-60, 40)})
    registrations(
        client,
        [
            # Both halves, which is what a student who has come through a handover has.
            {"studentId": "A001", "crn": "22151", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23820", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        ],
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]

    assert [m for m in found if m["studentId"] == "A001"] == []


def test_a_section_that_was_never_ours_is_still_a_surplus(client: TestClient, database: StudentDatabase):
    """The other side of that: `ever` must not become a licence to register anywhere."""
    cohort_id = build_cohort(database, maths_in_tutorials="23820")
    client.put(f"{BASE}/term-links/{HUB_TERM}", json={"portalTermCode": TERM})
    timetable(client, {"22151": (-60, -10), "23820": (-5, 40), "23652": (-60, 40)})
    registrations(
        client,
        [
            {"studentId": "A001", "crn": "23820", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "99999", "courseCode": "MATH-001"},
            {"studentId": "A001", "crn": "23652", "courseCode": "MATH-011"},
        ],
    )

    found = client.get(f"{BASE}/cohorts/{cohort_id}/registration-check").json()["mismatches"]
    maths = [m for m in found if m["studentId"] == "A001" and m["courseCode"] == "MATH-001"]

    assert len(maths) == 1
    assert maths[0]["kind"] == "extra"
    assert "99999" in maths[0]["registered"]


# ------------------------------------------- who we say teaches it, and who they say


def test_two_spellings_of_one_surname_are_not_a_disagreement():
    """Five of the eleven real disagreements were nothing but where the space falls."""
    from sorbonne.services.portal_lists import names_agree

    assert names_agree("Safaa El Sayed", "Safaa Elsayed")
    assert names_agree("Omar El Dakkak", "Omar ElDakkak")
    assert names_agree("Giulia De Masi", "Giulia Demasi")
    # A middle name only one side carries.
    assert names_agree("Claude Vishnu Spaak", "Claude Spaak")
    # Family name first, which is how the registrar writes some people.
    assert names_agree("LE GUYON Valerie", "Valerie Le Guyon")
    # A section really can be taught by two people, and the registrar writes a list.
    assert names_agree("Mai El Sawy", "Mai Elsawy, Smail Kourta")
    # Titles are not part of a name.
    assert names_agree("Dr Omar El Dakkak", "omar eldakkak")


def test_two_different_people_are_still_a_disagreement():
    """The rules only ever merge names, and must not merge these."""
    from sorbonne.services.portal_lists import names_agree

    assert not names_agree("Sara Khaled", "Diaa Mereib")
    assert not names_agree("Suzanne Abdelhamid", "Suzanne El chehaly")
    # One letter, and almost certainly one person — but no distance that accepts this while
    # refusing "Sara Khaled" against "Diaa Mereib" is one to trust with a timetable. It
    # stays on the list for a person to settle.
    assert not names_agree("Wafaa Ahmed", "Wafa Ahmed")
    # Anagrams are not the same person. A sorted multiset of letters would say they were.
    assert not names_agree("Amir Sala", "Maria Alas")


def test_a_section_nobody_has_been_assigned_to_is_not_a_disagreement():
    from sorbonne.services.portal_lists import named, names_agree

    assert not named("TBD")
    assert not named("  tba ")
    assert not named("")
    assert named("Valerie LE GUYON")
    # So "TBD" against a real name is unnamed, never a difference of opinion.
    assert not names_agree("TBD", "Valerie LE GUYON")


def teach(database: StudentDatabase, client: TestClient, ours: str, theirs: str) -> None:
    """One section, staffed by our planning one way and by the registrar another."""
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id=HUB_TERM)
    course = database.add_course(cm, code="MATH-001")
    group = database.add_group(cm, label="A")
    database.set_cell(group_id=group, course_id=course, crn="22151", teacher=ours)
    made = make_filter(client, "courses")
    client.post(
        f"{BASE}/filters/{made['id']}/sync/courses",
        json={"rows": [{"crn": "22151", "termCode": TERM, "courseCode": "MATH-001", "teacherName": theirs}]},
    )


def test_the_register_check_says_where_the_teacher_has_drifted(client: TestClient, database: StudentDatabase):
    teach(database, client, ours="Sara Khaled", theirs="Diaa Mereib")

    found = client.get(f"{BASE}/register-check").json()

    assert [(row["crn"], row["ours"], row["theirs"]) for row in found["teacherDiffers"]] == [
        ("22151", "Sara Khaled", "Diaa Mereib")
    ]
    assert found["teacherUnnamed"] == []


def test_a_section_the_registrar_staffs_and_we_have_not_is_its_own_list(
    client: TestClient, database: StudentDatabase
):
    # A line to copy across, not a conversation to have. Different problem, different list.
    teach(database, client, ours="TBD", theirs="Valerie LE GUYON")

    found = client.get(f"{BASE}/register-check").json()

    assert found["teacherDiffers"] == []
    assert [(row["crn"], row["theirs"]) for row in found["teacherUnnamed"]] == [("22151", "Valerie LE GUYON")]


def test_a_surname_the_two_sides_space_differently_is_reported_as_neither(
    client: TestClient, database: StudentDatabase
):
    teach(database, client, ours="Safaa El Sayed", theirs="Safaa Elsayed")

    found = client.get(f"{BASE}/register-check").json()

    assert found["teacherDiffers"] == []
    assert found["teacherUnnamed"] == []


def test_our_planning_says_how_firmly_it_names_a_teacher(client: TestClient, database: StudentDatabase):
    """Three states, because a boolean reads "not in our planning" for almost every section.

    Nothing in the real data carries a linked teacher and 137 sections carry free text, so
    the middle state IS the worklist — and calling it "not planned" would look like a bug.
    """
    teach(database, client, ours="Sara Khaled", theirs="Diaa Mereib")

    found = client.get(f"{BASE}/register-check").json()

    assert found["teacherDiffers"][0]["planning"] == "named"


# ------------------------------- our sections against somebody else's, at one hour


def test_collisions_are_blind_rather_than_none_before_the_registrar_is_swept(client: TestClient):
    """An empty list from an empty record is not "no collisions"; it is "nobody looked"."""
    found = client.get(f"{BASE}/register-check?term={TERM}").json()

    assert found["collides"] == []
    assert found["swept"] is False


def test_a_collision_is_reported_once_per_slot_and_can_be_settled(
    client: TestClient, database: StudentDatabase
):
    cohort = database.create_cohort(name="Foundation Year", term="2026-27")
    cm = database.add_scope(cohort["id"], code="CM", name="Lectures", term_id=HUB_TERM)
    database.set_cell(
        group_id=database.add_group(cm, label="A"),
        course_id=database.add_course(cm, code="SCEN-101"),
        crn="23302",
    )
    # Ours is on the register; the option is not, which is the whole discriminator. Put
    # straight in rather than through the register's own onboarding, which wants the course
    # to exist in the portal's list first and is a different test's subject.
    with PortalListStore(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_course_crns (id, term_code, crn, course_code, added_at, added_by)
                    VALUES ('c1', :t, '23302', 'SCEN-101', 'now', '')"""),
            {"t": TERM},
        )
    # Two dates a week apart, so both fall on one weekday and fold into one slot — which
    # is the grain the whole thing is about.
    timetable(client, {"23302": (-14, -7), "20581": (-14, -7)})

    found = client.get(f"{BASE}/register-check?term={TERM}").json()
    assert found["swept"] is True
    [row] = found["collides"]
    assert row["ourCrn"] == "23302"
    assert [t["crn"] for t in row["theirs"]] == ["20581"]
    assert row["dates"] == 2

    # Accepted once, about the slot — and it leaves the list so the page can reach zero.
    settled = client.post(
        f"{BASE}/section-collisions/settle",
        json={"termCode": TERM, "ourCrn": "23302", "weekday": row["weekday"],
              "startsAt": row["startsAt"], "endsAt": row["endsAt"],
              "disposition": "accepted", "note": "protected option block"},
    )
    assert settled.status_code == status.HTTP_204_NO_CONTENT

    after = client.get(f"{BASE}/register-check?term={TERM}").json()
    assert after["collides"] == []
    assert after["settledCollisions"][0]["note"] == "protected option block"


def test_a_collision_can_only_be_accepted_or_referred(client: TestClient):
    refused = client.post(
        f"{BASE}/section-collisions/settle",
        json={"termCode": TERM, "ourCrn": "23302", "weekday": "Tue", "startsAt": "16:30",
              "endsAt": "18:00", "disposition": "ignored"},
    )

    assert refused.status_code == status.HTTP_400_BAD_REQUEST
    assert "ignored" in refused.json()["detail"]
