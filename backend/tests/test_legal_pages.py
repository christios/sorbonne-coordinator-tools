"""The pages the Google consent screen links to, which must answer anonymously."""

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.main import app

pytestmark = pytest.mark.anonymous


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.parametrize("path", ["/privacy", "/terms"])
def test_a_signed_out_visitor_can_read_them(client: TestClient, path: str):
    response = client.get(path)

    assert response.status_code == status.HTTP_200_OK
    assert "text/html" in response.headers["content-type"]


def test_the_privacy_page_says_what_signing_in_collects(client: TestClient):
    page = client.get("/privacy").text

    assert "e-mail address" in page
    assert "display name" in page
    assert "christian.kha.work@gmail.com" in page
