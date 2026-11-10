"""Claude, connected as a coordinator who allowed it to read.

The whole of what a custom connector does, end to end, as Claude's servers would: find
where to sign in from the connector's 401, register, send the coordinator to allow it,
trade the code for a key, read through the connector, renew. And what must hold: only
Claude may register, a code works once and only with its verifier, a renewal works once,
the key reads and changes nothing, and it stops when the coordinator disconnects it or
leaves the staff list.
"""

from __future__ import annotations

import base64
import re
import secrets
from hashlib import sha256
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import auth as auth_api
from sorbonne.api import connector as connector_api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.connector_auth import HOSTED_CALLBACK, ConnectorStore
from sorbonne.services.coordinator_directory import Access
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.student_database import StudentDatabase
from tests.conftest import TEST_DATABASE_URL

# As an outsider sees it: Claude's servers carry no cookie, and the gate is part of the test.
pytestmark = pytest.mark.anonymous

COORDINATOR = "patricia@sorbonne.ae"


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch, staff_directory: dict[str, Access]) -> ConnectorStore:
    monkeypatch.setattr(config, "google_auth_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "owner@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")
    staff_directory[COORDINATOR] = Access(is_admin=False)
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(text("DELETE FROM connector_grants"))
        connection.execute(text("DELETE FROM oauth_codes"))
        connection.execute(text("DELETE FROM oauth_clients"))
    made = ConnectorStore(TEST_DATABASE_URL)
    # The gate reads keys from the deployment's database; here that is the scratch one.
    monkeypatch.setattr(auth_gate, "connector_user", made.user_for)
    app.dependency_overrides[connector_api.get_connectors] = lambda: made
    app.dependency_overrides[auth_api.get_connectors] = lambda: made
    yield made
    app.dependency_overrides.clear()


@pytest.fixture
def browser(monkeypatch: pytest.MonkeyPatch):
    """This browser, signed in as somebody — or, with None, not signed in at all."""

    def signed_in_as(email: str | None) -> None:
        user = StaffUser(email=email, name=email, is_admin=False) if email else None
        monkeypatch.setattr(connector_api, "signed_in_user", lambda _request: user)
        monkeypatch.setattr(auth_gate, "user_for_request", lambda *_args, **_kwargs: user)

    signed_in_as(COORDINATOR)
    return signed_in_as


@pytest.fixture
def client(store: ConnectorStore) -> TestClient:
    return TestClient(app)


def _challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(sha256(verifier.encode()).digest()).decode().rstrip("=")


def _register(client: TestClient, callback: str = HOSTED_CALLBACK) -> str:
    made = client.post(
        "/oauth/register",
        json={"client_name": "Claude", "redirect_uris": [callback], "token_endpoint_auth_method": "none"},
    )
    assert made.status_code == status.HTTP_201_CREATED, made.text
    return made.json()["client_id"]


def _ask(client: TestClient, client_id: str, verifier: str) -> dict[str, str]:
    return {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": HOSTED_CALLBACK,
        "code_challenge": _challenge(verifier),
        "code_challenge_method": "S256",
        "state": "claude-state",
        "scope": "read",
    }


def _allow(client: TestClient, client_id: str, verifier: str, decision: str = "allow"):
    asked = _ask(client, client_id, verifier)
    page = client.get("/oauth/authorize", params=asked)
    assert page.status_code == status.HTTP_200_OK, page.text
    proof = re.search(r'name="proof" value="([0-9a-f]+)"', page.text).group(1)
    fields = {name: value for name, value in asked.items() if name != "response_type"}
    return client.post("/oauth/authorize", data={**fields, "proof": proof, "decision": decision}, follow_redirects=False)


def _code(answer) -> str:
    assert answer.status_code == status.HTTP_302_FOUND, answer.text
    sent_to = urlsplit(answer.headers["location"])
    assert f"{sent_to.scheme}://{sent_to.netloc}{sent_to.path}" == HOSTED_CALLBACK
    query = parse_qs(sent_to.query)
    assert query["state"] == ["claude-state"]
    return query["code"][0]


def _exchange(client: TestClient, client_id: str, code: str, verifier: str):
    return client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "redirect_uri": HOSTED_CALLBACK,
            "code_verifier": verifier,
        },
    )


def _connect(client: TestClient) -> tuple[str, dict]:
    client_id = _register(client)
    verifier = secrets.token_urlsafe(48)
    keys = _exchange(client, client_id, _code(_allow(client, client_id, verifier)), verifier)
    assert keys.status_code == status.HTTP_200_OK, keys.text
    return client_id, keys.json()


def _mcp(client: TestClient, key: str, method: str, params: dict | None = None):
    return client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
        headers={"Authorization": f"Bearer {key}"},
    )


def test_claude_finds_where_to_sign_in_from_the_connector_s_refusal(client: TestClient, browser):
    browser(None)

    refused = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})

    assert refused.status_code == status.HTTP_401_UNAUTHORIZED
    pointer = "http://testserver/.well-known/oauth-protected-resource/mcp"
    assert refused.headers["www-authenticate"] == f'Bearer resource_metadata="{pointer}"'
    resource = client.get(pointer).json()
    assert resource["resource"] == "http://testserver/mcp"
    assert resource["authorization_servers"] == ["http://testserver"]
    server = client.get("/.well-known/oauth-authorization-server").json()
    assert server["issuer"] == "http://testserver"
    assert server["code_challenge_methods_supported"] == ["S256"]
    assert server["token_endpoint_auth_methods_supported"] == ["none"]
    assert server["registration_endpoint"] == "http://testserver/oauth/register"
    # Elsewhere, the refusal stays as it was: only the connector points at a sign-in.
    assert "www-authenticate" not in client.get("/api/v1/rooms").headers


def test_only_claude_may_register(client: TestClient):
    _register(client, HOSTED_CALLBACK)
    # Claude Code comes back to this machine, on a port of its own.
    _register(client, "http://localhost:53280/callback")
    _register(client, "http://127.0.0.1:41234/callback")

    for elsewhere in ["https://claude.ai.example.com/api/mcp/auth_callback", "https://example.com/callback",
                      "http://localhost:53280/elsewhere"]:
        refused = client.post("/oauth/register", json={"redirect_uris": [elsewhere]})
        assert refused.status_code == status.HTTP_400_BAD_REQUEST, elsewhere
        assert refused.json()["error"] == "invalid_redirect_uri"


def test_the_coordinator_signs_in_first_when_this_browser_has_not(client: TestClient, browser):
    browser(None)
    client_id = _register(client)

    page = client.get("/oauth/authorize", params=_ask(client, client_id, secrets.token_urlsafe(48)))

    assert "Sign in to connect Claude" in page.text
    assert 'data-client_id="client-id.apps.googleusercontent.com"' in page.text
    # Nothing to allow until somebody is signed in.
    assert 'name="proof"' not in page.text
    # And nothing can frame it, to trick a click.
    assert page.headers["x-frame-options"] == "DENY"


def test_a_coordinator_allows_claude_and_it_reads_as_them_and_changes_nothing(client: TestClient, browser):
    _, keys = _connect(client)
    key = keys["access_token"]
    assert keys["token_type"] == "Bearer"
    assert keys["refresh_token"]

    started = _mcp(client, key, "initialize", {"protocolVersion": "2025-06-18"}).json()["result"]
    assert started["protocolVersion"] == "2025-06-18"
    assert started["serverInfo"]["name"] == "scen-coordinator-tools"
    tools = _mcp(client, key, "tools/list").json()["result"]["tools"]
    assert [tool["name"] for tool in tools] == ["find_endpoints", "read"]

    found = _mcp(client, key, "tools/call", {"name": "find_endpoints", "arguments": {"search": "rooms"}})
    assert "GET /api/v1/rooms" in found.json()["result"]["content"][0]["text"]
    read = _mcp(client, key, "tools/call", {"name": "read", "arguments": {"path": "/api/v1/rooms"}}).json()
    assert read["result"]["isError"] is False, read
    # Signing in and keys are not Claude's to read.
    refused = _mcp(client, key, "tools/call", {"name": "read", "arguments": {"path": "/api/v1/auth/tokens"}}).json()
    assert refused["result"]["isError"] is True

    # The key itself changes nothing, wherever it is sent.
    changed = client.post("/api/v1/rooms", json={"code": "9.999"}, headers={"Authorization": f"Bearer {key}"})
    assert changed.status_code == status.HTTP_403_FORBIDDEN
    made = client.post("/api/v1/auth/tokens", json={"name": "x"}, headers={"Authorization": f"Bearer {key}"})
    assert made.status_code == status.HTTP_403_FORBIDDEN

    # And the coordinator sees the connection in Settings.
    listed = client.get("/api/v1/auth/connections").json()
    assert listed["connectorUrl"] == "http://testserver/mcp"
    assert [(row["email"], row["clientName"]) for row in listed["connections"]] == [(COORDINATOR, "Claude")]


def test_cancel_sends_claude_back_with_nothing(client: TestClient, browser):
    client_id = _register(client)

    answer = _allow(client, client_id, secrets.token_urlsafe(48), decision="deny")

    query = parse_qs(urlsplit(answer.headers["location"]).query)
    assert query["error"] == ["access_denied"]
    assert "code" not in query


def test_an_answer_this_page_did_not_ask_for_is_refused(client: TestClient, browser):
    client_id = _register(client)
    asked = _ask(client, client_id, secrets.token_urlsafe(48))
    fields = {name: value for name, value in asked.items() if name != "response_type"}

    forged = client.post("/oauth/authorize", data={**fields, "proof": "0" * 64, "decision": "allow"}, follow_redirects=False)

    assert forged.status_code == status.HTTP_400_BAD_REQUEST
    assert "location" not in forged.headers


def test_a_code_works_once_and_only_with_its_verifier(client: TestClient, browser):
    client_id = _register(client)
    verifier = secrets.token_urlsafe(48)
    code = _code(_allow(client, client_id, verifier))

    guessed = _exchange(client, client_id, code, secrets.token_urlsafe(48))
    assert guessed.status_code == status.HTTP_400_BAD_REQUEST
    assert guessed.json()["error"] == "invalid_grant"
    # Spent by the wrong guess, so the right verifier is too late.
    assert _exchange(client, client_id, code, verifier).json()["error"] == "invalid_grant"


def test_a_renewal_works_once(client: TestClient, browser):
    client_id, keys = _connect(client)

    renewed = client.post(
        "/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": keys["refresh_token"]}
    )
    assert renewed.status_code == status.HTTP_200_OK, renewed.text
    assert _mcp(client, renewed.json()["access_token"], "ping").status_code == status.HTTP_200_OK

    again = client.post(
        "/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": keys["refresh_token"]}
    )
    assert again.json()["error"] == "invalid_grant"
    # The key it replaced is gone with it.
    browser(None)
    assert _mcp(client, keys["access_token"], "ping").status_code == status.HTTP_401_UNAUTHORIZED


def test_disconnecting_stops_claude_at_once(client: TestClient, browser):
    _, keys = _connect(client)
    [connection] = client.get("/api/v1/auth/connections").json()["connections"]

    assert client.delete(f"/api/v1/auth/connections/{connection['id']}").status_code == status.HTTP_204_NO_CONTENT

    browser(None)
    assert _mcp(client, keys["access_token"], "ping").status_code == status.HTTP_401_UNAUTHORIZED


def test_leaving_the_staff_list_stops_claude_too(client: TestClient, browser, staff_directory: dict[str, Access]):
    client_id, keys = _connect(client)

    del staff_directory[COORDINATOR]
    browser(None)

    assert _mcp(client, keys["access_token"], "ping").status_code == status.HTTP_401_UNAUTHORIZED
    renewed = client.post(
        "/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": keys["refresh_token"]}
    )
    assert renewed.json()["error"] == "invalid_grant"
