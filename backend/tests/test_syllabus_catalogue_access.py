"""Who may change the catalogue, now that administering an app is its own thing."""

import os
from uuid import uuid4

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from sorbonne.api.syllabus_catalogues import get_account_access, get_catalogue_store
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_catalogue_store import SyllabusCatalogueStore


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


class Access:
    """What each address may open, without a database in the way.

    The application reads its database from the environment, which in a test run is the
    *development* one, so the real one would answer about whoever is using the platform.
    """

    def __init__(self, apps: dict[str, dict[str, str]] | None = None) -> None:
        self.apps = apps or {}

    def apps_for(self, email: str) -> dict[str, str]:
        return dict(self.apps.get(email.strip().casefold(), {}))


def no_access() -> Access:
    """Nobody has been given anything, unless the test says otherwise."""
    return Access()


@pytest.fixture(autouse=True)
def against_the_test_database():
    app.dependency_overrides[get_catalogue_store] = lambda: SyllabusCatalogueStore(TEST_DATABASE_URL)
    yield
    app.dependency_overrides.pop(get_catalogue_store, None)
    app.dependency_overrides.pop(get_account_access, None)
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_catalogue_items WHERE id ~ '^[0-9a-f-]{36}$'"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def signed_in_as(monkeypatch: pytest.MonkeyPatch, email: str, *, platform_admin: bool = False) -> None:
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email=email, name=email, is_admin=platform_admin),
    )


def a_teaching_preset() -> dict[str, object]:
    return {"label": f"Seminar {uuid4()}", "payload": {"methods": "Discussion"}}


def test_the_syllabus_apps_administrator_maintains_the_catalogue(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The coordinator who keeps these standards need not administer accounts to do it."""
    app.dependency_overrides[get_account_access] = lambda: Access(
        {"chair@sorbonne.ae": {"syllabus": "admin"}}
    )
    signed_in_as(monkeypatch, "chair@sorbonne.ae")

    created = client.post("/api/v1/syllabus-catalogues/teaching-presets", json=a_teaching_preset())

    assert created.status_code == status.HTTP_201_CREATED
    entry = created.json()
    renamed = client.patch(
        f"/api/v1/syllabus-catalogues/teaching-presets/{entry['id']}",
        json={"label": "Seminar, renamed", "payload": entry["payload"], "expectedRevision": entry["revision"]},
    )
    assert renamed.status_code == status.HTTP_200_OK
    assert renamed.json()["label"] == "Seminar, renamed"


def test_whoever_only_writes_syllabi_reads_the_catalogue_and_cannot_rewrite_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A standard somebody can edit while quoting it is not a standard."""
    app.dependency_overrides[get_account_access] = lambda: Access(
        {"prof@sorbonne.ae": {"syllabus": "member"}}
    )
    signed_in_as(monkeypatch, "prof@sorbonne.ae")

    refused = client.post("/api/v1/syllabus-catalogues/teaching-presets", json=a_teaching_preset())

    assert refused.status_code == status.HTTP_403_FORBIDDEN
    # Reading is what the catalogue is for: the outcomes and assessment types they must quote.
    assert client.get("/api/v1/syllabus-catalogues/teaching-presets").status_code == status.HTTP_200_OK


def test_administering_another_app_does_not_maintain_this_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    app.dependency_overrides[get_account_access] = lambda: Access(
        {"registrar@sorbonne.ae": {"database": "admin", "teachers": "admin"}}
    )
    signed_in_as(monkeypatch, "registrar@sorbonne.ae")

    refused = client.post("/api/v1/syllabus-catalogues/teaching-presets", json=a_teaching_preset())

    assert refused.status_code == status.HTTP_403_FORBIDDEN


def test_whoever_hands_out_the_accounts_is_never_locked_out(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """They have been given nothing in this app and can still maintain it, deliberately:
    the person who hands out access cannot be locked out of what they are handing out."""
    app.dependency_overrides[get_account_access] = no_access
    signed_in_as(monkeypatch, "owner@sorbonne.ae", platform_admin=True)

    created = client.post("/api/v1/syllabus-catalogues/teaching-presets", json=a_teaching_preset())

    assert created.status_code == status.HTTP_201_CREATED
