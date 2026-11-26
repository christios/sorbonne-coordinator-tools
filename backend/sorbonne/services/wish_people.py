"""People on a semester's Timetable preferences list who are not active teachers in it.

A coordinator may ask somebody on neither Active teachers nor the part-time teachers list —
a new hire, a candidate, somebody not in the portal yet — for their timetable preferences
and constraints (user, 26 Nov 2026). They get the request without the hour reductions and
the course schedule, which are for teachers active in the semester.

Adding them takes a name and the Google or Microsoft address they sign in with. Somebody the
department already holds at that address is put on the list as they are, never as a second
record; anybody else is given a record of their own, made by hand: no portal profile, no
part-time record, in no semester, and kept off every other page's lists of teachers. The
invitation is made with them, so the shared link opens their form at once.

Their answer follows them. Added on Active teachers later at the same address, the record
is joined by itself; added as a record of its own, the coordinator links the two here, and
the answer, invitation and reopening move to the active teacher.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.teacher_wishes import BY_HAND, InvalidWishes, NoCollection, UnknownTeacher, _term
from sorbonne.services.wish_invitations import InvitationStore, active_in, on_the_list, sign_in_address

#: The longest name kept for somebody added by hand.
LONGEST_NAME = 120
#: Whose answer stays when both the person added and the active teacher answered for a semester.
KEEPS = ("person", "teacher")


class AlreadyOnList(ValueError):
    """Somebody already on the semester's list, at the address given: the name they are listed by."""


class BothAnswered(ValueError):
    """Both have an answer for these semesters, and nobody said whose to keep."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


_NAMED = """SELECT a.id, a.portal_teacher_id, a.part_time_teacher_id,
                   coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), a.email, a.id) AS name,
                   """ + BY_HAND + """ AS by_hand
            FROM active_teachers a LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id"""


class WishPeople:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    @staticmethod
    def _person(connection: Any, teacher_id: str) -> dict[str, Any]:
        row = connection.execute(text(_NAMED + " WHERE a.id = :id"), {"id": teacher_id}).mappings().first()
        if row is None:
            raise UnknownTeacher(teacher_id)
        return dict(row)

    def add(self, term_code: str, name: str, email: str, actor: str = "") -> tuple[str, dict[str, Any]]:
        """Put somebody on the semester's list, invited at their address. The link's code is
        returned once, with whom it was made for."""
        term = _term(term_code)
        shown = " ".join(str(name or "").split())
        if not shown:
            raise InvalidWishes("Give their name, as it should appear on the list.")
        if len(shown) > LONGEST_NAME:
            raise InvalidWishes(f"A name of {LONGEST_NAME} characters at most.")
        address = sign_in_address(email)
        with self.engine.begin() as connection:
            if connection.execute(
                text("SELECT 1 FROM wish_collections WHERE term_code = :term"), {"term": term}
            ).first() is None:
                raise NoCollection(term)
            # Somebody held already at that address, a real record before one made by hand.
            same = (
                connection.execute(
                    text(
                        _NAMED
                        + """ WHERE lower(a.email) = :email OR lower(coalesce(p.psuad_email, '')) = :email
                                 OR a.id IN (SELECT teacher_id FROM wish_invitations
                                             WHERE email = :email AND withdrawn_at = '')
                             ORDER BY (a.portal_teacher_id = '' AND a.part_time_teacher_id = ''), a.added_at
                             LIMIT 1"""
                    ),
                    {"email": address},
                )
                .mappings()
                .first()
            )
            if same is not None and on_the_list(connection, term, same["id"]):
                raise AlreadyOnList(same["name"])
            at = _now()
            if same is not None:
                teacher_id, listed, existing = same["id"], same["name"], True
            else:
                teacher_id, listed, existing = str(uuid.uuid4()), shown, False
                connection.execute(
                    text("""INSERT INTO active_teachers
                                (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                            VALUES (:id, '', '', :name, :email, :at, :by)"""),
                    {"id": teacher_id, "name": shown, "email": address, "at": at, "by": actor},
                )
            connection.execute(
                text("""INSERT INTO wish_people (term_code, teacher_id, added_at, added_by)
                        VALUES (:term, :id, :at, :by) ON CONFLICT DO NOTHING"""),
                {"term": term, "id": teacher_id, "at": at, "by": actor},
            )
            code, invitation = InvitationStore.invite_within(connection, term, teacher_id, address, actor)
        return code, {"teacherId": teacher_id, "name": listed, "existing": existing, "invitation": invitation}

    def link(self, term_code: str, person_id: str, teacher_id: str, keep: str = "") -> str:
        """Somebody added by hand is this active teacher: their answers, invitations and
        reopenings move to them, and the record made by hand goes. Returns the teacher's name.

        Where both answered for a semester, `keep` says whose answer stays ("person" or
        "teacher"); without it nothing moves.
        """
        term = _term(term_code)
        with self.engine.begin() as connection:
            person = self._person(connection, person_id)
            if not person["by_hand"]:
                raise InvalidWishes(
                    f"{person['name']} is on Active teachers or the part-time teachers list already: nothing to link."
                )
            target = self._person(connection, teacher_id)
            if target["id"] == person["id"] or not active_in(connection, term, target["id"]):
                raise InvalidWishes("Pick a teacher on this semester's Active teachers.")
            both = connection.execute(
                text("""SELECT w.term_code,
                               coalesce((SELECT nullif(t.name, '') FROM plan_terms t
                                         WHERE t.term_code = w.term_code LIMIT 1), w.term_code) AS name
                        FROM teacher_wishes w
                        JOIN teacher_wishes x ON x.term_code = w.term_code AND x.teacher_id = :to
                        WHERE w.teacher_id = :person ORDER BY w.term_code"""),
                {"to": target["id"], "person": person["id"]},
            ).mappings().all()
            if both and keep not in KEEPS:
                raise BothAnswered([row["name"] for row in both])
            values = {"to": target["id"], "person": person["id"], "terms": [row["term_code"] for row in both]}
            if both:
                dropped = target["id"] if keep == "person" else person["id"]
                connection.execute(
                    text("DELETE FROM teacher_wishes WHERE teacher_id = :id AND term_code = ANY(:terms)"),
                    {"id": dropped, "terms": values["terms"]},
                )
            connection.execute(text("UPDATE teacher_wishes SET teacher_id = :to WHERE teacher_id = :person"), values)
            connection.execute(text("UPDATE wish_invitations SET teacher_id = :to WHERE teacher_id = :person"), values)
            for table in ("wish_reopenings", "wish_people"):
                # One row a semester each: the teacher's own stays, and the person's goes with their record.
                connection.execute(
                    text(f"""UPDATE {table} r SET teacher_id = :to WHERE r.teacher_id = :person
                             AND NOT EXISTS (SELECT 1 FROM {table} o
                                             WHERE o.teacher_id = :to AND o.term_code = r.term_code)"""),  # noqa: S608 - fixed names
                    values,
                )
            connection.execute(text("DELETE FROM active_teachers WHERE id = :person"), values)
        return str(target["name"])

    def remove(self, term_code: str, teacher_id: str) -> None:
        """Take somebody added here off the semester's list: their invitation stops working and
        their answer for it goes. A record made by hand, with nothing left on it, goes too."""
        term = _term(term_code)
        with self.engine.begin() as connection:
            person = self._person(connection, teacher_id)
            if active_in(connection, term, teacher_id):
                raise InvalidWishes(f"{person['name']} is on this semester's Active teachers: take them off there.")
            values = {"term": term, "id": teacher_id, "at": _now()}
            listed = connection.execute(
                text("DELETE FROM wish_people WHERE term_code = :term AND teacher_id = :id"), values
            ).rowcount
            if not listed:
                raise InvalidWishes(f"{person['name']} wasn't added on this page, so can't be taken off it here.")
            connection.execute(text("DELETE FROM teacher_wishes WHERE term_code = :term AND teacher_id = :id"), values)
            connection.execute(text("DELETE FROM wish_reopenings WHERE term_code = :term AND teacher_id = :id"), values)
            connection.execute(
                text("""UPDATE wish_invitations SET withdrawn_at = :at
                        WHERE term_code = :term AND teacher_id = :id AND withdrawn_at = ''"""),
                values,
            )
            if person["by_hand"]:
                connection.execute(
                    text("""DELETE FROM active_teachers a WHERE a.id = :id
                            AND NOT EXISTS (SELECT 1 FROM wish_people g WHERE g.teacher_id = a.id)
                            AND NOT EXISTS (SELECT 1 FROM teacher_wishes w WHERE w.teacher_id = a.id)"""),
                    values,
                )
