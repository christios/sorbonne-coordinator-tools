import os

import pytest
from alembic import command
from alembic.config import Config

from sorbonne.config import config
from sorbonne.services import auth_gate, coordinator_directory
from sorbonne.services.coordinator_directory import Access
from sorbonne.services.staff_auth import StaffUser


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
def all_cohorts(apply_postgres_migrations: None):  # noqa: ARG001 - after the migrations, which make it
    """All cohorts, there for every test and holding only what that test put on it.

    Migration 0099 makes the row, but a test that empties every table takes it too. And a
    test used to clear its languages away by deleting its own cohort; they are All cohorts'
    now, so they would stand in the next test's way under the same code and semester.
    """
    from sqlalchemy import text  # noqa: PLC0415 - only the fixture needs it

    from sorbonne.services.engine import engine_for  # noqa: PLC0415
    from sorbonne.services.student_database import ALL_COHORTS, ALL_COHORTS_NAME  # noqa: PLC0415

    engine = engine_for(TEST_DATABASE_URL)

    def fresh() -> None:
        with engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO student_cohorts (id, name, created_at, updated_at)
                        VALUES (:id, :name, '', '') ON CONFLICT (id) DO NOTHING"""),
                {"id": ALL_COHORTS, "name": ALL_COHORTS_NAME},
            )
            connection.execute(text("DELETE FROM cohort_scopes WHERE cohort_id = :id"), {"id": ALL_COHORTS})

    fresh()
    yield
    fresh()


@pytest.fixture(autouse=True)
def staff_directory(monkeypatch: pytest.MonkeyPatch) -> dict[str, Access]:
    """The invited staff list, in memory: nobody is invited unless a test invites them.

    Sign-in consults this list on every request, and a test should not depend on
    whatever a shared database happens to hold.
    """
    invited: dict[str, Access] = {}
    monkeypatch.setattr(
        coordinator_directory,
        "access_for",
        lambda email, **_kwargs: invited.get(email.strip().casefold()),
    )
    coordinator_directory.forget()
    return invited


@pytest.fixture(autouse=True)
def signed_in_coordinator(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every test as a signed-in coordinator.

    The application refuses anonymous callers, so an endpoint test would otherwise be
    testing the sign-in gate rather than the endpoint. Tests that are *about* the gate
    carry `@pytest.mark.anonymous` and see it exactly as an outsider would.
    """
    if request.node.get_closest_marker("anonymous"):
        return

    monkeypatch.setattr(config, "google_auth_client_id", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "coordinator@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=True),
    )
