"""Who writes the course learning outcomes: one switch, kept by the syllabus builder's administrators."""

import os

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from sorbonne.api.syllabus_catalogues import get_account_access
from sorbonne.api.syllabus_outcome_mode import get_outcome_mode
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_outcome_mode import SyllabusOutcomeMode
from sorbonne.services.engine import engine_for


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


class Access:
    def __init__(self, apps: dict[str, dict[str, str]] | None = None) -> None:
        self.apps = apps or {}

    def apps_for(self, email: str) -> dict[str, str]:
        return dict(self.apps.get(email.strip().casefold(), {}))


@pytest.fixture(autouse=True)
def against_the_test_database():
    app.dependency_overrides[get_outcome_mode] = lambda: SyllabusOutcomeMode(engine_for(TEST_DATABASE_URL))
    app.dependency_overrides[get_account_access] = lambda: Access({"chair@sorbonne.ae": {"syllabus": "admin"}})
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_outcome_mode"))
    yield
    app.dependency_overrides.pop(get_outcome_mode, None)
    app.dependency_overrides.pop(get_account_access, None)
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_outcome_mode"))


def signed_in_as(monkeypatch: pytest.MonkeyPatch, email: str) -> None:
    monkeypatch.setattr(
        auth_gate, "user_for_request", lambda *_args, **_kwargs: StaffUser(email=email, name=email, is_admin=False)
    )


def test_teachers_write_their_outcomes_until_somebody_chooses_otherwise(monkeypatch: pytest.MonkeyPatch) -> None:
    signed_in_as(monkeypatch, "teacher@sorbonne.ae")

    answer = TestClient(app).get("/api/v1/syllabus-outcome-mode")

    assert answer.status_code == status.HTTP_200_OK
    assert answer.json()["mode"] == "teacher"
    assert answer.json()["updatedBy"] == ""


def test_the_builders_administrator_hands_the_outcomes_to_the_head_of_department(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signed_in_as(monkeypatch, "chair@sorbonne.ae")
    client = TestClient(app)

    changed = client.put("/api/v1/syllabus-outcome-mode", json={"mode": "hod"})

    assert changed.status_code == status.HTTP_200_OK
    assert changed.json()["mode"] == "hod"
    assert changed.json()["updatedBy"] == "chair@sorbonne.ae"
    assert client.get("/api/v1/syllabus-outcome-mode").json()["mode"] == "hod"


def test_a_teacher_cannot_change_who_writes_the_outcomes(monkeypatch: pytest.MonkeyPatch) -> None:
    signed_in_as(monkeypatch, "teacher@sorbonne.ae")

    refused = TestClient(app).put("/api/v1/syllabus-outcome-mode", json={"mode": "hod"})

    assert refused.status_code == status.HTTP_403_FORBIDDEN


def test_only_the_two_ways_of_writing_outcomes_are_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    signed_in_as(monkeypatch, "chair@sorbonne.ae")

    refused = TestClient(app).put("/api/v1/syllabus-outcome-mode", json={"mode": "anyone"})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
