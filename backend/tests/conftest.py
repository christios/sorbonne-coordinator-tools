import os

import pytest
from alembic import command
from alembic.config import Config


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


@pytest.fixture(scope="session", autouse=True)
def apply_postgres_migrations() -> None:
    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    try:
        command.upgrade(Config("alembic.ini"), "head")
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url


@pytest.fixture(autouse=True)
def signed_in_coordinator(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every test as a signed-in coordinator.

    The application refuses anonymous callers, so an endpoint test would otherwise be
    testing the sign-in gate rather than the endpoint. Tests that are *about* the gate
    carry `@pytest.mark.anonymous` and see it exactly as an outsider would.
    """
    if request.node.get_closest_marker("anonymous"):
        return

    from sorbonne.config import config
    from sorbonne.services import auth_gate
    from sorbonne.services.staff_auth import StaffUser

    monkeypatch.setattr(config, "google_auth_client_id", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "coordinator@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator"),
    )
