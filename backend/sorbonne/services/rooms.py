"""The rooms and their seats, as the department keeps them.

Edited on the Rooms page by any coordinator, and read wherever a class is held against the
room it is booked in. A room is a code, what else the portal calls it, and a number of
seats — empty where nobody has said.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

LONGEST = 60
MOST_SEATS = 2000


class InvalidRoom(ValueError):
    """A room that cannot be kept, said in words."""


class RoomNotFound(LookupError):
    pass


def _words(value: object) -> str:
    return " ".join(str(value or "").split())


def _aliases(values: list[str] | None) -> list[str]:
    seen: dict[str, str] = {}
    for value in values or []:
        words = _words(value)
        if words:
            seen.setdefault(words.casefold(), words)
    return list(seen.values())


def _room(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"] or "",
        "building": row["building"] or "",
        "kind": row["kind"] or "",
        "seats": row["seats"],
        "aliases": json.loads(row["aliases"] or "[]"),
        "updatedAt": row["updated_at"] or "",
        "updatedBy": row["updated_by"] or "",
    }


class RoomStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def list(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT * FROM rooms ORDER BY lower(code)")).mappings()
            return [_room(row) for row in rows]

    def _checked(self, fields: dict[str, Any], *, keeping: str = "") -> dict[str, Any]:
        code = _words(fields.get("code"))
        if not code:
            raise InvalidRoom("A room needs its code: 5.111, 5.101/5.103.")
        for label, value in (
            ("code", code),
            ("name", fields.get("name")),
            ("building", fields.get("building")),
            ("type", fields.get("kind")),
        ):
            if len(_words(value)) > LONGEST:
                raise InvalidRoom(f"Keep a room's {label} under {LONGEST} characters.")
        seats = fields.get("seats")
        if seats is not None and not (0 <= int(seats) <= MOST_SEATS):
            raise InvalidRoom(f"A room seats between 0 and {MOST_SEATS}.")
        aliases = _aliases(fields.get("aliases"))
        if any(len(alias) > LONGEST for alias in aliases):
            raise InvalidRoom(f"Keep each other name under {LONGEST} characters.")
        with self.engine.connect() as connection:
            taken = connection.execute(
                text("SELECT id FROM rooms WHERE lower(code) = lower(:code) AND id <> :keeping"),
                {"code": code, "keeping": keeping},
            ).first()
        if taken:
            raise InvalidRoom(f"{code} is on the list already.")
        return {
            "code": code,
            "name": _words(fields.get("name")),
            "building": _words(fields.get("building")),
            "kind": _words(fields.get("kind")),
            "seats": None if seats is None else int(seats),
            "aliases": json.dumps(aliases),
        }

    def add(self, fields: dict[str, Any], *, actor: str = "") -> dict[str, Any]:
        room = self._checked(fields)
        room_id = str(uuid.uuid4())
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO rooms (id, code, name, building, kind, seats, aliases, updated_at, updated_by)
                        VALUES (:id, :code, :name, :building, :kind, :seats, :aliases, :at, :by)"""),
                {**room, "id": room_id, "at": datetime.now(UTC).isoformat(), "by": actor},
            )
        return self.get(room_id)

    def update(self, room_id: str, fields: dict[str, Any], *, actor: str = "") -> dict[str, Any]:
        room = self._checked(fields, keeping=room_id)
        with self.engine.begin() as connection:
            changed = connection.execute(
                text("""UPDATE rooms SET code = :code, name = :name, building = :building, kind = :kind,
                            seats = :seats, aliases = :aliases, updated_at = :at, updated_by = :by
                        WHERE id = :id"""),
                {**room, "id": room_id, "at": datetime.now(UTC).isoformat(), "by": actor},
            )
        if changed.rowcount == 0:
            raise RoomNotFound(room_id)
        return self.get(room_id)

    def get(self, room_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(text("SELECT * FROM rooms WHERE id = :id"), {"id": room_id}).mappings().first()
        if not row:
            raise RoomNotFound(room_id)
        return _room(row)

    def remove(self, room_id: str) -> bool:
        with self.engine.begin() as connection:
            gone = connection.execute(text("DELETE FROM rooms WHERE id = :id"), {"id": room_id})
        return gone.rowcount > 0
