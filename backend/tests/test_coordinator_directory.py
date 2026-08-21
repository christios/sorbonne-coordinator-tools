import os
from uuid import uuid4

import pytest

from sorbonne.services import coordinator_directory
from sorbonne.services.coordinator_directory import (
    AccountAlreadyInvited,
    AccountNotFound,
    CoordinatorDirectory,
    InvalidEmail,
    access_for,
    forget,
)


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


@pytest.fixture
def directory() -> CoordinatorDirectory:
    return CoordinatorDirectory(TEST_DATABASE_URL)


def an_address() -> str:
    return f"colleague-{uuid4().hex[:8]}@sorbonne.ae"


def test_an_invited_coordinator_is_admitted_and_can_be_promoted(directory: CoordinatorDirectory):
    email = an_address()

    invited = directory.invite(email, invited_by="Head@Sorbonne.ae")

    assert invited["email"] == email
    assert invited["isAdmin"] is False
    assert invited["isActive"] is True
    assert invited["invitedBy"] == "head@sorbonne.ae"
    assert invited["lastSeenAt"] is None
    assert directory.access(email).is_admin is False

    promoted = directory.update(email, is_admin=True)

    assert promoted["isAdmin"] is True
    assert directory.access(email).is_admin is True
    assert email in {account["email"] for account in directory.list_accounts()}


def test_an_address_is_stored_the_way_it_is_compared(directory: CoordinatorDirectory):
    email = an_address()

    directory.invite(f"  {email.upper()}  ")

    assert directory.get(email)["email"] == email
    assert directory.access(email.upper()) is not None


def test_a_suspended_coordinator_is_no_longer_admitted(directory: CoordinatorDirectory):
    email = an_address()
    directory.invite(email)

    directory.update(email, is_active=False)

    assert directory.access(email) is None
    assert directory.get(email)["isActive"] is False


def test_a_removed_coordinator_is_gone(directory: CoordinatorDirectory):
    email = an_address()
    directory.invite(email)

    directory.remove(email)

    assert directory.access(email) is None
    with pytest.raises(AccountNotFound):
        directory.get(email)
    with pytest.raises(AccountNotFound):
        directory.remove(email)


def test_signing_in_records_the_name_and_the_moment(directory: CoordinatorDirectory):
    email = an_address()
    directory.invite(email)

    directory.record_sign_in(email, "Dr Example")

    account = directory.get(email)
    assert account["name"] == "Dr Example"
    assert account["lastSeenAt"]


def test_nobody_is_invited_twice_or_by_a_typo(directory: CoordinatorDirectory):
    email = an_address()
    directory.invite(email)

    with pytest.raises(AccountAlreadyInvited):
        directory.invite(email)
    with pytest.raises(InvalidEmail):
        directory.invite("not-an-address")


def test_an_answer_is_cached_briefly_and_dropped_when_access_changes(monkeypatch: pytest.MonkeyPatch):
    # Imported by name above, because the test suite otherwise answers this question
    # from memory rather than from the module under test (see tests/conftest.py).
    asked: list[str] = []
    monkeypatch.setattr(
        coordinator_directory,
        "directory",
        lambda: _Recording(asked),
    )
    forget()

    access_for("someone@sorbonne.ae", now=100.0)
    access_for("someone@sorbonne.ae", now=105.0)

    assert asked == ["someone@sorbonne.ae"]

    forget("Someone@Sorbonne.ae")
    access_for("someone@sorbonne.ae", now=106.0)

    assert asked == ["someone@sorbonne.ae"] * 2

    access_for("someone@sorbonne.ae", now=200.0)

    assert asked == ["someone@sorbonne.ae"] * 3


class _Recording:
    """Stands in for the database, and counts how often it is asked."""

    def __init__(self, asked: list[str]) -> None:
        self.asked = asked

    def access(self, email: str) -> None:
        self.asked.append(email)
