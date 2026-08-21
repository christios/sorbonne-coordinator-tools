"""Nothing but the sign-in screen answers an anonymous caller.

The route sweep walks the application's own routing table rather than a list kept
here, so a router added later is covered by this test the day it is mounted.
"""

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.auth_gate import PUBLIC_PATHS, is_public
from sorbonne.services.staff_auth import SESSION_COOKIE, StaffUser, issue_session

STAFF = StaffUser(email="coordinator@sorbonne.ae", name="Coordinator")
pytestmark = pytest.mark.anonymous
# The application had 38 API operations when this sweep was written.
EXPECTED_ROUTE_FLOOR = 30


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_auth_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "coordinator@sorbonne.ae, dean@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def protected_api_routes() -> list[tuple[str, str]]:
    """(method, path) for every API route that is not part of signing in.

    Read from the application's own OpenAPI schema, so a router mounted later is
    swept without anyone remembering to add it here.
    """
    calls = []
    for path, operations in sorted(app.openapi()["paths"].items()):
        if not path.startswith("/api/") or path in PUBLIC_PATHS:
            continue
        for method in sorted(operations):
            if method.upper() in {"HEAD", "OPTIONS", "TRACE"}:
                continue
            # Path parameters only need to be syntactically present to reach the gate.
            filled = path.format(**{name: "x" for name in _parameters(path)})
            calls.append((method.upper(), filled))
    return calls


def _parameters(path: str) -> list[str]:
    return [segment.split("}")[0] for segment in path.split("{")[1:]]


def test_the_route_sweep_actually_found_the_application(configured: None):
    assert len(protected_api_routes()) > EXPECTED_ROUTE_FLOOR


@pytest.mark.parametrize(("method", "path"), protected_api_routes(), ids=str)
def test_every_api_route_refuses_an_anonymous_caller(
    client: TestClient, configured: None, method: str, path: str
):
    response = client.request(method, path)

    assert response.status_code == status.HTTP_401_UNAUTHORIZED, f"{method} {path} answered anonymously"
    assert response.json()["detail"] == "Sign in to continue."


def test_the_handbook_is_behind_sign_in_too(client: TestClient, configured: None):
    assert client.get("/handbook/").status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get("/handbook/procedures/grades/").status_code == status.HTTP_401_UNAUTHORIZED


def test_the_health_check_and_sign_in_screen_stay_reachable(client: TestClient, configured: None):
    assert client.get("/healthcheck").status_code == status.HTTP_200_OK
    assert client.get("/api/v1/auth/config").status_code == status.HTTP_200_OK


def test_the_static_app_shell_is_public_so_the_sign_in_screen_can_load():
    assert is_public("/")
    assert is_public("/syllabus")
    assert is_public("/assets/index-abc123.js")
    assert not is_public("/api/v1/syllabi")
    assert not is_public("/handbook/")


def test_a_signed_in_coordinator_is_let_through(client: TestClient, configured: None):
    client.cookies.set(SESSION_COOKIE, issue_session(STAFF))

    response = client.get("/api/v1/auth/me")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["email"] == "coordinator@sorbonne.ae"


def test_a_forged_cookie_is_not_a_session(client: TestClient, configured: None):
    client.cookies.set(SESSION_COOKIE, "eyJlbWFpbCI6ICJpbnRydWRlckBleGFtcGxlLmNvbSJ9.not-a-signature")

    assert client.get("/api/v1/auth/me").status_code == status.HTTP_401_UNAUTHORIZED


def test_removing_someone_from_the_allowlist_ends_their_session(
    client: TestClient, configured: None, monkeypatch: pytest.MonkeyPatch
):
    client.cookies.set(SESSION_COOKIE, issue_session(STAFF))
    assert client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

    monkeypatch.setattr(config, "coordinator_access_emails", "dean@sorbonne.ae")

    assert client.get("/api/v1/auth/me").status_code == status.HTTP_401_UNAUTHORIZED


def test_an_unconfigured_deployment_closes_rather_than_opens(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config, "google_auth_client_id", None)
    monkeypatch.setattr(config, "coordinator_access_emails", "")
    monkeypatch.setattr(config, "session_secret", None)

    response = client.get("/api/v1/syllabi")

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "GOOGLE_AUTH_CLIENT_ID" in response.json()["detail"]
    assert client.get("/api/v1/auth/config").json() == {"configured": False, "clientId": None}


def test_a_cors_preflight_still_works_so_the_browser_sees_the_real_answer(
    client: TestClient, configured: None
):
    response = client.options(
        "/api/v1/syllabi",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
