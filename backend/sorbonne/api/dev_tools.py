"""Conveniences that exist only on a developer's own machine.

This router is not mounted unless the database it would write to is on localhost, so in
production these routes do not exist at all — a 404, not a 403. That is deliberate and it
is the whole safety argument: a guard inside a mounted route is one bad condition away
from being a route that replays production into production, and there is no version of
this router that should ever answer from FastAPI Cloud.

`sorbonne/main.py` decides, once, at import.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/dev", tags=["dev"])


def is_local(database_url: str) -> bool:
    """True when the database this deployment writes to is on this machine.

    By hostname rather than by prefix, because "localhost.example.com" starts with the
    right letters. SQLAlchemy URLs carry a driver in the scheme — postgresql+psycopg —
    which urlparse handles, but the empty-host case (a SQLite path, say) is not local
    enough to be worth arguing about, so it answers False.
    """
    host = urlparse(database_url.replace("+psycopg", "")).hostname or ""
    return host in {"localhost", "127.0.0.1", "::1"}


class CopyInput(BaseModel):
    """Which production to read, and how much to bring."""

    source: str = Field(default="", max_length=200)
    replace: bool = Field(default=True)
    teachers: bool = Field(default=False)


@router.post("/copy-from-production")
def copy_from_production(body: CopyInput) -> dict[str, Any]:
    """Bring production's cohorts, sets, groups, placements, rules and register down here.

    The same work `scripts/copy_prod_to_dev.py` does, so there is one implementation and
    one set of rules about what travels — no student names, and no staff names unless
    asked for. Slow by nature: it is a few hundred writes through this same API.

    Deliberately `def` and not `async def`. The copy writes through THIS server, with
    blocking requests; on the event loop it would hold the loop while waiting for answers
    only the loop can give, and deadlock on its own first write. A sync handler is run in
    a worker thread, which leaves the loop free to answer them.
    """
    from scripts import copy_prod_to_dev as copier  # noqa: PLC0415 - dev-only, and it shells nothing

    try:
        report = copier.copy_everything(
            source=body.source or copier.PROD,
            into=copier.LOCAL,
            replace=body.replace,
            teachers=body.teachers,
        )
    except copier.Refused as refusal:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(refusal)) from refusal
    return report
