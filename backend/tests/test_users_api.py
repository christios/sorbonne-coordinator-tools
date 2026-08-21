"""Managing the staff list from Settings → Users."""

from typing import Any

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.api import users as users_api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.coordinator_directory import AccountAlreadyInvited, AccountNotFound
from sorbonne.services.staff_auth import StaffUser

OWNER = "coordinator@sorbonne.ae"


class FakeDirectory:
    """The staff list, in memory, with the behaviour the endpoints rely on."""

    def __init__(self, accounts: list[dict[str, Any]] | None = None) -> None:
        self.accounts = {account["email"]: account for account in (accounts or [])}

    def list_accounts(self) -> list[dict[str, Any]]:
        return list(self.accounts.values())

    def invite(self, email: str, *, is_admin: bool = False, invited_by: str = "") -> dict[str, Any]:
        if email in self.accounts:
            raise AccountAlreadyInvited(f"{email} has already been invited.")
        self.accounts[email] = {
            "email": email,
            "name": "",
            "isAdmin": is_admin,
            "isActive": True,
            "invitedBy": invited_by,
            "createdAt": "2026-08-22T00:00:00+00:00",
            "lastSeenAt": None,
        }
        return self.accounts[email]

    def update(self, email: str, *, is_admin: bool | None = None, is_active: bool | None = None):
        account = self.accounts.get(email)
        if account is None:
            raise AccountNotFound(f"{email} is not on the staff list.")
        if is_admin is not None:
            account["isAdmin"] = is_admin
        if is_active is not None:
            account["isActive"] = is_active
        return account

    def remove(self, email: str) -> None:
        if self.accounts.pop(email, None) is None:
            raise AccountNotFound(f"{email} is not on the staff list.")


@pytest.fixture
def directory() -> FakeDirectory:
    fake = FakeDirectory()
    app.dependency_overrides[users_api.require_directory] = lambda: fake
    yield fake
    app.dependency_overrides.pop(users_api.require_directory, None)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(config, "coordinator_access_emails", OWNER)
    return TestClient(app)


def sign_in_as(monkeypatch: pytest.MonkeyPatch, email: str, *, is_admin: bool) -> None:
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email=email, name=email, is_admin=is_admin),
    )


def test_an_administrator_invites_promotes_suspends_and_removes(
    client: TestClient, directory: FakeDirectory
):
    invited = client.post("/api/v1/users", json={"email": "New.Colleague@sorbonne.ae"})

    assert invited.status_code == status.HTTP_201_CREATED
    assert invited.json()["email"] == "new.colleague@sorbonne.ae"
    assert invited.json()["isAdmin"] is False
    assert invited.json()["invitedBy"] == OWNER

    listed = client.get("/api/v1/users").json()

    assert [account["email"] for account in listed["accounts"]] == ["new.colleague@sorbonne.ae"]
    assert listed["owners"] == [OWNER]

    promoted = client.patch("/api/v1/users/new.colleague@sorbonne.ae", json={"isAdmin": True})
    assert promoted.json()["isAdmin"] is True

    suspended = client.patch("/api/v1/users/new.colleague@sorbonne.ae", json={"isActive": False})
    assert suspended.json()["isActive"] is False

    assert client.delete("/api/v1/users/new.colleague@sorbonne.ae").status_code == status.HTTP_204_NO_CONTENT
    assert client.get("/api/v1/users").json()["accounts"] == []


def test_the_same_address_is_not_invited_twice(client: TestClient, directory: FakeDirectory):
    client.post("/api/v1/users", json={"email": "colleague@sorbonne.ae"})

    again = client.post("/api/v1/users", json={"email": "colleague@sorbonne.ae"})

    assert again.status_code == status.HTTP_409_CONFLICT


def test_an_address_that_is_not_an_address_is_refused(client: TestClient, directory: FakeDirectory):
    response = client.post("/api/v1/users", json={"email": "colleague"})

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert directory.accounts == {}


def test_an_owner_is_changed_in_the_environment_not_here(client: TestClient, directory: FakeDirectory):
    for response in (
        client.post("/api/v1/users", json={"email": OWNER}),
        client.patch(f"/api/v1/users/{OWNER}", json={"isAdmin": False}),
        client.delete(f"/api/v1/users/{OWNER}"),
    ):
        assert response.status_code == status.HTTP_409_CONFLICT
        assert "COORDINATOR_ACCESS_EMAILS" in response.json()["detail"]


def test_nobody_locks_the_door_behind_themselves(
    client: TestClient, directory: FakeDirectory, monkeypatch: pytest.MonkeyPatch
):
    sign_in_as(monkeypatch, "deputy@sorbonne.ae", is_admin=True)
    directory.invite("deputy@sorbonne.ae", is_admin=True)

    demoted = client.patch("/api/v1/users/deputy@sorbonne.ae", json={"isAdmin": False})
    removed = client.delete("/api/v1/users/deputy@sorbonne.ae")

    assert demoted.status_code == status.HTTP_409_CONFLICT
    assert removed.status_code == status.HTTP_409_CONFLICT
    assert directory.accounts["deputy@sorbonne.ae"]["isAdmin"] is True


def test_somebody_who_is_not_an_administrator_cannot_see_or_change_the_staff_list(
    client: TestClient, directory: FakeDirectory, monkeypatch: pytest.MonkeyPatch
):
    sign_in_as(monkeypatch, "colleague@sorbonne.ae", is_admin=False)

    listed = client.get("/api/v1/users")
    invited = client.post("/api/v1/users", json={"email": "friend@sorbonne.ae"})

    assert listed.status_code == status.HTTP_403_FORBIDDEN
    assert invited.status_code == status.HTTP_403_FORBIDDEN
    assert directory.accounts == {}


def test_an_account_that_was_never_invited_cannot_be_edited(client: TestClient, directory: FakeDirectory):
    assert client.patch("/api/v1/users/stranger@sorbonne.ae", json={"isAdmin": True}).status_code == (
        status.HTTP_404_NOT_FOUND
    )
    assert client.delete("/api/v1/users/stranger@sorbonne.ae").status_code == status.HTTP_404_NOT_FOUND
