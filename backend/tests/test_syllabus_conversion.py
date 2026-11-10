"""The one-off conversion of every syllabus's graded activities into its schedule (November 2026)."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from sorbonne.api.syllabi import get_account_access, get_store
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.account_access import AccountAccess
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_store import SyllabusStore

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)
ADMIN = StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=True)
TEACHER = StaffUser(email="professor@sorbonne.ae", name="A Professor")


def _no_syllabi() -> None:
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_field_history"))
        connection.execute(text("DELETE FROM syllabi"))


@pytest.fixture(autouse=True)
def against_the_test_database():
    # The run sweeps every syllabus, so it starts from none: other tests leave theirs behind.
    _no_syllabi()
    app.dependency_overrides[get_store] = lambda: SyllabusStore(TEST_DATABASE_URL)
    app.dependency_overrides[get_account_access] = lambda: AccountAccess(TEST_DATABASE_URL)
    yield
    app.dependency_overrides.pop(get_store, None)
    app.dependency_overrides.pop(get_account_access, None)
    _no_syllabi()


@pytest.fixture
def client(monkeypatch) -> TestClient:
    people = {user.email: user for user in (ADMIN, TEACHER)}
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda _cookie, authorization, **_kwargs: people.get((authorization or "").removeprefix("Bearer ").strip()),
    )
    return TestClient(app)


def an_older_syllabus(store: SyllabusStore) -> dict:
    created = store.create(course_title="Optics", course_code="PHYS-118", academic_year="2025-2026")
    return store.update(
        created["id"],
        expected_revision=created["revision"],
        content={
            "schedule": [{"id": "s1", "week": "1", "topic": "Rays", "assessments": "Quiz"}],
            "assessment": {"aiPolicy": "AI Prohibited", "items": [{"id": "a1", "name": "Quiz"}]},
        },
    )


def test_a_dry_run_reports_what_would_change_and_changes_nothing(client: TestClient) -> None:
    store = SyllabusStore(TEST_DATABASE_URL)
    older = an_older_syllabus(store)

    answer = client.post(
        "/api/v1/syllabi/convert-v2", json={"dryRun": True}, headers={"Authorization": f"Bearer {ADMIN.email}"}
    )

    assert answer.status_code == 200
    body = answer.json()
    assert body["totals"] == {
        "syllabi": 1,
        "gradedActivities": 1,
        "withoutWeek": 1,
        "inheritedAiPolicy": 1,
        "earlierNotes": 1,
    }
    assert body["syllabi"][0]["outcome"] == "would convert"
    assert store.get(older["id"])["revision"] == older["revision"]


def test_the_run_converts_every_older_syllabus_once(client: TestClient) -> None:
    store = SyllabusStore(TEST_DATABASE_URL)
    older = an_older_syllabus(store)
    store.create(course_title="Already new", course_code="PHYS-119", academic_year="2026-2027")
    as_admin = {"Authorization": f"Bearer {ADMIN.email}"}

    first = client.post("/api/v1/syllabi/convert-v2", json={"dryRun": False}, headers=as_admin).json()
    again = client.post("/api/v1/syllabi/convert-v2", json={"dryRun": False}, headers=as_admin).json()

    converted = store.get(older["id"])
    assert [item["outcome"] for item in first["syllabi"]] == ["converted"]
    assert converted["content"]["schemaVersion"] == 2
    assert converted["revision"] == older["revision"] + 1
    assert again["syllabi"] == []


def test_only_a_platform_administrator_can_run_it(client: TestClient) -> None:
    answer = client.post(
        "/api/v1/syllabi/convert-v2", json={"dryRun": True}, headers={"Authorization": f"Bearer {TEACHER.email}"}
    )

    assert answer.status_code == 403
