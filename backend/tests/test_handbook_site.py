import asyncio

import httpx

from sorbonne.main import app


def test_mounts_the_coordinator_handbook_as_a_static_app() -> None:
    assert any(getattr(route, "path", None) == "/handbook" for route in app.routes)


def test_serves_the_built_coordinator_handbook() -> None:
    async def request_handbook() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/handbook/")

    response = asyncio.run(request_handbook())

    assert response.status_code == 200
    assert "SCEN Coordinator Handbook" in response.text
