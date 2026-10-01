"""No answer from the API may be kept by a browser.

A coordinator's Chrome answered the student lists from a copy it had stored that morning,
through a sync and a hard reload, while the server held the afternoon's.
"""

import pytest
from fastapi import FastAPI, Response, status
from fastapi.testclient import TestClient

from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.no_store import NoStore

pytestmark = pytest.mark.anonymous


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_auth_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "coordinator@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")


def test_an_api_answer_says_it_must_not_be_kept(configured: None):
    response = TestClient(app).get("/api/v1/auth/config")

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["cache-control"] == "no-store"


def test_so_does_a_refusal_to_sign_in(configured: None):
    # The gate answers before any route does, and a kept "sign in to continue" would greet
    # a coordinator who had signed in since.
    response = TestClient(app).get("/api/v1/student-database/views")

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.headers["cache-control"] == "no-store"


def test_the_page_itself_is_left_alone(configured: None):
    assert "cache-control" not in TestClient(app).get("/healthcheck").headers


def test_an_endpoint_that_says_how_it_may_be_kept_is_believed():
    inner = FastAPI()

    @inner.get("/api/v1/logo")
    def logo() -> Response:
        return Response(b"svg", headers={"Cache-Control": "public, max-age=3600"})

    response = TestClient(NoStore(inner)).get("/api/v1/logo")

    assert response.headers["cache-control"] == "public, max-age=3600"
