"""What happened to one dated class that the registrar's timetable does not say.

A lecture cancelled, a tutorial taken by somebody else: facts about one meeting, written by
the coordinator on the calendar and read wherever hours are counted. One row per slot —
term, CRN, date and start — replaced when the story changes and removed when the class
turns out to have run as planned.

Kept apart from the sweep on purpose. A pull replaces a section's meetings wholesale; a
note keyed to the slot survives that, and a slot the registrar has since moved shows up
as a note with no class under it, which is a thing worth seeing rather than a thing lost.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

KINDS = ("cancelled", "covered")


class ChangeNotFound(Exception):
    pass


class NoCoverTeacher(Exception):
    """A covered class has to say who covered it."""


def _change(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "termCode": row["term_code"],
        "crn": row["crn"],
        "meetsOn": row["meets_on"],
        "startsAt": row["starts_at"],
        "endsAt": row["ends_at"],
        "kind": row["kind"],
        "coverTeacherId": row["cover_teacher_id"],
        "coverTeacherName": row["cover_teacher_name"],
        "note": row["note"],
        "authorEmail": row["author_email"],
        "authorName": row["author_name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class SessionChangeStore:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def changes_for(self, term_code: str) -> list[dict[str, Any]]:
        """Every note of the term, in calendar order. Tens of rows; a page filters them."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT * FROM session_changes WHERE term_code = :t
                            ORDER BY meets_on, starts_at, crn"""),
                    {"t": term_code},
                )
                .mappings()
                .all()
            )
        return [_change(row) for row in rows]

    def set_change(  # noqa: PLR0913 - one keyword per thing a note says
        self,
        *,
        term_code: str,
        crn: str,
        meets_on: str,
        starts_at: str,
        ends_at: str,
        kind: str,
        cover_teacher_id: str = "",
        cover_teacher_name: str = "",
        note: str = "",
        author_email: str = "",
        author_name: str = "",
    ) -> dict[str, Any]:
        """Say what happened to one slot, replacing whatever was said before.

        Signed by whoever says it last: the note is one fact, not a thread.
        """
        if kind not in KINDS:
            raise ValueError(kind)
        cover_name = " ".join(str(cover_teacher_name or "").split())
        if kind == "covered" and not cover_name:
            raise NoCoverTeacher()
        stamp = _now()
        row = {
            "id": str(uuid.uuid4()),
            "t": term_code,
            "crn": crn,
            "on": meets_on,
            "start": starts_at,
            "end": ends_at,
            "kind": kind,
            "cover_id": cover_teacher_id if kind == "covered" else "",
            "cover_name": cover_name if kind == "covered" else "",
            "note": str(note or "").strip(),
            "email": author_email,
            "name": author_name,
            "at": stamp,
        }
        with self.engine.begin() as connection:
            saved = (
                connection.execute(
                    text("""INSERT INTO session_changes
                                (id, term_code, crn, meets_on, starts_at, ends_at, kind, cover_teacher_id,
                                 cover_teacher_name, note, author_email, author_name, created_at, updated_at)
                            VALUES (:id, :t, :crn, :on, :start, :end, :kind, :cover_id,
                                    :cover_name, :note, :email, :name, :at, :at)
                            ON CONFLICT (term_code, crn, meets_on, starts_at) DO UPDATE SET
                                ends_at = excluded.ends_at, kind = excluded.kind,
                                cover_teacher_id = excluded.cover_teacher_id,
                                cover_teacher_name = excluded.cover_teacher_name, note = excluded.note,
                                author_email = excluded.author_email, author_name = excluded.author_name,
                                updated_at = excluded.updated_at
                            RETURNING *"""),
                    row,
                )
                .mappings()
                .one()
            )
        return _change(saved)

    def clear_change(self, change_id: str) -> None:
        """The class ran as planned after all."""
        with self.engine.begin() as connection:
            gone = connection.execute(text("DELETE FROM session_changes WHERE id = :id"), {"id": change_id}).rowcount
        if not gone:
            raise ChangeNotFound(change_id)
