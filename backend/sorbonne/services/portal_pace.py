"""How far apart a sync asks the registrar's timetable about two sections.

One number for the whole department, because the portal is one system: a coordinator who
slows the sync down after the registrar complains has slowed down everybody's, including
the sync a colleague runs first thing in the morning. Any coordinator may set it — the
people who press Sync are the ones who see the portal struggle — but never faster than a
second apart, which is where it has been since 29 September 2026.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

#: The gap when nobody has set one.
DEFAULT_SECONDS = 4
#: Never faster than this: the pace agreed after the registrar's system broke.
FASTEST = 1
#: Slower than this and a semester's sweep takes most of three hours.
SLOWEST = 60

STEP = "timetable"


class InvalidPace(ValueError):
    """Not a gap the sync can keep — said in words."""


class PortalPace:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def read(self) -> dict[str, Any]:
        """The gap, and who last set it — blank while it is still the default."""
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("SELECT seconds_apart, updated_at, updated_by FROM portal_pace WHERE step = :step"),
                    {"step": STEP},
                )
                .mappings()
                .first()
            )
        if row is None:
            return {"secondsApart": DEFAULT_SECONDS, "updatedAt": "", "updatedBy": ""}
        return {
            "secondsApart": int(row["seconds_apart"]),
            "updatedAt": row["updated_at"],
            "updatedBy": row["updated_by"],
        }

    def set(self, seconds: int, *, actor: str = "") -> dict[str, Any]:
        if not FASTEST <= seconds <= SLOWEST:
            raise InvalidPace(f"Keep it between {FASTEST} and {SLOWEST} seconds between sections.")
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO portal_pace (step, seconds_apart, updated_at, updated_by)
                        VALUES (:step, :seconds, :at, :by)
                        ON CONFLICT (step) DO UPDATE
                        SET seconds_apart = EXCLUDED.seconds_apart,
                            updated_at = EXCLUDED.updated_at,
                            updated_by = EXCLUDED.updated_by"""),
                {"step": STEP, "seconds": seconds, "at": datetime.now(UTC).isoformat(timespec="seconds"), "by": actor},
            )
        return self.read()
