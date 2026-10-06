"""A part-timer's scheduled sessions for one pay period, for the timesheet app to pre-fill.

The Part-Time Timesheets app reads this once a day per part-timer, until they submit, and
writes the sessions into their draft so they correct and add rather than type everything.
The contract is `timesheet.prefill.v1`, agreed with the department on 6 October 2026 and
kept beside the app (17_part-time-timesheets/docs/Timesheet-prefill-contract.md).

A session is theirs three ways, the same three the teacher's week on their record uses:

- our planning names them on the section (by their Active Teachers row, or — on a section
  that names nobody — the course's requested teacher, or the name typed on the section);
- the portal staffs one of our Active CRNs with them, which catches what nobody has put on
  a card yet. A section the portal gives two names gives both of them every session — but
  only where our planning names nobody: where it says who teaches, it is believed;
- a coordinator recorded that they covered somebody else's class, on that date only.

The dated meetings are the registrar's, as the last Portal sync left them, and they are
only ever as fresh as that sync — which is why it is said in the answer.

Two choices the flow depends on:

*The id survives a change of hour, not of day.* `<term>:<crn>:<date>:<n>`, n the meeting's
place by start time on that date, because a section can meet twice in one day (sixty-two
times across twenty sections in S1 2026). Nothing in the registrar's answer identifies a
meeting, and our stored rows are rewritten on every sync, so the id is made of what the
meeting is. A class moved to another day arrives as one session gone and one new.

*What is gone is absent.* The whole period is returned every time, cancelled and covered
sessions included, so a session missing from an answer is one the registrar no longer has —
unless the last sync failed partway, when `complete` is false and the flow removes nothing.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Engine, text

from sorbonne.services.engine import engine_for
from sorbonne.services.time_sheet_intake import TeacherNotKnown, teacher_for

SCHEMA = "timesheet.prefill.v1"
#: Every semester is paid from the 15th to the 14th; see the pages' payPeriods.
PERIOD_STARTS_ON = 15
DECEMBER = 12
#: What a section's teacher field says when it says nobody: not a decision about who teaches.
PLACEHOLDERS = frozenset({"tbd", "tba", "tbc", "n/a", "na", "-", "?", "—", "staff"})
#: Whose clock decides what is past: the dates are Abu Dhabi wall-clock, never converted.
LOCAL = ZoneInfo("Asia/Dubai")


class PeriodNotKnown(Exception):
    """A period start that is not a pay period's first day."""


def period_of(start: str) -> tuple[date, date]:
    """The pay period beginning on `start`, which must be the 15th of a month."""
    try:
        first = date.fromisoformat(str(start or "").strip())
    except ValueError as exc:
        raise PeriodNotKnown(start) from exc
    if first.day != PERIOD_STARTS_ON:
        raise PeriodNotKnown(start)
    month, year = (1, first.year + 1) if first.month == DECEMBER else (first.month + 1, first.year)
    return first, date(year, month, PERIOD_STARTS_ON - 1)


def _words(name: str) -> str:
    """A name as its words, unordered and without accents: "Khaled, Sara" is Sara Khaled."""
    plain = unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode().lower()
    return " ".join(sorted(word for word in re.split(r"[^a-z0-9]+", plain) if word))


def _people(names: str) -> list[str]:
    """The people a portal teacher field names — "Diaa Mereib, Sara Khaled" is two."""
    return [part for part in re.split(r"\s*(?:,|;|/|&|\band\b)\s*", names or "") if part.strip()]


def names_them(field: str, theirs: set[str]) -> bool:
    """Whether a teacher field, which may hold several names, names this person."""
    return any(_words(person) in theirs for person in _people(field))


class TimesheetPrefill:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def sessions(self, *, period_start: str, email: str, today: date | None = None) -> dict[str, Any]:
        first, last = period_of(period_start)
        today = today or datetime.now(LOCAL).date()
        address = (email or "").strip()
        with self.engine.connect() as connection:
            teacher_id = teacher_for(connection, email=address, number="")
            if not teacher_id:
                raise TeacherNotKnown(address, "")
            who = self._who(connection, teacher_id)
            own = self._own_sections(connection, who)
            meetings = self._meetings(
                connection, {term for term, _ in own} | self._cover_terms(connection, first, last)
            )
            notes = self._notes(connection, first, last)
            names = self._section_names(connection)
            # The terms this period's sessions come from, whose sweeps decide `complete`.
            terms = sorted(
                {term for (term, _crn), held in meetings.items() if any(first <= day <= last for day, _s, _e in held)}
            )
            synced_at, complete = self._last_sync(connection, terms)

        sessions: list[dict[str, Any]] = []
        # Their own sections: every meeting in the period, with what a coordinator said of it.
        for (term, crn), section in sorted(own.items()):
            for day, starts_at, ends_at, n in _numbered(meetings.get((term, crn), [])):
                if not first <= day <= last:
                    continue
                note = notes.get((term, crn, day.isoformat(), starts_at))
                if note and note["kind"] == "cancelled":
                    status = "cancelled"
                elif note and note["kind"] == "covered" and not _is_them(note, who):
                    status = "covered"
                else:
                    status = "met" if day < today else "scheduled"
                sessions.append(_session(term, crn, day, starts_at, ends_at, n, section, status))
        # Somebody else's class they stood in for, on the dates they did.
        for (term, crn, day_text, starts_at), note in sorted(notes.items()):
            if (term, crn) in own or note["kind"] != "covered" or not _is_them(note, who):
                continue
            day = date.fromisoformat(day_text)
            held = meetings.get((term, crn), [])
            numbered = {(d, s): (e, n) for d, s, e, n in _numbered(held)}
            ends_at, n = numbered.get((day, starts_at), (note["ends_at"], 0))
            if not ends_at:
                continue  # Neither the registrar nor the note says when it ended.
            if not n:
                n = 1 + sum(1 for d, s, _, _ in _numbered(held) if d == day and s < starts_at)
            section = names.get(
                (term, crn), {"courseCode": "", "component": "", "group": "", "title": "", "teacher": ""}
            )
            owner = _people(section["teacher"])[0] if section["teacher"] else ""
            said = f"(cover for {owner})" if owner else "(cover)"
            cover = {**section, "label": " ".join(part for part in (_label(section), said) if part)}
            sessions.append(_session(term, crn, day, starts_at, ends_at, n, cover, "cover"))

        sessions.sort(key=lambda row: (row["date"], row["from"], row["sessionId"]))
        return {
            "schema": SCHEMA,
            "periodStart": first.isoformat(),
            "periodEnd": last.isoformat(),
            "email": address,
            "teacherName": who["name"],
            "scheduleSyncedAt": synced_at,
            "complete": complete,
            "sessions": sessions,
        }

    # ------------------------------------------------------------------ who they are

    def _who(self, connection: Any, teacher_id: str) -> dict[str, Any]:
        """Their part-time record, their Active Teachers rows, and every name they go by."""
        record = (
            connection.execute(
                text("SELECT full_name FROM part_time_teachers WHERE id = :id"), {"id": teacher_id}
            ).scalar()
            or ""
        )
        active = connection.execute(
            text("SELECT id, full_name FROM active_teachers WHERE part_time_teacher_id = :id"), {"id": teacher_id}
        ).all()
        names = {record, *(row[1] for row in active)}
        return {
            "name": record or next((row[1] for row in active), ""),
            "ids": {str(row[0]) for row in active},
            "words": {_words(name) for name in names if _words(name)},
            "lower": {name.strip().lower() for name in names if name.strip()},
        }

    # ---------------------------------------------------------------- whose sections

    def _own_sections(self, connection: Any, who: dict[str, Any]) -> dict[tuple[str, str], dict[str, str]]:
        """(term, CRN) → what the session is called, for every section that is theirs."""
        own: dict[tuple[str, str], dict[str, str]] = {}
        planned = connection.execute(
            text("""SELECT t.portal_term_code AS term, gc.crn, gc.teacher, gc.teacher_id,
                           c.teacher_id AS course_teacher_id, c.code AS course_code, c.component,
                           s.code AS scope_code, g.label
                    FROM group_crns gc
                    JOIN scope_groups g ON g.id = gc.group_id
                    JOIN cohort_scopes s ON s.id = g.scope_id
                    JOIN scope_courses c ON c.id = gc.course_id
                    JOIN term_links t ON t.term_id = s.term_id AND t.portal_term_code <> ''
                    WHERE gc.crn <> '' AND NOT gc.retired AND NOT gc.not_taught
                    ORDER BY s.code, g.position, g.label""")
        ).mappings()
        # Sections our planning says who teaches. The portal's word stands only where ours is
        # silent: it named "Sachin Valera, Ahmed Menaa" on two Maths Readiness groups the
        # planning gives to Sachin alone, and both would have been sent every session.
        decided: set[tuple[str, str]] = set()
        for row in planned:
            # The course names a teacher only for a section that names nobody at all; a name
            # typed on the section, even unconfirmed, is not silence. As the cards read it.
            typed = (row["teacher"] or "").strip()
            named = row["teacher_id"] or ("" if typed else row["course_teacher_id"])
            if named or (typed and typed.lower() not in PLACEHOLDERS):
                decided.add((row["term"], row["crn"]))
            mine = named in who["ids"] if named else typed.lower() in who["lower"]
            if not mine:
                continue
            key = (row["term"], row["crn"])
            group = f"{row['scope_code']} {row['label']}"
            if key in own:
                if group not in own[key]["group"].split(" / "):
                    own[key]["group"] += f" / {group}"
                continue
            own[key] = {
                "courseCode": row["course_code"],
                "component": row["component"] or "",
                "group": group,
                "scope": row["scope_code"],
                "title": "",
            }
        # The portal's own staffing of our Active CRNs, for what nobody has put on a card — or
        # on a card that names nobody yet.
        registered = connection.execute(
            text("""SELECT a.term_code, a.crn, a.course_code,
                           COALESCE(p.teacher_name, '') AS listed, COALESCE(p.title, '') AS title,
                           COALESCE(f.teacher_name, '') AS swept
                    FROM active_course_crns a
                    LEFT JOIN portal_courses p ON p.term_code = a.term_code AND p.crn = a.crn AND p.status = 'in_portal'
                    LEFT JOIN facility_sections f ON f.term_code = a.term_code AND f.crn = a.crn
                    WHERE a.crn <> ''""")
        ).mappings()
        for row in registered:
            key = (row["term_code"], row["crn"])
            if key in own or key in decided:
                continue
            if names_them(row["listed"], who["words"]) or names_them(row["swept"], who["words"]):
                own[key] = {
                    "courseCode": row["course_code"],
                    "component": "",
                    "group": "",
                    "scope": "",
                    "title": row["title"],
                }
        return own

    def _cover_terms(self, connection: Any, first: date, last: date) -> set[str]:
        return {
            row[0]
            for row in connection.execute(
                text("SELECT DISTINCT term_code FROM session_changes WHERE meets_on BETWEEN :a AND :b"),
                {"a": first.isoformat(), "b": last.isoformat()},
            )
        }

    # ------------------------------------------------------------ what the registrar has

    def _meetings(self, connection: Any, terms: set[str]) -> dict[tuple[str, str], list[tuple[date, str, str]]]:
        held: dict[tuple[str, str], list[tuple[date, str, str]]] = {}
        if not terms:
            return held
        rows = connection.execute(
            text("""SELECT term_code, crn, meets_on, starts_at, ends_at FROM facility_meetings
                    WHERE term_code = ANY(:terms)"""),
            {"terms": sorted(terms)},
        )
        for term, crn, meets_on, starts_at, ends_at in rows:
            try:
                day = date.fromisoformat(meets_on)
            except ValueError:
                continue
            held.setdefault((term, crn), []).append((day, starts_at, ends_at))
        return held

    def _notes(self, connection: Any, first: date, last: date) -> dict[tuple[str, str, str, str], dict[str, Any]]:
        """What coordinators recorded about single dated meetings: cancelled, or covered."""
        rows = connection.execute(
            text("""SELECT term_code, crn, meets_on, starts_at, ends_at, kind, cover_teacher_id, cover_teacher_name
                    FROM session_changes WHERE meets_on BETWEEN :a AND :b"""),
            {"a": first.isoformat(), "b": last.isoformat()},
        ).mappings()
        return {(row["term_code"], row["crn"], row["meets_on"], row["starts_at"]): dict(row) for row in rows}

    def _section_names(self, connection: Any) -> dict[tuple[str, str], dict[str, str]]:
        """What somebody else's section is called, and who it belongs to, for a cover's label."""
        names: dict[tuple[str, str], dict[str, str]] = {}
        for row in connection.execute(
            text("""SELECT f.term_code, f.crn, f.course_code, f.title, f.teacher_name FROM facility_sections f""")
        ).mappings():
            names[row["term_code"], row["crn"]] = {
                "courseCode": row["course_code"],
                "component": "",
                "group": "",
                "scope": "",
                "title": row["title"],
                "teacher": row["teacher_name"],
            }
        planned = connection.execute(
            text("""SELECT t.portal_term_code AS term, gc.crn, c.code AS course_code, c.component,
                           s.code AS scope_code, g.label, COALESCE(a.full_name, gc.teacher) AS teacher
                    FROM group_crns gc
                    JOIN scope_groups g ON g.id = gc.group_id
                    JOIN cohort_scopes s ON s.id = g.scope_id
                    JOIN scope_courses c ON c.id = gc.course_id
                    JOIN term_links t ON t.term_id = s.term_id AND t.portal_term_code <> ''
                    LEFT JOIN active_teachers a ON a.id = gc.teacher_id
                    WHERE gc.crn <> '' AND NOT gc.retired AND NOT gc.not_taught""")
        ).mappings()
        for row in planned:
            held = names.get((row["term"], row["crn"]), {"title": "", "teacher": ""})
            names[row["term"], row["crn"]] = {
                "courseCode": row["course_code"],
                "component": row["component"] or "",
                "group": f"{row['scope_code']} {row['label']}",
                "scope": row["scope_code"],
                "title": held.get("title", ""),
                # The planning's name for whose class it is, over the portal's string.
                "teacher": (row["teacher"] or "").strip() or held.get("teacher", ""),
            }
        return names

    def _last_sync(self, connection: Any, terms: list[str]) -> tuple[str | None, bool]:
        """When the timetable was last swept for these terms, and whether every sweep finished."""
        if not terms:
            row = connection.execute(
                text("SELECT pulled_at, complete FROM facility_pulls ORDER BY pulled_at DESC LIMIT 1")
            ).first()
            return (row[0], bool(row[1])) if row else (None, False)
        latest = connection.execute(
            text("""SELECT DISTINCT ON (term_code) term_code, pulled_at, complete FROM facility_pulls
                    WHERE term_code = ANY(:terms) ORDER BY term_code, pulled_at DESC"""),
            {"terms": terms},
        ).all()
        if len(latest) < len(terms):
            return (min((row[1] for row in latest), default=None), False)
        return min(row[1] for row in latest), all(bool(row[2]) for row in latest)


def _numbered(meetings: list[tuple[date, str, str]]) -> list[tuple[date, str, str, int]]:
    """Each meeting with its place by start time on its own date: 1, 2..."""
    out: list[tuple[date, str, str, int]] = []
    count: dict[date, int] = {}
    for day, starts_at, ends_at in sorted(set(meetings)):
        count[day] = count.get(day, 0) + 1
        out.append((day, starts_at, ends_at, count[day]))
    return out


def _is_them(note: dict[str, Any], who: dict[str, Any]) -> bool:
    if note.get("cover_teacher_id"):
        return note["cover_teacher_id"] in who["ids"]
    return names_them(note.get("cover_teacher_name") or "", who["words"])


def _label(section: dict[str, str]) -> str:
    """ "SCEN-102 TD RDNS 10": the course, its kind where the set does not already say it,
    and the group. A section only the portal knows is the course and the registrar's title."""
    if section.get("group"):
        parts = [section["courseCode"]]
        if section.get("component") and section["component"] != section.get("scope"):
            parts.append(section["component"])
        parts.append(section["group"])
        return " ".join(part for part in parts if part)
    return " ".join(part for part in (section.get("courseCode", ""), section.get("title", "")) if part)[:60]


def _session(  # noqa: PLR0913 - one argument per field of a session
    term: str, crn: str, day: date, starts_at: str, ends_at: str, n: int, section: dict[str, str], status: str
) -> dict[str, Any]:
    return {
        "sessionId": f"{term}:{crn}:{day.isoformat()}:{n}",
        "date": day.isoformat(),
        "from": starts_at,
        "to": ends_at,
        "kind": "teaching",
        "label": section.get("label") or _label(section),
        "ref": {
            "crn": crn,
            "courseCode": section.get("courseCode", ""),
            "component": section.get("component", ""),
            "group": section.get("group", ""),
        },
        "status": status,
    }
