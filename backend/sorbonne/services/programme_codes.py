"""Programme codes the department treats as one — "MATS means MATH".

Admissions may recode a programme at any time. Everything here that decides who is
taught with whom compares programme codes, so a recode quietly splits one programme into
two: the rows written in the old code stop matching the students who now carry the new
one. This is the department's one place to say two codes are the same students, kept by
an administrator in Settings and read by every comparison.

A code maps straight to the code it means, never through another: MATS → MATH, and not
MATS → MATX → MATH. So the code something means can always be read in one step, and
the list reads the way it is used.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

CODE = re.compile(r"^[A-Z0-9][A-Z0-9_]{0,19}$")


class InvalidProgrammeCode(ValueError):
    """A code, or a pair of codes, that cannot be kept — said in words."""


def as_code(raw: str) -> str:
    """"MATS - MAth" or "mats" → "MATS": the part a student's programme is matched on."""
    return re.split(r"\s+-\s+", str(raw or "").strip(), maxsplit=1)[0].strip().upper()


def same_as_map(connection: Connection) -> dict[str, str]:
    """`code -> the code it means`, casefolded the way programme codes are compared."""
    rows = connection.execute(text("SELECT code, same_as FROM programme_codes")).all()
    return {str(code).casefold(): str(same_as).casefold() for code, same_as in rows}


class ProgrammeCodes:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def list(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT code, same_as, created_at, created_by FROM programme_codes ORDER BY same_as, code")
            ).mappings()
            return [
                {
                    "code": row["code"],
                    "sameAs": row["same_as"],
                    "createdAt": row["created_at"],
                    "createdBy": row["created_by"],
                }
                for row in rows
            ]

    def set(self, code: str, same_as: str, *, actor: str = "") -> None:
        """Say `code` means `same_as`, replacing whatever it meant before."""
        new, meant = as_code(code), as_code(same_as)
        for value in (new, meant):
            if not CODE.match(value):
                raise InvalidProgrammeCode(f"{value or 'A blank'!r} is not a programme code.")
        if new == meant:
            raise InvalidProgrammeCode(f"{new} already means itself.")
        with self.engine.begin() as connection:
            held = dict(connection.execute(text("SELECT code, same_as FROM programme_codes")).all())
            if meant in held:
                raise InvalidProgrammeCode(
                    f"{meant} already means {held[meant]}: say {new} means {held[meant]} instead."
                )
            leaning = sorted(other for other, target in held.items() if target == new)
            if leaning:
                one = len(leaning) == 1
                raise InvalidProgrammeCode(
                    f"{', '.join(leaning)} already mean{'s' if one else ''} {new}: take "
                    f"{'that' if one else 'those'} off first, or point {'it' if one else 'them'} at {meant}."
                )
            connection.execute(
                text("""INSERT INTO programme_codes (code, same_as, created_at, created_by)
                        VALUES (:code, :same_as, :at, :by)
                        ON CONFLICT (code) DO UPDATE SET same_as = excluded.same_as,
                                                         created_at = excluded.created_at,
                                                         created_by = excluded.created_by"""),
                {"code": new, "same_as": meant, "at": datetime.now(UTC).isoformat(), "by": actor},
            )

    def remove(self, code: str) -> bool:
        with self.engine.begin() as connection:
            gone = connection.execute(
                text("DELETE FROM programme_codes WHERE code = :code"), {"code": as_code(code)}
            ).rowcount
        return bool(gone)
