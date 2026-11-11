"""Timetable wishes: a semester's collection, and each teacher's answer to it."""

from __future__ import annotations

import json

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import teacher_wishes as api
from sorbonne.main import app
from sorbonne.services.engine import engine_for
from sorbonne.services.teacher_wishes import WishStore, answer_lines
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/wishes"
TERM = "262720"


@pytest.fixture
def wishes() -> WishStore:
    store = WishStore(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM teacher_wishes"))
        connection.execute(text("DELETE FROM wish_collections"))
        connection.execute(text("DELETE FROM active_teachers WHERE id LIKE 'wish-test-%'"))
        for teacher, name, terms in (
            ("wish-test-bilal", "Bilal Maaz", [TERM, "262710"]),
            ("wish-test-samar", "Samar Ghantous", [TERM]),
            ("wish-test-autumn", "Only Autumn", ["262710"]),
        ):
            connection.execute(
                text("INSERT INTO active_teachers (id, full_name, added_at) VALUES (:id, :name, '2026-11-09')"),
                {"id": teacher, "name": name},
            )
            for term in terms:
                connection.execute(
                    text("INSERT INTO active_teacher_terms (active_id, term_code) VALUES (:id, :term)"),
                    {"id": teacher, "term": term},
                )
    return store


@pytest.fixture
def client(wishes: WishStore) -> TestClient:
    app.dependency_overrides[api.get_wishes] = lambda: wishes
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_wishes, None)


def opened(client: TestClient, **fields: object) -> dict:
    made = client.put(f"{AT}/collection/{TERM}", json={"deadline": "2027-01-10", **fields})
    assert made.status_code == 200, made.text
    return made.json()


def block(kind: str, days: list[int], start: float, end: float, **rest: object) -> dict:
    """A block as the page sends it: every week unless said."""
    return {"kind": kind, "days": days, "from": start, "to": end, **rest}


def test_an_answer_reads_as_its_blocks_constraints_first_then_its_limits():
    blocks = [
        {"id": "p", "kind": "preference", "days": [1], "from": 8, "to": 10, "repeat": "all", "week": "", "comment": ""},
        {"id": "c", "kind": "constraint", "days": [2, 4], "from": 14, "to": 18, "repeat": "all", "week": ""},
    ]
    blocks[1]["comment"] = "Run"
    lines = answer_lines(blocks, {"maxDays": 2, "freeDay": 5}, {"maxDays": "constraint"}, {"freeDay": "Lab"})
    assert [(line["key"], line["level"], line["comment"]) for line in lines] == [
        ("c", "must", "Run"),
        ("p", "would", ""),
        ("maxDays", "must", ""),
        ("freeDay", "would", "Lab"),
    ]


def test_a_block_is_kept_with_its_kind_days_hours_and_repeat(client: TestClient):
    opened(client)
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={
            "blocks": [
                block("constraint", [4, 2], 12.25, 12.75, id="a", comment="  School   run "),
                block("preference", [3], 9, 11, id="b", repeat="from", week="2027-01-18"),
                block("constraint", [5], 0, 24, id="c", repeat="once", week="2027-02-01", comment="Conference"),
            ]
        },
    )
    assert saved.status_code == 200, saved.text
    kept = {each["id"]: each for each in saved.json()["blocks"]}
    assert (kept["a"]["days"], kept["a"]["from"], kept["a"]["to"], kept["a"]["repeat"]) == ([2, 4], 12.25, 12.75, "all")
    assert kept["a"]["comment"] == "School run"
    assert (kept["b"]["repeat"], kept["b"]["week"]) == ("from", "2027-01-18")
    # A whole day away is kept to the grid's hours.
    assert (kept["c"]["from"], kept["c"]["to"], kept["c"]["week"]) == (8, 19, "2027-02-01")


def test_a_block_out_of_shape_is_refused(client: TestClient):
    opened(client, days=[1, 2, 3, 4, 5], firstHour=8, lastHour=19)
    for wrong in (
        block("away", [2], 14, 16),  # neither a constraint nor a preference
        block("constraint", [6], 9, 10),  # Saturday is not on the grid
        block("constraint", [2], 14.1, 16),  # not on a quarter hour
        block("constraint", [2], 16, 14),  # ends before it starts
        block("constraint", [2], 14, 16, repeat="once"),  # one week, but which?
        block("constraint", [2], 14, 16, repeat="once", week="2027-01-19"),  # a Tuesday, not a Monday
        block("constraint", [2], 14, 16, repeat="sometimes"),
    ):
        refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"blocks": [wrong]})
        assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT, wrong


def test_answering_needs_the_semesters_collection_open(client: TestClient):
    refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"blocks": [block("constraint", [2], 14, 16)]})
    assert refused.status_code == status.HTTP_409_CONFLICT
    assert "Open this semester's collection" in refused.json()["detail"]


def test_a_semester_lists_its_teachers_and_who_has_answered(client: TestClient):
    opened(client, message="By 10 January, please.")
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={"blocks": [block("constraint", [2], 14, 18, id="tue")], "limits": {"maxDays": 2}, "submit": True},
    )
    assert saved.status_code == 200, saved.text
    answer = saved.json()
    assert answer["status"] == "submitted" and answer["submittedAt"]
    # A constraint is held to as a Must; a limit is a preference unless said.
    assert [(line["key"], line["level"]) for line in answer["lines"]] == [("tue", "must"), ("maxDays", "would")]
    assert answer["limitKinds"] == {"maxDays": "preference"}

    semester = client.get(AT, params={"term": TERM}).json()
    assert semester["collection"]["message"] == "By 10 January, please."
    assert semester["collection"]["cantCap"] == 12
    rows = {row["name"]: row for row in semester["teachers"] if row["teacherId"].startswith("wish-test-")}
    # The semester's teachers, answered or not; a teacher only of another semester is not one.
    assert set(rows) == {"Bilal Maaz", "Samar Ghantous"}
    assert rows["Bilal Maaz"]["wishes"]["status"] == "submitted"
    assert rows["Samar Ghantous"]["wishes"] is None


def test_constraints_every_week_over_the_cap_are_submitted_only_with_a_reason(client: TestClient):
    opened(client, cantCap=6)
    blocks = [
        block("constraint", [1, 2], 8, 12, id="mornings"),  # eight hours a week, over six
        block("constraint", [3], 8, 19, id="away", repeat="once", week="2027-01-18"),  # a day away is not counted
    ]
    # A draft may be anything: it is still being thought about.
    assert client.put(f"{AT}/{TERM}/wish-test-samar", json={"blocks": blocks}).status_code == 200
    refused = client.put(f"{AT}/{TERM}/wish-test-samar", json={"blocks": blocks, "submit": True})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "8 hours a week of constraints, over the 6" in refused.json()["detail"]
    said = client.put(
        f"{AT}/{TERM}/wish-test-samar",
        json={"blocks": blocks, "submit": True, "overCapReason": "I teach at another university on those mornings."},
    )
    assert said.status_code == 200, said.text
    assert said.json()["overCapReason"].startswith("I teach at another university")
    # Within the cap, with the day away and a preference, no reason is asked for.
    within_cap = [blocks[1], block("preference", [4], 8, 19)]
    fine = client.put(f"{AT}/{TERM}/wish-test-samar", json={"blocks": within_cap, "submit": True})
    assert fine.status_code == 200, fine.text


def test_a_limit_is_a_constraint_or_a_preference_and_keeps_its_comment(client: TestClient):
    opened(client)
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={
            "limits": {"maxDays": 3, "freeDay": 5},
            "limitKinds": {"maxDays": "constraint", "freeDay": "sometimes", "maxInRow": "constraint"},
            "comments": {"maxDays": "  Lab   days ", "maxInRow": "gone", "freeDay": ""},
        },
    ).json()
    assert saved["limitKinds"] == {"maxDays": "constraint", "freeDay": "preference"}
    assert saved["comments"] == {"maxDays": "Lab days"}


def test_an_answer_kept_before_blocks_is_read_as_blocks(client: TestClient, wishes: WishStore):
    """Painted quarter hours, dates away and Must / Would like, as kept until 10 Nov 2026."""
    opened(client)
    with wishes.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO teacher_wishes (term_code, teacher_id, status, cells, limits, away, needs, note,
                        levels, comments, over_cap_reason, source, submitted_at, updated_at, updated_by)
                    VALUES (:term, 'wish-test-bilal', 'submitted', :cells, '{"maxDays": 2}', :away, '', '',
                        '{"cant:14-15:2": "must", "maxDays": "must"}', '{"cant:14-15:2": "School run"}', '',
                        'coordinator', '', '', '')"""),
            {
                "term": TERM,
                "cells": json.dumps(
                    [{"day": 2, "hour": 14 + quarter / 4, "kind": "cant"} for quarter in range(4)]
                    + [{"day": 3, "hour": 9, "kind": "prefer"}]
                ),
                "away": json.dumps([{"from": "2027-01-22", "to": "2027-01-25", "reason": "Conference"}]),
            },
        )
    rows = {row["teacherId"]: row for row in client.get(AT, params={"term": TERM}).json()["teachers"]}
    answer = rows["wish-test-bilal"]["wishes"]
    shapes = [
        (each["kind"], each["days"], each["from"], each["to"], each["repeat"], each["week"], each["comment"])
        for each in answer["blocks"]
    ]
    assert shapes == [
        ("constraint", [2], 14, 15, "all", "", "School run"),
        ("preference", [3], 9, 9.25, "all", "", ""),
        # Friday 22 Jan to Monday 25 Jan: the Friday of one week, the Monday of the next.
        ("constraint", [5, 6, 7], 0, 24, "once", "2027-01-18", "Conference"),
        ("constraint", [1], 0, 24, "once", "2027-01-25", "Conference"),
    ]
    assert answer["limitKinds"] == {"maxDays": "constraint"}


def test_a_semester_gives_its_teaching_weeks_for_marking_time_away(client: TestClient, wishes: WishStore):
    opened(client)
    assert client.get(AT, params={"term": TERM}).json()["calendar"] is None
    with wishes.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO plan_terms (term_code, name, week_one, weeks, without, holidays)
                    VALUES (:term, 'Semester 2', '2027-01-11', 15, '["2027-03-29"]',
                            '[{"date": "2027-02-01", "label": "Holiday"}]')
                    ON CONFLICT (term_code) DO UPDATE SET week_one = excluded.week_one, weeks = excluded.weeks,
                        without = excluded.without, holidays = excluded.holidays"""),
            {"term": TERM},
        )
    try:
        calendar = client.get(AT, params={"term": TERM}).json()["calendar"]
        assert calendar == {
            "weekOne": "2027-01-11",
            "weeks": 15,
            "without": ["2027-03-29"],
            "holidays": [{"date": "2027-02-01", "label": "Holiday"}],
        }
    finally:
        with wishes.engine.begin() as connection:
            connection.execute(text("DELETE FROM plan_terms WHERE term_code = :term"), {"term": TERM})
