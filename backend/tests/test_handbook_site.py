import asyncio
from pathlib import Path

import httpx
import pytest

from sorbonne.main import app

# The same relative path the mount uses, so this is absent exactly when the app cannot
# serve the handbook. It is a build artifact — `mkdocs build --site-dir backend/handbook-dist`
# makes it, the deploy workflow builds it, and Git ignores it — so a working tree that has
# never run that step is the normal case, not a broken one.
HANDBOOK_BUNDLE = Path("handbook-dist")


def test_mounts_the_coordinator_handbook_as_a_static_app() -> None:
    assert any(getattr(route, "path", None) == "/handbook" for route in app.routes)


@pytest.mark.skipif(not HANDBOOK_BUNDLE.is_dir(), reason="the handbook bundle is not built")
def test_serves_the_built_coordinator_handbook() -> None:
    async def request_handbook() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/handbook/")

    response = asyncio.run(request_handbook())

    assert response.status_code == 200
    assert "SCEN Coordinator Handbook" in response.text
