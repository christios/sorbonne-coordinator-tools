"""Each semester's Week 1, so the timetable can count its weeks."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import term_weeks as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.term_weeks import TermWeeks
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/term-weeks"


@pytest.fixture
def client() -> TestClient:
    weeks = TermWeeks(engine_for(TEST_DATABASE_URL))
    with weeks.engine.begin() as connection:
        connection.execute(text("DELETE FROM term_weeks"))
    app.dependency_overrides[api.get_weeks] = lambda: weeks
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_weeks, None)


def test_an_administrator_says_where_a_semesters_week_one_is(client: TestClient):
    assert client.get(AT).json() == {"weeks": {}}

    saved = client.put(f"{AT}/term-1", json={"weekOne": "2026-08-31"})

    assert saved.status_code == status.HTTP_200_OK, saved.text
    assert client.get(AT).json() == {"weeks": {"term-1": "2026-08-31"}}
    # Moved, it moves; blank, it goes.
    client.put(f"{AT}/term-1", json={"weekOne": "2026-09-07"})
    assert client.get(AT).json()["weeks"]["term-1"] == "2026-09-07"
    client.put(f"{AT}/term-1", json={"weekOne": ""})
    assert client.get(AT).json() == {"weeks": {}}


def test_a_date_that_is_not_one_is_refused_in_words(client: TestClient):
    refused = client.put(f"{AT}/term-1", json={"weekOne": "31/08/2026"})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "not a date" in refused.json()["detail"]


def test_only_an_administrator_sets_it_and_anybody_reads_it(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    assert client.get(AT).status_code == status.HTTP_200_OK
    assert client.put(f"{AT}/term-1", json={"weekOne": "2026-08-31"}).status_code == status.HTTP_403_FORBIDDEN
