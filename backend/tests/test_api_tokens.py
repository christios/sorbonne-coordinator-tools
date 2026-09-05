"""Tokens for callers that cannot hold a session cookie.

A coordinator at a keyboard has the Google cookie; a script has nothing, and the cookie
is HttpOnly so nothing outside the browser can borrow it. A token is the way in for the
script, and these are the things that must hold: it carries its maker's identity and no
more, it dies when they do, and it cannot make another of itself.
"""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import auth as auth_api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.api_tokens import PREFIX, ApiTokenStore
from sorbonne.services.coordinator_directory import Access
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.student_database import StudentDatabase
from tests.conftest import TEST_DATABASE_URL

TOKENS = "/api/v1/auth/tokens"


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> ApiTokenStore:
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(text("DELETE FROM api_tokens"))
    made = ApiTokenStore(TEST_DATABASE_URL)
    # The gate reads tokens from the deployment's database; here that is the scratch one.
    monkeypatch.setattr(auth_gate, "token_user", made.user_for)
    return made


@pytest.fixture
def signed_in(monkeypatch: pytest.MonkeyPatch, staff_directory: dict[str, Access]):
    """Run the next requests as one coordinator or another, the way the cookie would."""

    def as_person(email: str) -> None:
        access = staff_directory.get(email) or Access(is_admin=False)
        monkeypatch.setattr(
            auth_gate,
            "user_for_request",
            lambda *_args, **_kwargs: StaffUser(email=email, name=email, is_admin=access.is_admin),
        )

    return as_person


@pytest.fixture
def client(store: ApiTokenStore) -> TestClient:
    app.dependency_overrides[auth_api.get_tokens] = lambda: store
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_a_token_is_shown_once_and_then_only_its_first_characters(
    client: TestClient, signed_in, staff_directory: dict[str, Access]
):
    staff_directory["coordinator@sorbonne.ae"] = Access(is_admin=False)
    signed_in("coordinator@sorbonne.ae")

    made = client.post(TOKENS, json={"name": "Timetable load", "days": 7})

    assert made.status_code == status.HTTP_201_CREATED, made.text
    token = made.json()["token"]
    assert token.startswith(PREFIX)
    # The list knows enough to tell two apart, and not enough to use either.
    [held] = client.get(TOKENS).json()["tokens"]
    assert held["name"] == "Timetable load"
    assert held["prefix"] == token[: len(held["prefix"])]
    assert token not in client.get(TOKENS).text


def test_a_token_answers_for_the_person_who_made_it(
    client: TestClient, store: ApiTokenStore, signed_in, staff_directory: dict[str, Access]
):
    # Not the deployment's owner, whose address is an administrator whatever the list says.
    staff_directory["helper@sorbonne.ae"] = Access(is_admin=False)
    signed_in("helper@sorbonne.ae")
    token = client.post(TOKENS, json={"name": "Script"}).json()["token"]

    user = store.user_for(token)

    assert user is not None
    assert (user.email, user.is_admin) == ("helper@sorbonne.ae", False)
    # And it says nothing for a string that was never issued.
    assert store.user_for(f"{PREFIX}not-a-real-token") is None
    assert store.user_for("") is None


def test_a_token_dies_with_its_owner_s_access(
    client: TestClient, store: ApiTokenStore, signed_in, staff_directory: dict[str, Access]
):
    staff_directory["leaver@sorbonne.ae"] = Access(is_admin=False)
    signed_in("leaver@sorbonne.ae")
    token = client.post(TOKENS, json={"name": "Script"}).json()["token"]
    assert store.user_for(token) is not None

    # Removed from the staff list in Settings: the token stops working in the same breath.
    del staff_directory["leaver@sorbonne.ae"]

    assert store.user_for(token) is None


def test_a_revoked_token_stops_working(
    client: TestClient, store: ApiTokenStore, signed_in, staff_directory: dict[str, Access]
):
    staff_directory["coordinator@sorbonne.ae"] = Access(is_admin=False)
    signed_in("coordinator@sorbonne.ae")
    made = client.post(TOKENS, json={"name": "Script"}).json()
    token, token_id = made["token"], made["record"]["id"]

    assert client.delete(f"{TOKENS}/{token_id}").status_code == status.HTTP_204_NO_CONTENT

    assert store.user_for(token) is None
    # It stays in the list, revoked, so it is plain that it once existed.
    [held] = client.get(TOKENS).json()["tokens"]
    assert held["revokedAt"]
    assert client.delete(f"{TOKENS}/{token_id}").status_code == status.HTTP_404_NOT_FOUND


def test_a_coordinator_sees_only_their_own_tokens(
    client: TestClient, signed_in, staff_directory: dict[str, Access]
):
    staff_directory["one@sorbonne.ae"] = Access(is_admin=False)
    staff_directory["two@sorbonne.ae"] = Access(is_admin=False)
    staff_directory["boss@sorbonne.ae"] = Access(is_admin=True)
    signed_in("one@sorbonne.ae")
    client.post(TOKENS, json={"name": "One's"})
    signed_in("two@sorbonne.ae")
    client.post(TOKENS, json={"name": "Two's"})

    assert [row["name"] for row in client.get(TOKENS).json()["tokens"]] == ["Two's"]

    # An administrator sees every token, so a stray one can be found and revoked.
    signed_in("boss@sorbonne.ae")
    assert sorted(row["name"] for row in client.get(TOKENS).json()["tokens"]) == ["One's", "Two's"]


def test_a_token_cannot_mint_another(
    client: TestClient, store: ApiTokenStore, signed_in, staff_directory: dict[str, Access]
):
    staff_directory["coordinator@sorbonne.ae"] = Access(is_admin=False)
    signed_in("coordinator@sorbonne.ae")
    made = client.post(TOKENS, json={"name": "Script"}).json()

    # The one thing a token may not do: turn one leaked string into a permanent way in.
    # A caller with only the token, and no cookie: the gate takes it, and refuses this.
    with TestClient(app) as bare:
        headers = {"Authorization": f"Bearer {made['token']}"}
        assert bare.post(TOKENS, json={"name": "Another"}, headers=headers).status_code == status.HTTP_403_FORBIDDEN
        assert bare.delete(f"{TOKENS}/{made['record']['id']}", headers=headers).status_code == status.HTTP_403_FORBIDDEN
        # It can still do the work it was made for.
        assert bare.get("/api/v1/student-database/cohorts", headers=headers).status_code == status.HTTP_200_OK
