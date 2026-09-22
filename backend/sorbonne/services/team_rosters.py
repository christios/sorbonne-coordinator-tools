"""What the Teams roster sync last saw.

The sync reads a workbook that says which private channels each person belongs to, and
acts on Teams. It posts the same reading here afterwards, so a cohort that names its
channel can be asked the one question this application could not answer before: which of
my students are not in it.

Nothing here talks to Teams. What is held is one reading, with the time it was taken, and
a stale reading is answered as such rather than refreshed — the sync is the only thing
that knows, and it knows only when it runs.

Addresses are compared lowercased, since a directory's capitalisation is its own business
and two spellings of one person are not two people.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from sorbonne.services.engine import engine_for

#: A student's address is their id at the university's domain; nothing else carries it.
DOMAIN = "@sorbonne.ae"
#: Enough runs to see a pattern without keeping a year of them.
KEEP = 50


def _now() -> str:
    return datetime.now(UTC).isoformat()


def address_of(student_id: str) -> str:
    """The address a student id stands for, as the roster workbook spells it."""
    return f"{str(student_id or '').strip().lower()}{DOMAIN}"


def _clean_channels(channels: dict[str, Any] | None) -> dict[str, list[str]]:
    """One list of addresses per channel, lowercased, deduplicated, order kept."""
    out: dict[str, list[str]] = {}
    for name, members in (channels or {}).items():
        channel = " ".join(str(name or "").split())
        if not channel:
            continue
        seen: set[str] = set()
        addresses: list[str] = []
        for member in members or []:
            address = str(member or "").strip().lower()
            if address and address not in seen:
                seen.add(address)
                addresses.append(address)
        out[channel] = addresses
    return out


def _row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "syncedAt": row["synced_at"],
        "syncedBy": row["synced_by"],
        "mode": row["mode"],
        "channels": json.loads(row["channels"] or "{}"),
        "problems": json.loads(row["problems"] or "[]"),
        "receivedAt": row["received_at"],
    }


class TeamRosterStore:
    def __init__(self, database_url: str) -> None:
        self.engine = engine_for(database_url)

    def record(
        self,
        *,
        synced_at: str = "",
        synced_by: str = "",
        mode: str = "",
        channels: dict[str, Any] | None = None,
        problems: list[str] | None = None,
    ) -> dict[str, Any]:
        """Keep one run's reading, and forget the oldest once there are plenty."""
        now = _now()
        record_id = str(uuid4())
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO team_roster_syncs
                            (id, synced_at, synced_by, mode, channels, problems, received_at)
                        VALUES (:id, :synced_at, :synced_by, :mode, :channels, :problems, :now)"""),
                {
                    "id": record_id,
                    "synced_at": str(synced_at or now),
                    "synced_by": str(synced_by or "").strip().lower(),
                    "mode": " ".join(str(mode or "").split()),
                    "channels": json.dumps(_clean_channels(channels)),
                    "problems": json.dumps([str(p) for p in (problems or [])]),
                    "now": now,
                },
            )
            connection.execute(
                text("""DELETE FROM team_roster_syncs WHERE id NOT IN (
                            SELECT id FROM team_roster_syncs ORDER BY received_at DESC LIMIT :keep)"""),
                {"keep": KEEP},
            )
        return self.latest() or {}

    def latest(self) -> dict[str, Any] | None:
        """The most recent reading, or nothing if the sync has never reported."""
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("SELECT * FROM team_roster_syncs ORDER BY received_at DESC LIMIT 1")
                )
                .mappings()
                .first()
            )
        return _row(row) if row else None


def missing_from_channel(
    *, channel: str, student_ids: list[str], reading: dict[str, Any] | None
) -> dict[str, Any]:
    """Which of these students the last reading did not list for that channel.

    Answers *why not* as well as *who*, because "nobody is missing" and "we have never
    been told" look identical in a count and mean opposite things.
    """
    named = " ".join(str(channel or "").split())
    if not named:
        return {"known": False, "reason": "no_channel", "channel": "", "missing": []}
    if not reading:
        return {"known": False, "reason": "never_synced", "channel": named, "missing": []}

    channels = reading.get("channels") or {}
    # Spacing and case are the coordinator's, not a fact about the channel.
    wanted = named.replace(" ", "").lower()
    listed: list[str] | None = None
    for name, members in channels.items():
        if str(name).replace(" ", "").lower() == wanted:
            listed = members
            break
    if listed is None:
        return {"known": False, "reason": "channel_not_in_sync", "channel": named, "missing": []}

    have = {str(address).strip().lower() for address in listed}
    missing = [
        {"studentId": student_id, "address": address_of(student_id)}
        for student_id in student_ids
        if address_of(student_id) not in have
    ]
    return {
        "known": True,
        "reason": "",
        "channel": named,
        "listed": len(have),
        "missing": missing,
        "syncedAt": reading.get("syncedAt", ""),
    }
