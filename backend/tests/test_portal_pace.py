"""How far apart a sync asks the registrar's timetable about two sections."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import portal_pace as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.portal_pace import PortalPace
from sorbonne.services.staff_auth import StaffUser
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/portal-pace"


@pytest.fixture
def client() -> TestClient:
    pace = PortalPace(engine_for(TEST_DATABASE_URL))
    with pace.engine.begin() as connection:
        connection.execute(text("DELETE FROM portal_pace"))
    app.dependency_overrides[api.get_pace] = lambda: pace
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_pace, None)


def test_nobody_has_set_it_so_it_is_four_seconds(client: TestClient):
    assert client.get(AT).json() == {"secondsApart": 4, "updatedAt": "", "updatedBy": "", "updatedByName": ""}


def test_any_coordinator_sets_it_for_everybody(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    saved = client.put(AT, json={"secondsApart": 6})

    assert saved.status_code == status.HTTP_200_OK, saved.text
    read = client.get(AT).json()
    assert read["secondsApart"] == 6
    assert read["updatedBy"] == "coordinator@sorbonne.ae"
    assert read["updatedAt"]
    # Set again, it is replaced rather than added to.
    assert client.put(AT, json={"secondsApart": 3}).json()["secondsApart"] == 3


@pytest.mark.parametrize("seconds", [0, -2, 61])
def test_never_faster_than_a_second_and_never_slower_than_a_minute(client: TestClient, seconds: int):
    refused = client.put(AT, json={"secondsApart": seconds})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "between 1 and 60 seconds" in refused.json()["detail"]
    assert client.get(AT).json()["secondsApart"] == 4
