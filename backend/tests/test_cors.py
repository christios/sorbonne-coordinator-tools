from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.main import app


def test_accepts_the_local_vite_fallback_port() -> None:
    response = TestClient(app).options(
        "/api/v1/teachers",
        headers={
            "Origin": "http://127.0.0.1:3001",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3001"


def test_a_download_tells_the_browser_it_may_read_the_name_it_was_given() -> None:
    """The page and the API are different origins, so a header the browser is not told it
    may read does not exist as far as the page is concerned. Without this every export
    saved under a fallback name instead of the one the server chose."""
    response = TestClient(app).get(
        "/api/v1/teachers", headers={"Origin": "http://127.0.0.1:3001"}
    )

    exposed = response.headers.get("access-control-expose-headers", "")
    assert "Content-Disposition" in exposed
