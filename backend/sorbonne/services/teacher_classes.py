"""Every active teacher and their classes, for the SCEN Requests app.

SCEN Requests is a Power App over SharePoint where a professor reports a change to their
classes — a class they cannot teach, a cover, a swap, a move — by ticking the classes on
their own timetable. A flow copies this answer into SharePoint every hour, and when a
coordinator asks for it, so the professor never types a course code or a date.

One answer holds the whole department, rather than one person per call as the Timesheets
pre-fill does: the flow keeps one row per teacher, and forty-odd calls an hour to say the
same thing would be forty-odd chances to fail. The teachers without a class are in it
too, because the same list is who a professor can name as a colleague.

Whose class is whose is the pre-fill's rule, read by the pre-fill's own code: our planning
where it names somebody, the portal's staffing of our Active CRNs where it does not, and
the dates a coordinator recorded somebody covering. Read-only, behind a key of its own
(the gate checks it), and only as fresh as the last Portal sync, which the answer says.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text

from sorbonne.services.timesheet_prefill import (
    LOCAL,
    TimesheetPrefill,
    _is_them,
    _label,
    _numbered,
    _people,
    _words,
)

SCHEMA = "requests.classes.v1"
#: The one department Coordinator Tools plans for. SCEN Requests routes by department, so
#: every teacher carries it, and a second department would be a second value here.
DEPARTMENT = "SCEN"
#: How far back a professor may report a class they missed.
LOOK_BACK_DAYS = 14

#: Every Active teacher, by the name and address the Active teachers page shows: the
#: portal's where the row is linked to a profile there, what was stored otherwise, and
#: last the part-time record's, for a part-timer the portal has no address for.
_TEACHERS = """SELECT a.id, a.part_time_teacher_id,
                      coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), '') AS name,
                      coalesce(nullif(a.full_name, ''), '') AS own_name,
                      lower(coalesce(nullif(p.psuad_email, ''), nullif(a.email, ''), nullif(t.email, ''), '')) AS email
               FROM active_teachers a
               LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
               LEFT JOIN part_time_teachers t ON t.id = a.part_time_teacher_id
               ORDER BY 3"""


class TeacherClasses(TimesheetPrefill):
    """The pre-fill's rules for whose class is whose, asked of everybody at once."""

    def classes(self, *, today: date | None = None) -> dict[str, Any]:
        today = today or datetime.now(LOCAL).date()
        first = today - timedelta(days=LOOK_BACK_DAYS)
        with self.engine.connect() as connection:
            teachers = connection.execute(text(_TEACHERS)).mappings().all()
            meetings = self._held_from(connection, first)
            notes = self._notes(connection, first, date.max)
            names = self._section_names(connection)
            owners = {row["id"]: self._who_active(connection, row) for row in teachers}
            own = {teacher_id: self._own_sections(connection, who) for teacher_id, who in owners.items()}
            terms = sorted({term for term, _crn in meetings})
            synced_at, complete = self._last_sync(connection, terms)

        people: list[dict[str, Any]] = []
        for row in teachers:
            if not row["email"]:
                continue  # Nobody can sign in as them, so nobody can be matched to them.
            who = owners[row["id"]]
            people.append(
                {
                    "email": row["email"],
                    "name": row["name"],
                    "department": DEPARTMENT,
                    "classes": self._theirs(own[row["id"]], who, meetings, notes, names),
                }
            )
        return {
            "schema": SCHEMA,
            "department": DEPARTMENT,
            "from": first.isoformat(),
            "today": today.isoformat(),
            "scheduleSyncedAt": synced_at,
            "complete": complete,
            "teachers": people,
        }

    # ------------------------------------------------------------------ one teacher

    def _who_active(self, connection: Any, row: Any) -> dict[str, Any]:
        """Every name an Active teacher goes by, with their part-time record's when they have one."""
        names = {row["name"], row["own_name"]}
        ids = {str(row["id"])}
        if row["part_time_teacher_id"]:
            linked = self._who(connection, str(row["part_time_teacher_id"]))
            names |= linked["lower"]
            ids |= linked["ids"]
        return {
            "name": row["name"],
            "ids": ids,
            "words": {_words(name) for name in names if _words(name)},
            "lower": {name.strip().lower() for name in names if name.strip()},
        }

    def _theirs(  # noqa: PLR0913 - what one teacher's classes are read from
        self,
        own: dict[tuple[str, str], dict[str, str]],
        who: dict[str, Any],
        meetings: dict[tuple[str, str], list[tuple[date, str, str, str]]],
        notes: dict[tuple[str, str, str, str], dict[str, Any]],
        names: dict[tuple[str, str], dict[str, str]],
    ) -> list[dict[str, Any]]:
        classes: list[dict[str, Any]] = []
        # Their own sections: every meeting from the look-back on, with what a coordinator said of it.
        for (term, crn), section in own.items():
            for day, starts_at, ends_at, n, room in _numbered_with_rooms(meetings.get((term, crn), [])):
                note = notes.get((term, crn, day.isoformat(), starts_at))
                status = "scheduled"
                covered_by = ""
                if note and note["kind"] == "cancelled":
                    status = "cancelled"
                elif note and note["kind"] == "covered" and not _is_them(note, who):
                    status, covered_by = "covered", note.get("cover_teacher_name") or ""
                classes.append(_class(term, crn, day, starts_at, ends_at, n, room, section, status, covered_by))
        # Somebody else's class they stand in for, on the dates they do.
        for (term, crn, day_text, starts_at), note in notes.items():
            if (term, crn) in own or note["kind"] != "covered" or not _is_them(note, who):
                continue
            day = date.fromisoformat(day_text)
            for held_day, held_start, ends_at, n, room in _numbered_with_rooms(meetings.get((term, crn), [])):
                if held_day == day and held_start == starts_at:
                    section = names.get((term, crn), {"courseCode": "", "title": "", "teacher": ""})
                    owner = _people(section.get("teacher", ""))[0] if section.get("teacher") else ""
                    classes.append(_class(term, crn, day, starts_at, ends_at, n, room, section, "cover", owner))
        classes.sort(key=lambda row: (row["date"], row["start"], row["id"]))
        return classes

    # ------------------------------------------------------------------ the registrar's

    def _held_from(self, connection: Any, first: date) -> dict[tuple[str, str], list[tuple[date, str, str, str]]]:
        """Every dated meeting from `first` on, with its room as the department's rooms list names it."""
        names = _room_names(connection)
        held: dict[tuple[str, str], list[tuple[date, str, str, str]]] = {}
        rows = connection.execute(
            text("""SELECT term_code, crn, meets_on, starts_at, ends_at, coalesce(room, '') FROM facility_meetings
                    WHERE meets_on >= :first"""),
            {"first": first.isoformat()},
        )
        for term, crn, meets_on, starts_at, ends_at, room in rows:
            try:
                day = date.fromisoformat(meets_on)
            except ValueError:
                continue
            held.setdefault((term, crn), []).append((day, starts_at, ends_at, _named(room, names)))
        return held


def _room_names(connection: Any) -> dict[str, str]:
    """Each room's code on the Rooms page, under its code and every other name the portal uses for it."""
    names: dict[str, str] = {}
    for code, aliases in connection.execute(text("SELECT code, coalesce(aliases, '[]') FROM rooms")):
        for name in [code, *json.loads(aliases)]:
            names.setdefault(" ".join(str(name).split()).casefold(), code)
    return names


def _named(room: str, names: dict[str, str]) -> str:
    """The rooms list's code for a portal room.

    The portal keeps ten characters of a room's name, so "5.104(Physics Lab)" arrives as
    "5.104(Phys": that is the room whose code comes before the bracket. Anything else is
    kept as the portal says it.
    """
    words = " ".join(room.split())
    head = words.split("(", 1)[0].strip()
    return names.get(words.casefold()) or (names.get(head.casefold()) if head != words else None) or room


def _numbered_with_rooms(meetings: list[tuple[date, str, str, str]]) -> list[tuple[date, str, str, int, str]]:
    """The pre-fill's numbering — a meeting's place by start time on its date — with the room kept."""
    rooms = {(day, start, end): room for day, start, end, room in meetings}
    return [(day, start, end, n, rooms[day, start, end]) for day, start, end, n in _numbered([m[:3] for m in meetings])]


def _class(  # noqa: PLR0913 - one argument per field of a class
    term: str,
    crn: str,
    day: date,
    starts_at: str,
    ends_at: str,
    n: int,
    room: str,
    section: dict[str, str],
    status: str,
    other: str,
) -> dict[str, Any]:
    """One dated class as the app shows it. The id is the pre-fill's sessionId, so the two apps agree."""
    return {
        "id": f"{term}:{crn}:{day.isoformat()}:{n}",
        "date": day.isoformat(),
        "start": starts_at,
        "end": ends_at,
        "crn": crn,
        "course": section.get("courseCode", ""),
        "component": section.get("component", ""),
        "label": _label(section),
        "title": section.get("title", ""),
        "room": room,
        # scheduled | cancelled | covered (by `other`) | cover (they stand in for `other`)
        "status": status,
        "other": other,
    }
