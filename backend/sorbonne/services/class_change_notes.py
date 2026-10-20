"""What a coordinator says about the classes the registrar changed: links and notes.

The sweep never calls a removal and an arrival a move — the registrar's meetings carry no
identity between sweeps, so a "move" would be a guess. A coordinator who knows the course
can make that call: this Tuesday class was rescheduled into that Thursday one. Either side
can also carry a note of its own ("room clash, the registrar moved it").

Both are kept by the classes' slots — section, day, start and end — so they outlive the
sweep that showed them. A link is only made between a class the section has actually lost
and one it has actually gained, as the change stands now; if the registrar later puts the
gone class back or takes the new one away, the link is kept and said to no longer match,
the way a note about a cancelled hour the portal has moved is.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.facility_timetable import FacilityTimetableStore

SIDES = ("removed", "added")
NOTE_LONGEST = 400


class AnnotationRefused(ValueError):
    """Not something that can be linked or noted — said in words."""


def _slot(value: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(value.get("meetsOn") or "").strip()[:10],
        str(value.get("startsAt") or "").strip()[:5],
        str(value.get("endsAt") or "").strip()[:5],
    )


def _said(slot: tuple[str, str, str]) -> dict[str, str]:
    return {"meetsOn": slot[0], "startsAt": slot[1], "endsAt": slot[2]}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ClassChangeNotes:
    def __init__(self, engine: Engine, facilities: FacilityTimetableStore) -> None:
        self.engine = engine
        self.facilities = facilities

    # ------------------------------------------------------------------ reading

    def for_term(self, term_code: str) -> dict[str, list[dict[str, Any]]]:
        """Every link and note for a term, each saying whether it still matches the change."""
        changed = {section["crn"]: section for section in self.facilities.classes_changed(term_code)}

        def standing(crn: str, side: str, slot: tuple[str, str, str]) -> bool:
            section = changed.get(crn)
            return bool(section) and slot in {_slot(cls) for cls in section[side]}

        with self.engine.connect() as connection:
            links = connection.execute(
                text("""SELECT * FROM class_change_links WHERE term_code = :t ORDER BY from_on, from_start"""),
                {"t": term_code},
            ).mappings().all()
            notes = connection.execute(
                text("""SELECT * FROM class_change_notes WHERE term_code = :t ORDER BY meets_on, starts_at"""),
                {"t": term_code},
            ).mappings().all()
        return {
            "links": [
                {
                    **self._link(row),
                    "matches": standing(row["crn"], "removed", (row["from_on"], row["from_start"], row["from_end"]))
                    and standing(row["crn"], "added", (row["to_on"], row["to_start"], row["to_end"])),
                }
                for row in links
            ],
            "notes": [
                {
                    **self._note(row),
                    "matches": standing(row["crn"], row["side"], (row["meets_on"], row["starts_at"], row["ends_at"])),
                }
                for row in notes
            ],
        }

    def rescheduled_into(self, term_code: str) -> dict[tuple[str, str, str, str], dict[str, str]]:
        with self.engine.connect() as connection:
            return rescheduled_into(connection, [term_code]).get(term_code, {})

    # ------------------------------------------------------------------ writing

    def link(  # noqa: PLR0913 - the term, the section, the two classes, the note and who
        self,
        term_code: str,
        crn: str,
        gone: dict[str, Any],
        arrived: dict[str, Any],
        *,
        note: str = "",
        author_email: str = "",
        author_name: str = "",
    ) -> dict[str, Any]:
        """Say the class that went was rescheduled into the class that arrived.

        Either class already linked to another is unlinked from it first: a class is
        rescheduled into one class, not two.
        """
        was, now = _slot(gone), _slot(arrived)
        section = next((one for one in self.facilities.classes_changed(term_code) if one["crn"] == crn), None)
        if section is None:
            raise AnnotationRefused("The registrar has not changed this section's classes.")
        if was not in {_slot(cls) for cls in section["removed"]}:
            raise AnnotationRefused("That class is not one this section has lost.")
        if now not in {_slot(cls) for cls in section["added"]}:
            raise AnnotationRefused("That class is not one this section has gained.")
        if len(note) > NOTE_LONGEST:
            raise AnnotationRefused(f"Keep the note under {NOTE_LONGEST} characters.")
        stamp = _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""DELETE FROM class_change_links
                        WHERE term_code = :t AND crn = :crn
                          AND ((from_on = :fo AND from_start = :fs AND from_end = :fe)
                            OR (to_on = :to AND to_start = :ts AND to_end = :te))"""),
                {"t": term_code, "crn": crn, "fo": was[0], "fs": was[1], "fe": was[2],
                 "to": now[0], "ts": now[1], "te": now[2]},
            )
            row = connection.execute(
                text("""INSERT INTO class_change_links
                            (id, term_code, crn, from_on, from_start, from_end, to_on, to_start, to_end,
                             note, author_email, author_name, created_at, updated_at)
                        VALUES (:id, :t, :crn, :fo, :fs, :fe, :to, :ts, :te, :note, :email, :name, :at, :at)
                        RETURNING *"""),
                {"id": str(uuid.uuid4()), "t": term_code, "crn": crn,
                 "fo": was[0], "fs": was[1], "fe": was[2], "to": now[0], "ts": now[1], "te": now[2],
                 "note": note.strip(), "email": author_email, "name": author_name, "at": stamp},
            ).mappings().one()
        return {**self._link(row), "matches": True}

    def unlink(self, link_id: str) -> bool:
        with self.engine.begin() as connection:
            return bool(
                connection.execute(text("DELETE FROM class_change_links WHERE id = :id"), {"id": link_id}).rowcount
            )

    def note(  # noqa: PLR0913 - the term, the section, the side, the class, the words and who
        self,
        term_code: str,
        crn: str,
        side: str,
        cls: dict[str, Any],
        note: str,
        *,
        author_email: str = "",
        author_name: str = "",
    ) -> dict[str, Any] | None:
        """A note on one class that went or arrived; an empty note takes it away."""
        if side not in SIDES:
            raise AnnotationRefused("Say whether the class went (removed) or arrived (added).")
        words = (note or "").strip()
        if len(words) > NOTE_LONGEST:
            raise AnnotationRefused(f"Keep the note under {NOTE_LONGEST} characters.")
        slot = _slot(cls)
        with self.engine.begin() as connection:
            if not words:
                connection.execute(
                    text("""DELETE FROM class_change_notes
                            WHERE term_code = :t AND crn = :crn AND side = :side
                              AND meets_on = :on AND starts_at = :start AND ends_at = :end"""),
                    {"t": term_code, "crn": crn, "side": side, "on": slot[0], "start": slot[1], "end": slot[2]},
                )
                return None
            stamp = _now()
            row = connection.execute(
                text("""INSERT INTO class_change_notes
                            (id, term_code, crn, side, meets_on, starts_at, ends_at, note,
                             author_email, author_name, created_at, updated_at)
                        VALUES (:id, :t, :crn, :side, :on, :start, :end, :note, :email, :name, :at, :at)
                        ON CONFLICT ON CONSTRAINT class_change_notes_slot DO UPDATE
                        SET note = EXCLUDED.note, author_email = EXCLUDED.author_email,
                            author_name = EXCLUDED.author_name, updated_at = EXCLUDED.updated_at
                        RETURNING *"""),
                {"id": str(uuid.uuid4()), "t": term_code, "crn": crn, "side": side,
                 "on": slot[0], "start": slot[1], "end": slot[2], "note": words,
                 "email": author_email, "name": author_name, "at": stamp},
            ).mappings().one()
        return self._note(row)

    # ------------------------------------------------------------------ shapes

    @staticmethod
    def _link(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "termCode": row["term_code"],
            "crn": row["crn"],
            "from": _said((row["from_on"], row["from_start"], row["from_end"])),
            "to": _said((row["to_on"], row["to_start"], row["to_end"])),
            "note": row["note"],
            "byEmail": row["author_email"],
            "byName": row["author_name"],
            "at": row["updated_at"],
        }

    @staticmethod
    def _note(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "termCode": row["term_code"],
            "crn": row["crn"],
            "side": row["side"],
            "class": _said((row["meets_on"], row["starts_at"], row["ends_at"])),
            "note": row["note"],
            "byEmail": row["author_email"],
            "byName": row["author_name"],
            "at": row["updated_at"],
        }


#: term -> (crn, day, start, end) of a class that arrived -> the class it was rescheduled from
Moves = dict[str, dict[tuple[str, str, str, str], dict[str, str]]]


def rescheduled_into(connection: Any, term_codes: list[str]) -> Moves:
    """term -> `(crn, day, start, end)` of each class that arrived -> the class it was rescheduled from.

    For whatever draws the arrived class, so it can say where it came from.
    """
    held: Moves = {}
    for row in connection.execute(
        text("""SELECT term_code, crn, from_on, from_start, from_end, to_on, to_start, to_end
                FROM class_change_links WHERE term_code = ANY(:terms)"""),
        {"terms": list(term_codes)},
    ):
        held.setdefault(row[0], {})[(row[1], row[5], row[6], row[7])] = {
            "meetsOn": row[2],
            "startsAt": row[3],
            "endsAt": row[4],
        }
    return held

