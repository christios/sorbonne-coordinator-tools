"""A semester planned on a calendar before the registrar books it."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import semester_plans as api
from sorbonne.main import app
from sorbonne.services.engine import engine_for
from sorbonne.services.semester_plans import PlanStore, teaching_mondays
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/plans"
TERM = "262720"


@pytest.fixture
def plans() -> PlanStore:
    store = PlanStore(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM plan_terms"))
        connection.execute(text("DELETE FROM term_links WHERE term_id LIKE 'plan:%'"))
        connection.execute(text("DELETE FROM term_weeks WHERE term_id LIKE 'plan:%'"))
    return store


@pytest.fixture
def client(plans: PlanStore) -> TestClient:
    app.dependency_overrides[api.get_plans] = lambda: plans
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_plans, None)


@pytest.fixture
def section(client: TestClient) -> dict:
    """Second semester 2026-27: Week 1 is 11 January 2027, the week of 15 February is a break."""
    assert client.post(AT, json={"termCode": TERM, "name": "Semester 2 2026-27"}).status_code == 201
    settled = client.put(
        f"{AT}/{TERM}/settings",
        json={
            "name": "Semester 2 2026-27",
            "weekOne": "2027-01-13",
            "weeks": 14,
            "without": ["2027-02-17"],
            "holidays": [{"date": "2027-01-19", "label": "A holiday"}],
        },
    )
    assert settled.status_code == 200, settled.text
    made = client.post(
        f"{AT}/{TERM}/sections",
        json={
            "crn": "22229",
            "parentCrn": "23857",
            "courseCode": "math-002",
            "title": "Elements of Calculus GA- CM",
            "component": "CM",
            "programmes": ["FYS"],
            "groupLabel": "GA",
            "teacherName": "Bilal Maaz",
            "hours": 60,
            "hoursSaid": "60CM",
        },
    )
    assert made.status_code == 201, made.text
    return made.json()


def place(client: TestClient, section: dict, **fields) -> dict:
    body = {
        "sectionId": section["id"],
        "weekday": 2,
        "startsAt": "08:30",
        "endsAt": "10:00",
        "room": "5.111",
        "weeks": [1, 2, 3],
        **fields,
    }
    made = client.post(f"{AT}/{TERM}/series", json=body)
    assert made.status_code == 201, made.text
    return made.json()


def classes(client: TestClient) -> list[tuple[str, str, str]]:
    plan = client.get(f"{AT}/{TERM}").json()
    return [(entry["meetsOn"], entry["startsAt"], entry["room"]) for entry in plan["classes"]]


def test_teaching_weeks_count_from_the_week_of_week_one_and_skip_the_breaks():
    mondays = teaching_mondays("2027-01-13", ["2027-02-15"], 14)
    assert mondays[1].isoformat() == "2027-01-11"
    assert mondays[5].isoformat() == "2027-02-08"
    # The break week takes no number: Week 6 is the week after it.
    assert mondays[6].isoformat() == "2027-02-22"


def test_a_series_is_dated_from_the_semesters_weeks_and_a_holiday_takes_its_class_away(client, section):
    place(client, section)
    plan = client.get(f"{AT}/{TERM}").json()
    assert [entry["meetsOn"] for entry in plan["classes"]] == ["2027-01-12", "2027-01-26"]
    assert [(entry["meetsOn"], entry["holiday"]) for entry in plan["skipped"]] == [("2027-01-19", "A holiday")]
    # The section's own teacher, since the series names nobody else.
    assert {entry["teacherName"] for entry in plan["classes"]} == {"Bilal Maaz"}
    assert plan["sections"][0]["courseCode"] == "MATH-002"


def test_moving_week_one_moves_every_class(client, section):
    place(client, section, weeks=[1])
    settled = client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "2027-01-20", "weeks": 14})
    assert settled.json()["classes"][0]["meetsOn"] == "2027-01-19"


def test_one_class_of_a_series_moves_on_its_own_and_moving_it_back_undoes_it(client, section):
    series = place(client, section)
    moved = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 3, "revision": series["revision"], "changes": {"weekday": 4, "room": "5.104"}},
    )
    assert moved.status_code == 200, moved.text
    assert classes(client) == [("2027-01-12", "08:30", "5.111"), ("2027-01-28", "08:30", "5.104")]
    assert client.get(f"{AT}/{TERM}").json()["classes"][1]["moved"] is True

    back = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={
            "scope": "one",
            "week": 3,
            "revision": moved.json()["revision"],
            "changes": {"weekday": 2, "room": "5.111"},
        },
    )
    assert back.json()["moves"] == []


def test_this_and_following_cuts_the_series_in_two(client, section):
    series = place(client, section, weeks=[1, 2, 3, 4, 5])
    client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 4, "revision": 1, "changes": {"room": "4.021"}},
    )
    later = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "following", "week": 3, "revision": 2, "changes": {"startsAt": "10:15", "endsAt": "11:45"}},
    )
    assert later.status_code == 200, later.text
    assert later.json()["weeks"] == [3, 4, 5]
    plan = client.get(f"{AT}/{TERM}").json()
    assert sorted(each["weeks"] for each in plan["series"]) == [[1, 2], [3, 4, 5]]
    # The week moved on its own was in the part that changed, so it follows the change.
    assert [entry["room"] for entry in plan["classes"] if entry["week"] == 4] == ["5.111"]
    assert [entry["startsAt"] for entry in plan["classes"]] == ["08:30", "10:15", "10:15", "10:15"]


def test_changing_the_whole_series_puts_the_weeks_moved_on_their_own_back_in_line(client, section):
    series = place(client, section)
    client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 2, "revision": 1, "changes": {"weekday": 3}},
    )
    every = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 2, "changes": {"weekday": 5}},
    )
    assert every.json()["moves"] == []
    assert {entry["weekday"] for entry in client.get(f"{AT}/{TERM}").json()["classes"]} == {5}


def test_a_change_made_against_an_old_revision_is_refused_and_says_so(client, section):
    series = place(client, section)
    first = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 1, "changes": {"room": "5.104"}},
    )
    assert first.status_code == 200
    late = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 1, "changes": {"room": "4.021"}},
    )
    assert late.status_code == status.HTTP_409_CONFLICT
    assert "since you opened it" in late.json()["detail"]


def test_deleting_one_the_following_or_all_classes(client, section):
    series = place(client, section, weeks=[1, 2, 3, 4])
    path = f"{AT}/{TERM}/series/{series['id']}"
    assert client.delete(path, params={"scope": "one", "week": 2, "revision": 1}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"][0]["weeks"] == [1, 3, 4]
    assert client.delete(path, params={"scope": "following", "week": 3, "revision": 2}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"][0]["weeks"] == [1]
    assert client.delete(path, params={"scope": "all", "revision": 3}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"] == []


def test_a_class_is_checked_before_it_is_placed(client, section):
    refused = client.post(
        f"{AT}/{TERM}/series",
        json={"sectionId": section["id"], "weekday": 2, "startsAt": "10:00", "endsAt": "09:00", "weeks": [1]},
    )
    assert refused.status_code == 422
    assert "ends after it starts" in refused.json()["detail"]
    beyond = client.post(
        f"{AT}/{TERM}/series",
        json={"sectionId": section["id"], "weekday": 2, "startsAt": "08:30", "endsAt": "10:00", "weeks": [15]},
    )
    assert "teaching weeks are 1 to 14" in beyond.json()["detail"]


def test_a_crn_is_in_a_plan_once(client, section):
    again = client.post(f"{AT}/{TERM}/sections", json={"crn": "22229", "courseCode": "MATH-002"})
    assert again.status_code == 422
    assert "in the plan already" in again.json()["detail"]


def test_the_semester_cannot_end_before_a_week_classes_are_planned_in(client, section):
    place(client, section, weeks=[12])
    shorter = client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "2027-01-13", "weeks": 10})
    assert shorter.status_code == 422
    assert "week 12" in shorter.json()["detail"]


def test_taking_a_class_off_the_plan_takes_its_series_with_it(client, section):
    place(client, section)
    assert client.delete(f"{AT}/{TERM}/sections/{section['id']}").status_code == 204
    plan = client.get(f"{AT}/{TERM}").json()
    assert plan["sections"] == [] and plan["series"] == [] and plan["classes"] == []


def test_a_plan_is_a_semester_of_the_app_linked_to_its_portal_term_with_its_weeks(client, plans, section):
    plan = client.get(f"{AT}/{TERM}").json()
    assert plan["semesterId"] == "plan:262720"
    with plans.engine.connect() as connection:
        link = connection.execute(
            text("SELECT portal_term_code FROM term_links WHERE term_id = 'plan:262720'")
        ).scalar()
        weeks = connection.execute(
            text("SELECT week_one, without FROM term_weeks WHERE term_id = 'plan:262720'")
        ).one()
    # Linked, so its cohorts' sets can be added and checked against the registrar…
    assert link == TERM
    # …and counted in the plan's weeks wherever the app says "Week 5".
    assert weeks[0] == "2027-01-13"
    assert weeks[1] == '["2027-02-15"]'

    client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "", "weeks": 14})
    with plans.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM term_weeks WHERE term_id = 'plan:262720'")).scalar() == 0
