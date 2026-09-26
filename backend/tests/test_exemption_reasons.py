"""The reasons a student may not take a course — "LEA track", "Repeater" — kept in Settings."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import exemption_reasons as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.exemption_reasons import ExemptionReasons
from sorbonne.services.staff_auth import StaffUser
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/exemption-reasons"


@pytest.fixture
def reasons() -> ExemptionReasons:
    store = ExemptionReasons(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM exemption_reasons"))
    return store


@pytest.fixture
def client(reasons: ExemptionReasons) -> TestClient:
    app.dependency_overrides[api.get_reasons] = lambda: reasons
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_reasons, None)


def test_an_administrator_keeps_the_list_in_the_order_it_was_given(client: TestClient):
    for label in ("LEA track", "Repeater"):
        assert client.post(AT, json={"label": label}).status_code == status.HTTP_200_OK

    assert [row["label"] for row in client.get(AT).json()["reasons"]] == ["LEA track", "Repeater"]
    # The same words twice are one reason, whatever the case.
    assert client.post(AT, json={"label": "lea  TRACK"}).status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert client.delete(f"{AT}/LEA track").status_code == status.HTTP_200_OK
    assert [row["label"] for row in client.get(AT).json()["reasons"]] == ["Repeater"]
    assert client.delete(f"{AT}/LEA track").status_code == status.HTTP_404_NOT_FOUND


def test_only_an_administrator_changes_the_list_and_anybody_reads_it(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )
    assert client.post(AT, json={"label": "Repeater"}).status_code == status.HTTP_403_FORBIDDEN
    assert client.get(AT).status_code == status.HTTP_200_OK
