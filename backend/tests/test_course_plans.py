"""Course plans: coordinators set a course's hours and lead; the lead lays out its weeks.

The user's choices (18 Nov 2026): totals locked for the lead, one lead per course per semester
picked by hand, one plan per course per semester, the weeks as the Semester plan counts them.
"""

from __future__ import annotations

import json

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import course_plans as plans_api
from sorbonne.api import teacher_wishes as coordinators
from sorbonne.api import wish_invite as door
from sorbonne.main import app
from sorbonne.services.course_plans import CoursePlans, InvalidCoursePlan, NotTheLead, UnknownCourse
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions
from sorbonne.services.teacher_wishes import WishStore
from sorbonne.services.wish_invitations import InvitationStore
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/course-plans"
WISHES = "/api/v1/wishes"
DOOR = "/api/v1/invite/wishes"
# A semester of its own, so no other test's plan or collection stands in the way.
TERM = "262799"
MATH, PHYS, AUTUMN = "CPTEST-002", "CPTEST-101", "CPTEST-AUT"
LEAD, OTHER = "plan-test-lead", "plan-test-other"


@pytest.fixture
def plans() -> CoursePlans:
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for table in ("wish_invitations", "wish_reopenings", "teacher_wishes", "wish_collections"):
            connection.execute(text(f"DELETE FROM {table} WHERE term_code = :t"), {"t": TERM})  # noqa: S608
        connection.execute(text("DELETE FROM active_courses WHERE course_code LIKE 'CPTEST-%'"))
        connection.execute(text("DELETE FROM active_teachers WHERE id LIKE 'plan-test-%'"))
        connection.execute(text("DELETE FROM plan_terms WHERE term_code = :t"), {"t": TERM})
        for code, title, terms in (
            (MATH, "Elements of Calculus", [TERM]),
            (PHYS, "Mechanics", [TERM]),
            (AUTUMN, "Only in autumn", ["262798"]),
        ):
            connection.execute(
                text("""INSERT INTO active_courses (id, course_code, title, coefficient, added_at)
                        VALUES (:id, :code, :title, '4', '2026-11-18')"""),
                {"id": f"id-{code}", "code": code, "title": title},
            )
            for term in terms:
                connection.execute(
                    text("INSERT INTO active_course_terms (course_code, term_code) VALUES (:code, :term)"),
                    {"code": code, "term": term},
                )
        for teacher, name in ((LEAD, "Valerie Le Guyon"), (OTHER, "Bilal Maaz")):
            connection.execute(
                text("INSERT INTO active_teachers (id, full_name, added_at) VALUES (:id, :name, '2026-11-18')"),
                {"id": teacher, "name": name},
            )
            connection.execute(
                text("INSERT INTO active_teacher_terms (active_id, term_code) VALUES (:id, :term)"),
                {"id": teacher, "term": TERM},
            )
        # Fourteen teaching weeks from 11 January 2027, the week of 15 February a break, and a
        # holiday on Tuesday 2 March (Week 7, the break taking no number).
        connection.execute(
            text("""INSERT INTO plan_terms (term_code, name, week_one, weeks, without, holidays)
                    VALUES (:t, 'Test semester', '2027-01-11', 14, :without, :holidays)"""),
            {
                "t": TERM,
                "without": json.dumps(["2027-02-15"]),
                "holidays": json.dumps([{"date": "2027-03-02", "label": "Founders' day"}]),
            },
        )
    return CoursePlans(engine)


@pytest.fixture
def client(plans: CoursePlans, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = plans.engine
    wishes, invitations = WishStore(engine), InvitationStore(engine)
    overrides = {
        plans_api.get_plans: lambda: plans,
        coordinators.get_wishes: lambda: wishes,
        coordinators.get_invitations: lambda: invitations,
        door.get_wishes: lambda: wishes,
        door.get_invitations: lambda: invitations,
        door.get_reductions: lambda: HourReductions(engine),
        door.get_course_plans: lambda: plans,
    }
    app.dependency_overrides.update(overrides)
    monkeypatch.setattr(door, "verify_google_identity", lambda credential: (credential, "Somebody"))
    try:
        yield TestClient(app, base_url="https://testserver")
    finally:
        for get in overrides:
            app.dependency_overrides.pop(get, None)


def _invitee(client: TestClient, teacher: str, email: str, deadline: str = "2099-01-10") -> str:
    """Collect the semester's preferences, invite the teacher, and sign in as them."""
    opened = client.put(f"{WISHES}/collection/{TERM}", json={"deadline": deadline})
    assert opened.status_code == status.HTTP_200_OK, opened.text
    made = client.post(f"{WISHES}/{TERM}/{teacher}/invitation", json={"email": email})
    assert made.status_code == status.HTTP_201_CREATED, made.text
    code = made.json()["code"]
    assert client.post(f"{DOOR}/{code}/session", json={"credential": email}).status_code == status.HTTP_200_OK
    return code


def _course(semester: dict, code: str) -> dict:
    return next(course for course in semester["courses"] if course["courseCode"] == code)


def test_the_teaching_weeks_are_the_semester_plans(plans: CoursePlans):
    weeks = plans.semester(TERM)["weeks"]

    assert [week["week"] for week in weeks] == list(range(1, 15))
    # The break takes no number: Week 6 is the week after it.
    assert (weeks[4]["monday"], weeks[5]["monday"]) == ("2027-02-08", "2027-02-22")
    assert weeks[6]["holidays"] == [{"date": "2027-03-02", "label": "Founders' day"}]
    assert all(not week["holidays"] for week in weeks if week["week"] != 7)


def test_every_active_course_is_listed_with_an_empty_plan_until_somebody_plans_it(plans: CoursePlans):
    semester = plans.semester(TERM)

    assert [course["courseCode"] for course in semester["courses"]] == [MATH, PHYS]
    math = _course(semester, MATH)
    assert math["components"]["CM"] == {"hours": None, "length": None}
    assert (math["leadId"], math["weeks"], math["coefficient"], math["active"]) == ("", {}, "4", True)


def test_coordinators_set_the_hours_and_a_session_length_with_them(client: TestClient):
    set_ = client.patch(
        f"{AT}/{TERM}/{MATH.lower()}",
        json={"hours": {"CM": {"hours": 24, "length": 1.5}, "TD": {"hours": "21", "length": "1,5"}}},
    )
    assert set_.status_code == status.HTTP_200_OK, set_.text
    plan = set_.json()
    assert plan["components"]["CM"] == {"hours": 24, "length": 1.5}
    assert plan["components"]["TD"] == {"hours": 21, "length": 1.5}
    assert plan["components"]["TP"] == {"hours": None, "length": None}
    assert plan["hoursUpdatedAt"]

    # A component left out stays; one sent with no hours is cleared.
    cleared = client.patch(f"{AT}/{TERM}/{MATH}", json={"hours": {"TD": {"hours": None}}}).json()
    assert cleared["components"]["CM"]["hours"] == 24
    assert cleared["components"]["TD"] == {"hours": None, "length": None}

    no_length = client.patch(f"{AT}/{TERM}/{MATH}", json={"hours": {"TP": {"hours": 12}}})
    assert no_length.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "how long one TP session lasts" in no_length.json()["detail"]
    words = client.patch(f"{AT}/{TERM}/{MATH}", json={"hours": {"TP": {"hours": "twelve", "length": 2}}})
    assert words.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    # A course not active in the semester has no plan in it.
    autumn = client.patch(f"{AT}/{TERM}/{AUTUMN}", json={"hours": {"CM": {"hours": 10, "length": 2}}})
    assert autumn.status_code == status.HTTP_404_NOT_FOUND


def test_a_lead_is_picked_by_hand_and_is_one_of_the_departments_teachers(client: TestClient):
    picked = client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": LEAD})
    assert picked.status_code == status.HTTP_200_OK, picked.text
    assert (picked.json()["leadId"], picked.json()["leadName"]) == (LEAD, "Valerie Le Guyon")

    nobody = client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": "not-a-teacher"})
    assert nobody.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": ""}).json()["leadId"] == ""
    # Nothing is suggested: a course nobody picked a lead for has none.
    assert client.get(f"{AT}/{TERM}").json()["courses"][1]["leadId"] == ""


def test_a_coordinator_lays_out_the_weeks_within_the_hours_set(client: TestClient):
    client.patch(f"{AT}/{TERM}/{MATH}", json={"hours": {"CM": {"hours": 3, "length": 1.5}}})

    laid = client.put(
        f"{AT}/{TERM}/{MATH}/weeks",
        json={"weeks": {"CM": {"1": 1, "2": 1, "3": 0}, "TD": {"1": 2}}, "note": "Starts in week 1."},
    )
    assert laid.status_code == status.HTTP_200_OK, laid.text
    plan = laid.json()
    # Weeks with none are left out, and TD, which has no hours, is not the course's.
    assert plan["weeks"] == {"CM": {"1": 1, "2": 1}}
    assert (plan["note"], plan["answerSource"]) == ("Starts in week 1.", "coordinator")

    beyond = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM": {"15": 1}}})
    assert beyond.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "1 to 14" in beyond.json()["detail"]
    crowded = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM": {"2": 9}}})
    assert crowded.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_lead_lays_out_the_courses_they_lead_in_their_preferences_request(client: TestClient):
    for code in (MATH, PHYS):
        client.patch(f"{AT}/{TERM}/{code}", json={"hours": {"TD": {"hours": 3, "length": 1.5}}})
    client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": LEAD})
    client.patch(f"{AT}/{TERM}/{PHYS}", json={"leadId": OTHER})
    code = _invitee(client, LEAD, "valerie@gmail.com")

    step = client.get(f"{DOOR}/{code}/form").json()["coursePlans"]
    assert [course["courseCode"] for course in step["courses"]] == [MATH]
    assert len(step["weeks"]) == 14

    saved = client.put(
        f"{DOOR}/{code}/course-plans",
        json={"courses": [{"courseCode": MATH, "weeks": {"TD": {"2": 1, "3": 1}}, "note": "TD from week 2"}]},
    )
    assert saved.status_code == status.HTTP_200_OK, saved.text
    mine = saved.json()["coursePlans"]["courses"][0]
    assert mine["weeks"] == {"TD": {"2": 1, "3": 1}}
    assert (mine["answerSource"], mine["answeredBy"]) == ("lead", "Valerie Le Guyon")

    # Somebody else's course is refused, and nothing of the request is kept.
    theirs = client.put(
        f"{DOOR}/{code}/course-plans",
        json={
            "courses": [
                {"courseCode": MATH, "weeks": {"TD": {"4": 1}}},
                {"courseCode": PHYS, "weeks": {"TD": {"2": 1}}},
            ]
        },
    )
    assert theirs.status_code == status.HTTP_403_FORBIDDEN
    assert client.get(f"{AT}/{TERM}").json()["courses"][0]["weeks"] == {"TD": {"2": 1, "3": 1}}

    # The coordinators see the answer on the semester's list.
    listed = _course(client.get(f"{AT}/{TERM}").json(), MATH)
    assert (listed["note"], listed["answerSource"]) == ("TD from week 2", "lead")


def test_a_teacher_who_leads_nothing_is_not_asked(client: TestClient):
    code = _invitee(client, OTHER, "bilal@gmail.com")

    assert client.get(f"{DOOR}/{code}/form").json()["coursePlans"] is None
    refused = client.put(f"{DOOR}/{code}/course-plans", json={"courses": [{"courseCode": MATH, "weeks": {}}]})
    assert refused.status_code == status.HTTP_403_FORBIDDEN


def test_after_the_deadline_the_lead_can_no_longer_change_the_weeks(client: TestClient):
    client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": LEAD})
    code = _invitee(client, LEAD, "valerie@gmail.com", deadline="2020-01-01")

    closed = client.put(f"{DOOR}/{code}/course-plans", json={"courses": [{"courseCode": MATH, "weeks": {}}]})
    assert closed.status_code == status.HTTP_409_CONFLICT


def test_the_store_says_what_is_wrong_in_words(plans: CoursePlans):
    with pytest.raises(UnknownCourse):
        plans.set_hours(TERM, AUTUMN, {"CM": {"hours": 10, "length": 2}})
    with pytest.raises(InvalidCoursePlan):
        plans.set_hours("2627", MATH, {})
    with pytest.raises(InvalidCoursePlan, match="between 0 and 8"):
        plans.set_hours(TERM, MATH, {"CM": {"hours": 10, "length": 12}})
    plans.set_lead(TERM, MATH, LEAD)
    with pytest.raises(NotTheLead):
        plans.lay_out(TERM, MATH, {}, source="lead", lead_id=OTHER)


def test_a_plan_outlives_its_course_leaving_the_semesters_list(plans: CoursePlans):
    plans.set_hours(TERM, PHYS, {"CM": {"hours": 20, "length": 2}})
    with plans.engine.begin() as connection:
        connection.execute(
            text("DELETE FROM active_course_terms WHERE course_code = :c AND term_code = :t"), {"c": PHYS, "t": TERM}
        )

    phys = _course(plans.semester(TERM), PHYS)
    assert (phys["active"], phys["components"]["CM"]["hours"]) == (False, 20)
