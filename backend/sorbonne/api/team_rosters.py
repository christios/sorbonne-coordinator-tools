"""What the Teams roster sync reports, and what it last saw.

The sync runs elsewhere — a Power Automate flow reading a workbook and acting on Teams —
and posts its reading here afterwards with an API token. That is the whole integration:
this application still calls nothing outside itself, and holds one answer rather than a
connection.

Posting is the only write, and it is additive: a reading never changes a student, a
cohort, or a placement. The worst a wrong post can do is make a warning wrong, which the
next run corrects.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.team_rosters import TeamRosterStore

router = APIRouter(prefix="/team-roster", tags=["team roster"])

#: A channel's membership, not a mailing list: far past any cohort, far short of a mistake.
MAX_CHANNELS = 200
MAX_MEMBERS = 5000
MAX_PROBLEMS = 500


def get_rosters() -> TeamRosterStore:
    return TeamRosterStore(config.database_url)


class ChannelInput(BaseModel):
    """One channel and the addresses the workbook listed for it."""

    channel: str = Field(default="", max_length=120)
    members: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)


class SyncInput(BaseModel):
    """One run's reading: when, who set it going, and who each channel listed.

    Channels arrive as a list rather than an object because the caller builds them one
    iteration at a time. Composing an object key by key is awkward in a flow and easy to
    get subtly wrong; a list of pairs is what it already has.
    """

    syncedAt: str = Field(default="", max_length=64)
    syncedBy: str = Field(default="", max_length=320)
    mode: str = Field(default="", max_length=64)
    channels: list[ChannelInput] = Field(default_factory=list, max_length=MAX_CHANNELS)
    problems: list[str] = Field(default_factory=list, max_length=MAX_PROBLEMS)


@router.post("/syncs", status_code=status.HTTP_201_CREATED)
def record_sync(
    body: SyncInput, request: Request, rosters: TeamRosterStore = Depends(get_rosters)
) -> dict[str, Any]:
    """Keep what one run saw.

    Whoever the caller is, it is their run: the sync's own account when it holds a token,
    and the signed-in coordinator when this is exercised from a browser. `syncedBy` is
    what the flow says it was, which is the person who pressed the button rather than the
    identity the token carries — so both are worth having, and the caller's is the one
    that cannot be spoofed.
    """
    user = getattr(request.state, "staff_user", None)
    # A channel named twice keeps both readings, last one winning, rather than refusing
    # the whole run over a duplicate row in somebody's spreadsheet.
    channels = {entry.channel: entry.members for entry in body.channels if entry.channel.strip()}
    return {
        "sync": rosters.record(
            synced_at=body.syncedAt,
            synced_by=body.syncedBy or (getattr(user, "email", "") or ""),
            mode=body.mode,
            channels=channels,
            problems=body.problems,
        )
    }


@router.get("/latest")
def read_latest(rosters: TeamRosterStore = Depends(get_rosters)) -> dict[str, Any]:
    """The most recent reading, or `null` where the sync has never reported.

    The page decides what to do with an old one; it is told when it was taken rather
    than being refused it.
    """
    return {"sync": rosters.latest()}
