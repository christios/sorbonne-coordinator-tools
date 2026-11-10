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

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.wish_invitations import (
    INVITEE_COOKIE,
    INVITEE_PATH,
    InvitationStore,
    NotInvited,
    issue_invitee_session,
)

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
    """Which production to read, and whether to stop short of writing."""

    source: str = Field(default="", max_length=200)
    dryRun: bool = Field(default=False)  # noqa: N815 - the wire name


class InviteeInput(BaseModel):
    code: str = Field(min_length=1, max_length=128)


@router.post("/wish-invitee-session")
def wish_invitee_session(body: InviteeInput, response: Response) -> dict[str, str]:
    """Open an invitation's page as its teacher, without their Google account: for looking
    at the teacher's side on this machine. Mounted only with a local database, like the rest."""
    try:
        found = InvitationStore(engine_for(config.database_url)).for_code(body.code)
    except NotInvited as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such invitation.") from exc
    response.set_cookie(
        INVITEE_COOKIE,
        issue_invitee_session(found["id"], found["email"]),
        httponly=True,
        secure=True,
        samesite="lax",
        path=INVITEE_PATH,
    )
    return {"email": found["email"]}


@router.post("/copy-from-production")
def copy_from_production(body: CopyInput) -> dict[str, Any]:
    """Make this machine's database production's: every table, every row, ids and all.

    The same work `scripts/copy_prod_to_dev.py` does, so there is one implementation and
    one set of rules about what travels — see `sorbonne/services/table_copy.py`.

    Deliberately `def` and not `async def`: it spends its time waiting on production, and a
    sync handler runs in a worker thread, which leaves the loop free for everything else.
    """
    from scripts import copy_prod_to_dev as copier  # noqa: PLC0415 - dev-only, and it shells nothing

    try:
        return copier.copy_everything(source=body.source or copier.PROD, dry_run=body.dryRun)
    except copier.Refused as refusal:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(refusal)) from refusal
