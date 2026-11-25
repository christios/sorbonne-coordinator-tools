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
        # The test's Groups & CRNs sets go with their cohort.
        connection.execute(text("DELETE FROM student_cohorts WHERE id LIKE 'cptest-%'"))
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


def _groups(  # noqa: PLR0913 - a course row of a set, and the sections under it
    code: str,
    component: str,
    hours: str = "",
    length: str = "",
    sections: list[list[tuple[str, str]]] | None = None,
    term: str = TERM,
) -> None:
    """A set in Groups & CRNs asking `hours` of the course's `component`, sessions of `length`,
    with a section for each entry of `sections` — its parts' (hours, length)."""
    engine = engine_for(TEST_DATABASE_URL)
    ident = f"{code}-{component}-{term}-{len(sections or [])}-{hours}-{length}".lower()
    with engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO student_cohorts (id, name, created_at, updated_at)
                    VALUES ('cptest-cohort', 'Test cohort', 'x', 'x') ON CONFLICT DO NOTHING""")
        )
        connection.execute(
            text("""INSERT INTO cohort_scopes (id, cohort_id, code, name, term_id)
                    VALUES (:id, 'cptest-cohort', :code, :code, :term)"""),
            {"id": f"scope-{ident}", "code": f"S-{ident}"[:40], "term": f"plan:{term}"},
        )
        connection.execute(
            text("""INSERT INTO scope_courses (id, scope_id, code, component, hours, duration)
                    VALUES (:id, :scope, :code, :component, :hours, :length)"""),
            {
                "id": f"course-{ident}",
                "scope": f"scope-{ident}",
                "code": code,
                "component": component,
                "hours": hours,
                "length": length,
            },
        )
        for index, parts in enumerate(sections or []):
            group = f"group-{ident}-{index}"
            connection.execute(
                text("INSERT INTO scope_groups (id, scope_id, label) VALUES (:id, :scope, :label)"),
                {"id": group, "scope": f"scope-{ident}", "label": f"{component} {index + 1}"},
            )
            for part, (part_hours, part_length) in enumerate(parts, start=1):
                connection.execute(
                    text("""INSERT INTO group_crns (group_id, course_id, crn, hours, duration, part)
                            VALUES (:group, :course, '', :hours, :length, :part)"""),
                    {
                        "group": group,
                        "course": f"course-{ident}",
                        "hours": part_hours,
                        "length": part_length,
                        "part": part,
                    },
                )


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
    empty = {"hours": None, "length": None, "issue": "", "source": "", "exceptions": [], "split": ""}
    assert math["components"]["CM"] == empty
    assert (math["leadId"], math["weeks"], math["coefficient"], math["active"]) == ("", {}, "4", True)


def test_the_hours_and_session_lengths_are_groups_and_crns(client: TestClient):
    """Read from the course's rows and sections in Groups & CRNs (23 Nov 2026), never set here."""
    # A set asking 24 h of lectures in 1.5 h sessions; a TD whose two sections say it too, one
    # of them taught in two parts that add up to it.
    _groups(MATH, "CM", "24", "1.5")
    _groups(MATH, "td", "", "", sections=[[("21", "1,5")], [("12", "1.5"), ("9 h", "")]])
    plan = _course(client.get(f"{AT}/{TERM}").json(), MATH)
    plain = {"issue": "", "exceptions": [], "split": ""}
    assert plan["components"]["CM"] == {"hours": 24, "length": 1.5, "source": "asks", **plain}
    # The TD's set asks nothing: its sections, which agree, give the figure.
    # One of its two groups is taught in two parts: "some", and each part a row of its own (25 Nov 2026).
    assert plan["components"]["TD"] == {"hours": 21, "length": 1.5, "source": "sections", **plain, "split": "some"}
    assert (plan["parts"]["TD:1"]["hours"], plan["parts"]["TD:1"]["length"]) == (12, 1.5)
    # The second part says no length of its own: the TD's.
    second = plan["parts"]["TD:2"]
    assert (second["hours"], second["length"], second["issue"]) == (9, 1.5, "")
    assert [label.upper() for label in plan["parts"]["TD:2"]["groups"]] == ["TD 2"]
    assert plan["components"]["TP"] == {"hours": None, "length": None, "source": "", **plain}

    # Groups that disagree give no figure, and say so; so does a length that isn't one number,
    # and hours with no length at all.
    _groups(PHYS, "TP", "", "2", sections=[[("12", "")], [("7.5", "")]])
    _groups(PHYS, "TD", "30", "2, 3")
    _groups(PHYS, "CM", "20")
    phys = _course(client.get(f"{AT}/{TERM}").json(), PHYS)["components"]
    disagree = "Its sections say 7.5 h and 12 h: set the hours on what the course asks"
    assert phys["TP"] == {"hours": None, "length": None, "issue": disagree, "source": "", "exceptions": [], "split": ""}
    assert phys["TD"]["hours"] == 30 and "isn't one number" in phys["TD"]["issue"]
    assert phys["CM"]["issue"] == "No session length in Groups & CRNs yet"
    assert (phys["CM"]["hours"], phys["CM"]["length"], phys["CM"]["source"]) == (20, None, "asks")
    no_length = client.put(f"{AT}/{TERM}/{PHYS}/weeks", json={"weeks": {"CM": {"1": 1}}})
    assert no_length.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "no session length in Groups & CRNs" in no_length.json()["detail"]

    # Set at the course's level, a section's own figure is an exception: said, not blocking.
    _groups(AUTUMN, "TP", "12", "3", sections=[[("12", "")], [("7.5", "")], [("", "2")]])
    _groups(MATH, "TP", "12", "3", sections=[[("12", "")], [("7.5", "")], [("", "2")]])
    tp = _course(client.get(f"{AT}/{TERM}").json(), MATH)["components"]["TP"]
    assert (tp["hours"], tp["length"], tp["source"], tp["issue"]) == (12, 3, "asks", "")
    assert tp["exceptions"] == ["TP 2 says 7.5 h", "TP 3 has sessions of another length"]

    # Another semester's sets are not this one's.
    _groups(PHYS, "TP", "10", "2", term="262798")
    assert _course(client.get(f"{AT}/{TERM}").json(), PHYS)["components"]["TP"]["hours"] is None

    # Nothing is set here any more: the hours are changed in Groups & CRNs.
    refused = client.patch(f"{AT}/{TERM}/{MATH}", json={"hours": {"CM": {"hours": 30, "length": 1.5}}})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "set in Groups & CRNs" in refused.json()["detail"]


def test_a_group_taught_in_parts_lays_each_part_out_on_its_own(client: TestClient):
    """Algebra 2: the CM taught 30 h then 15 h, each part laid out in its own weeks (25 Nov 2026)."""
    _groups(MATH, "CM", "45", "2", sections=[[("30", ""), ("15", "")]])
    plan = _course(client.get(f"{AT}/{TERM}").json(), MATH)
    # Every CM group is taught in parts: the parts are the rows, each with the CM's session length.
    assert plan["components"]["CM"]["split"] == "all"
    parts = {key: (part["hours"], part["length"]) for key, part in plan["parts"].items()}
    assert parts == {"CM:1": (30, 2), "CM:2": (15, 2)}

    first = {str(week): 1 for week in range(1, 9)}
    second = {str(week): 1 for week in range(9, 15)}
    both = {"weeks": {"CM:1": first, "CM:2": second}, "lengths": {"CM:2": {"14": 3}}}
    laid = client.put(f"{AT}/{TERM}/{MATH}/weeks", json=both)
    assert laid.status_code == status.HTTP_200_OK, laid.text
    held = laid.json()
    assert held["weeks"]["CM:1"] == first and held["weeks"]["CM:2"] == second
    assert held["lengths"] == {"CM:2": {"14": [3.0]}}

    # A part the course doesn't have is not laid out; a row that is no part of anything is refused.
    ignored = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM:3": {"1": 1}}}).json()
    assert "CM:3" not in ignored["weeks"]
    wrong = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM:x": {"1": 1}}})
    assert wrong.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


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
    _groups(MATH, "CM", "3", "1.5")

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
        _groups(code, "TD", "3", "1.5")
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


def test_a_lead_says_why_their_weeks_run_unevenly(client: TestClient):
    """The step asks why when a layout strays from an even pace (23 Nov 2026); coordinators read it."""
    _groups(MATH, "TD", "3", "1.5")
    client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": LEAD})
    code = _invitee(client, LEAD, "valerie@gmail.com")

    put = lambda course: client.put(f"{DOOR}/{code}/course-plans", json={"courses": [course]})  # noqa: E731
    uneven = put({"courseCode": MATH, "weeks": {"TD": {"1": 2}}, "paceReason": "Both before the mid-term."})
    assert uneven.status_code == status.HTTP_200_OK, uneven.text
    assert _course(client.get(f"{AT}/{TERM}").json(), MATH)["paceReason"] == "Both before the mid-term."

    # Left out, the reason stays; sent empty once the weeks are even, it goes.
    put({"courseCode": MATH, "weeks": {"TD": {"1": 2}}})
    assert _course(client.get(f"{AT}/{TERM}").json(), MATH)["paceReason"] == "Both before the mid-term."
    put({"courseCode": MATH, "weeks": {"TD": {"4": 1, "11": 1}}, "paceReason": ""})
    assert _course(client.get(f"{AT}/{TERM}").json(), MATH)["paceReason"] == ""


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
        plans.set_hours(TERM, AUTUMN, {})
    with pytest.raises(InvalidCoursePlan):
        plans.set_hours("2627", MATH, {})
    with pytest.raises(InvalidCoursePlan, match="set in Groups & CRNs"):
        plans.set_hours(TERM, MATH, {"CM": {"hours": 10, "length": 2}})
    plans.set_lead(TERM, MATH, LEAD)
    with pytest.raises(NotTheLead):
        plans.lay_out(TERM, MATH, {}, source="lead", lead_id=OTHER)


def test_a_plan_outlives_its_course_leaving_the_semesters_list(plans: CoursePlans):
    _groups(PHYS, "CM", "20", "2")
    plans.set_lead(TERM, PHYS, LEAD)
    with plans.engine.begin() as connection:
        connection.execute(
            text("DELETE FROM active_course_terms WHERE course_code = :c AND term_code = :t"), {"c": PHYS, "t": TERM}
        )

    phys = _course(plans.semester(TERM), PHYS)
    assert (phys["active"], phys["components"]["CM"]["hours"]) == (False, 20)


def test_a_weeks_sessions_may_last_longer_or_shorter_than_usual(client: TestClient):
    _groups(MATH, "CM", "6", "1.5")
    client.patch(f"{AT}/{TERM}/{MATH}", json={"leadId": LEAD})

    laid = client.put(
        f"{AT}/{TERM}/{MATH}/weeks",
        json={
            "weeks": {"CM": {"1": 1, "2": 1, "3": 1}},
            # Week 2 is a three-hour session; week 3 said at the usual length, week 5 has none.
            "lengths": {"CM": {"2": 3, "3": 1.5, "5": 2}},
        },
    )
    assert laid.status_code == status.HTTP_200_OK, laid.text
    assert laid.json()["lengths"] == {"CM": {"2": [3.0]}}

    too_long = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM": {"2": 1}}, "lengths": {"CM": {"2": 9}}})
    assert too_long.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "week 2" in too_long.json()["detail"]

    # The lead says it in their request, the same way.
    code = _invitee(client, LEAD, "valerie@gmail.com")
    saved = client.put(
        f"{DOOR}/{code}/course-plans",
        json={"courses": [{"courseCode": MATH, "weeks": {"CM": {"1": 1, "4": 1}}, "lengths": {"CM": {"4": 4.5}}}]},
    )
    assert saved.status_code == status.HTTP_200_OK, saved.text
    assert saved.json()["coursePlans"]["courses"][0]["lengths"] == {"CM": {"4": [4.5]}}

    # Two sessions in a week, each its own length: a usual one and a three-hour exam.
    mixed = client.put(
        f"{AT}/{TERM}/{MATH}/weeks",
        json={"weeks": {"CM": {"2": 2, "3": 2}}, "lengths": {"CM": {"2": [1.5, 3], "3": [1.5, 1.5]}}},
    )
    assert mixed.status_code == status.HTTP_200_OK, mixed.text
    assert mixed.json()["lengths"] == {"CM": {"2": [1.5, 3.0]}}
    short = client.put(f"{AT}/{TERM}/{MATH}/weeks", json={"weeks": {"CM": {"2": 2}}, "lengths": {"CM": {"2": [3]}}})
    assert short.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "say how long each one lasts" in short.json()["detail"]
