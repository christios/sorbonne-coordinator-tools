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
