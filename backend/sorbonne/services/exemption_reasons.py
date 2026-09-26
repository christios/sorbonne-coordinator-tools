"""The reasons a student may not take a course — "LEA track", "Repeater" — as a list.

Kept by an administrator in Settings and offered on the record's Exempt button, so the
same words are used every time and the Students and Cohorts tables can be filtered on
them. An exemption stores the words, not a reference: taking a reason off the list does
not rewrite the exemptions that were given for it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

LONGEST = 60


class InvalidReason(ValueError):
    """A reason that cannot be kept, said in words."""


class ExemptionReasons:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def list(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT label, created_at, created_by FROM exemption_reasons ORDER BY position, label")
            ).mappings()
            return [
                {"label": row["label"], "createdAt": row["created_at"], "createdBy": row["created_by"]} for row in rows
            ]

    def add(self, label: str, *, actor: str = "") -> None:
        words = " ".join(str(label or "").split())
        if not words:
            raise InvalidReason("A reason needs some words.")
        if len(words) > LONGEST:
            raise InvalidReason(f"Keep a reason under {LONGEST} characters.")
        with self.engine.begin() as connection:
            held = [row[0] for row in connection.execute(text("SELECT label FROM exemption_reasons"))]
            if any(existing.casefold() == words.casefold() for existing in held):
                raise InvalidReason(f"{words!r} is on the list already.")
            connection.execute(
                text("""INSERT INTO exemption_reasons (label, position, created_at, created_by)
                        VALUES (:label, :position, :at, :by)"""),
                {"label": words, "position": len(held), "at": datetime.now(UTC).isoformat(), "by": actor},
            )

    def remove(self, label: str) -> bool:
        with self.engine.begin() as connection:
            gone = connection.execute(text("DELETE FROM exemption_reasons WHERE label = :label"), {"label": label})
        return gone.rowcount > 0
