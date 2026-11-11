"""Timetable wishes: a semester's collection, and each teacher's answer to it."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import teacher_wishes as api
from sorbonne.main import app
from sorbonne.services.engine import engine_for
from sorbonne.services.teacher_wishes import WishStore, wish_lines
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


def cant(day: int, start: float, end: float) -> list[dict]:
    """Every quarter of an hour from `start` to `end` on a day, painted can't-teach."""
    return [{"day": day, "hour": start + quarter / 4, "kind": "cant"} for quarter in range(int((end - start) * 4))]


def test_cant_hours_are_joined_into_blocks_and_the_same_block_on_several_days_is_one_wish():
    cells = (
        cant(2, 14, 18)
        + cant(4, 14, 18)
        + cant(5, 8, 10)
        + [
            {"day": 1, "hour": 8, "kind": "prefer"},
            {"day": 3, "hour": 9, "kind": "prefer"},
        ]
    )
    lines = wish_lines(cells, {"maxDays": 2, "freeDay": 5})
    assert [line["key"] for line in lines] == ["cant:14-18:2,4", "cant:8-10:5", "prefer", "maxDays", "freeDay"]
    assert (lines[0]["days"], lines[0]["from"], lines[0]["to"]) == ([2, 4], 14, 18)


def test_a_block_can_start_and_end_on_the_quarter_hour(client: TestClient):
    opened(client)
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal", json={"cells": cant(3, 12.25, 12.75), "levels": {"cant:12.25-12.75:3": "must"}}
    ).json()
    assert [(line["key"], line["level"]) for line in saved["lines"]] == [("cant:12.25-12.75:3", "must")]
    assert [cell["hour"] for cell in saved["cells"]] == [12.25, 12.5]
    off = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"cells": [{"day": 3, "hour": 12.1, "kind": "cant"}]})
    assert off.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_answering_needs_the_semesters_collection_open(client: TestClient):
    refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"cells": cant(2, 14, 16)})
    assert refused.status_code == status.HTTP_409_CONFLICT
    assert "Open this semester's collection" in refused.json()["detail"]


def test_a_semester_lists_its_teachers_and_who_has_answered(client: TestClient):
    opened(client, message="By 10 January, please.")
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={"cells": cant(2, 14, 18), "limits": {"maxDays": 2}, "levels": {"cant:14-18:2": "must"}, "submit": True},
    )
    assert saved.status_code == 200, saved.text
    answer = saved.json()
    assert answer["status"] == "submitted" and answer["submittedAt"]
    # Every wish is ranked: what nobody said a Must of is a Would like.
    assert [(line["key"], line["level"]) for line in answer["lines"]] == [
        ("cant:14-18:2", "must"),
        ("maxDays", "would"),
    ]

    semester = client.get(AT, params={"term": TERM}).json()
    assert semester["collection"]["message"] == "By 10 January, please."
    assert semester["collection"]["mustQuota"] == 3 and semester["collection"]["cantCap"] == 12
    rows = {row["name"]: row for row in semester["teachers"] if row["teacherId"].startswith("wish-test-")}
    # The semester's teachers, answered or not; a teacher only of another semester is not one.
    assert set(rows) == {"Bilal Maaz", "Samar Ghantous"}
    assert rows["Bilal Maaz"]["wishes"]["status"] == "submitted"
    assert rows["Samar Ghantous"]["wishes"] is None


def test_no_more_musts_than_the_quota(client: TestClient):
    opened(client, mustQuota=2)
    cells = cant(1, 8, 9) + cant(2, 10, 11) + cant(3, 12, 13)
    levels = {"cant:8-9:1": "must", "cant:10-11:2": "must", "cant:12-13:3": "must"}
    refused = client.put(f"{AT}/{TERM}/wish-test-samar", json={"cells": cells, "levels": levels})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert refused.json()["detail"] == "At most 2 preferences can be a Must. Choose which 2 matter most."


def test_cant_teach_time_over_the_cap_is_submitted_only_with_a_reason(client: TestClient):
    opened(client, cantCap=6)
    cells = cant(1, 8, 12) + cant(2, 8, 12)  # eight hours, over six
    # A draft may be anything: it is still being thought about.
    assert client.put(f"{AT}/{TERM}/wish-test-samar", json={"cells": cells}).status_code == 200
    refused = client.put(f"{AT}/{TERM}/wish-test-samar", json={"cells": cells, "submit": True})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "8 hours you can't teach, over the 6" in refused.json()["detail"]
    said = client.put(
        f"{AT}/{TERM}/wish-test-samar",
        json={"cells": cells, "submit": True, "overCapReason": "I teach at another university on those mornings."},
    )
    assert said.status_code == 200, said.text
    assert said.json()["overCapReason"].startswith("I teach at another university")


def test_a_painted_hour_outside_the_grid_is_refused(client: TestClient):
    opened(client, days=[1, 2, 3, 4, 5], firstHour=8, lastHour=19)
    for cell in ({"day": 6, "hour": 9, "kind": "cant"}, {"day": 1, "hour": 19, "kind": "cant"}):
        refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"cells": [cell]})
        assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_rank_for_a_wish_no_longer_there_is_dropped(client: TestClient):
    opened(client)
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={"cells": cant(2, 14, 16), "levels": {"cant:14-18:2": "must", "cant:14-16:2": "must"}},
    ).json()
    assert saved["levels"] == {"cant:14-16:2": "must"}


def test_a_wish_keeps_its_comment_while_the_answer_still_makes_it(client: TestClient):
    opened(client)
    saved = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={
            "cells": cant(2, 14, 16),
            "limits": {"maxDays": 3},
            "comments": {"cant:14-16:2": "  School   run ", "maxDays": "Lab days", "cant:8-9:1": "gone", "freeDay": ""},
        },
    ).json()
    assert saved["comments"] == {"cant:14-16:2": "School run", "maxDays": "Lab days"}
    assert [line["comment"] for line in saved["lines"]] == ["School run", "Lab days"]


def test_dates_away_end_on_or_after_they_start(client: TestClient):
    opened(client)
    refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"away": [{"from": "2027-03-19", "to": "2027-03-15"}]})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    kept = client.put(
        f"{AT}/{TERM}/wish-test-bilal",
        json={"away": [{"from": "2027-03-15", "to": "2027-03-19", "reason": "Conference"}]},
    ).json()
    assert kept["away"] == [{"from": "2027-03-15", "to": "2027-03-19", "reason": "Conference"}]


def test_part_of_a_day_away_is_kept_with_its_hours(client: TestClient):
    opened(client)
    afternoon = {"from": "2027-03-16", "to": "2027-03-16", "reason": "Doctor", "start": 14, "end": 16.5}
    kept = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"away": [afternoon]})
    assert kept.status_code == 200, kept.text
    assert kept.json()["away"] == [afternoon]
    for wrong in (
        {"from": "2027-03-16", "to": "2027-03-17", "start": 14, "end": 16},  # hours on more than one day
        {"from": "2027-03-16", "to": "2027-03-16", "start": 16, "end": 14},  # ends before it starts
        {"from": "2027-03-16", "to": "2027-03-16", "start": 14.1, "end": 16},  # not on a quarter hour
        {"from": "2027-03-16", "to": "2027-03-16", "start": 14},  # no end
    ):
        refused = client.put(f"{AT}/{TERM}/wish-test-bilal", json={"away": [wrong]})
        assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT, wrong


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
