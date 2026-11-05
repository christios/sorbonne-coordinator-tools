"""A semester planned by the department before the registrar books it.

A plan is a list of classes to place (one per CRN, with the hours asked for) and, for each,
the series it has been placed as: a weekday, an hour, a room, and the teaching weeks it
meets in. A series is how a coordinator thinks — "Tuesdays 8:30 to 10:00, weeks 1 to 12" —
and a week of it changed on its own is a move, kept against that week. The dated classes
are worked out from the two and the semester's calendar, never stored: move Week 1, add a
break, and every class follows, the way the rest of the timetable already counts weeks.

Changing a class of a series asks what the change is for, as a calendar does:

    one        this week only — kept as a move; moving it back where the series is undoes it
    following  this week and every one after — the series is cut in two at this week
    all        the whole series — weeks moved on their own are put back in line with it

Every change bumps the series' revision, and every change names the revision it was made
against: two coordinators moving the same class find out, rather than one quietly undoing
the other.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from sorbonne.services.coordinator_directory import name_for

LONGEST = 160
MOST_WEEKS = 30
MOST_HOURS = 500
MONDAY, SUNDAY = 1, 7
SCOPES = ("one", "following", "all")
# What a single class can differ from its series by. The weeks and the note are the series'.
OWN = ("weekday", "startsAt", "endsAt", "room", "teacherName")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_SHORT_TIME = re.compile(r"^\d:[0-5]\d$")
_TERM = re.compile(r"^\d{6}$")


def semester_of(term_code: str) -> str:
    """The id a plan goes by as a semester of the app: "plan:262720".

    The Student Hub is out of use (5 November 2026), and a Hub semester could only be made
    from the registrar's export anyway — which is what does not exist while a semester is
    being planned. So a plan is a semester in its own right: its cohorts' sets, the planning
    cards, the Semester Timetable all find it under this id, as they find a Hub semester
    under its own. Prefixed so it can never be mistaken for one of those.
    """
    return f"plan:{term_code}"


def _as_semester(connection: Connection, term: dict[str, Any], actor: str) -> None:
    """The plan's link to its portal term and its teaching weeks, where the rest of the app reads a semester's.

    Written beside the plan, not instead of it: `term_links` is what lets a cohort's sets be
    added to the semester and checked against the registrar, and `term_weeks` is what every
    calendar counts "Week 5" from. The plan's own settings stay the one place they are set.
    """
    semester = semester_of(term["termCode"])
    connection.execute(
        text("""INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, :c)
                ON CONFLICT (term_id) DO UPDATE SET portal_term_code = excluded.portal_term_code"""),
        {"t": semester, "c": term["termCode"]},
    )
    if not term["weekOne"]:
        connection.execute(text("DELETE FROM term_weeks WHERE term_id = :t"), {"t": semester})
        return
    connection.execute(
        text("""INSERT INTO term_weeks (term_id, week_one, without, updated_at, updated_by)
                VALUES (:t, :week_one, :without, :at, :by)
                ON CONFLICT (term_id) DO UPDATE SET week_one = excluded.week_one, without = excluded.without,
                    updated_at = excluded.updated_at, updated_by = excluded.updated_by"""),
        {"t": semester, "week_one": term["weekOne"], "without": json.dumps(term["without"]), "at": _now(), "by": actor},
    )


class InvalidPlan(ValueError):
    """Something a plan cannot hold, said in words."""


class PlanNotFound(LookupError):
    pass


class PlanConflict(Exception):
    """Somebody changed the class since it was opened."""

    def __init__(self, by: str, at: str) -> None:
        super().__init__(by)
        self.by = by
        self.at = at


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _words(value: object) -> str:
    return " ".join(str(value or "").split())


def _short(value: object, label: str) -> str:
    words = _words(value)
    if len(words) > LONGEST:
        raise InvalidPlan(f"Keep the {label} under {LONGEST} characters.")
    return words


def _time(value: object, label: str) -> str:
    raw = str(value or "").strip()
    if _SHORT_TIME.match(raw):
        raw = f"0{raw}"
    if not _TIME.match(raw):
        raise InvalidPlan(f"The {label} is not a time: write it as 08:30.")
    return raw


def _weekday(value: object) -> int:
    try:
        day = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise InvalidPlan("A class needs a day of the week.") from exc
    if not MONDAY <= day <= SUNDAY:
        raise InvalidPlan("A class needs a day of the week.")
    return day


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _iso_day(value: object, label: str) -> date:
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise InvalidPlan(f"{label} {raw!r} is not a date. Write it as 2027-01-11.") from exc


def teaching_mondays(week_one: str, without: list[str], count: int) -> dict[int, date]:
    """`teaching week -> its Monday`, stepping over the weeks without classes.

    The same count as the timetable's (`weekStartOf` in the frontend): Week 1 is the week
    `week_one` falls in, and a week without classes takes no number.
    """
    if not week_one:
        return {}
    skipped = set(without)
    monday = _monday(date.fromisoformat(week_one))
    mondays: dict[int, date] = {}
    week = 0
    for _ in range(400):
        if len(mondays) >= max(count, MOST_WEEKS):
            break
        if monday.isoformat() not in skipped:
            week += 1
            mondays[week] = monday
        monday += timedelta(weeks=1)
    return mondays


def _series(row: Any, moves: list[Any], names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sectionId": row["section_id"],
        "weekday": row["weekday"],
        "startsAt": row["starts_at"],
        "endsAt": row["ends_at"],
        "room": row["room"],
        "teacherName": row["teacher_name"],
        "weeks": json.loads(row["weeks"] or "[]"),
        "note": row["note"],
        "revision": row["revision"],
        "moves": [
            {
                "week": move["week"],
                "weekday": move["weekday"],
                "startsAt": move["starts_at"],
                "endsAt": move["ends_at"],
                "room": move["room"],
                "teacherName": move["teacher_name"],
            }
            for move in sorted(moves, key=lambda move: move["week"])
        ],
        "createdAt": row["created_at"],
        "createdBy": names.get(row["created_by"], row["created_by"]),
        "updatedAt": row["updated_at"],
        "updatedBy": names.get(row["updated_by"], row["updated_by"]),
    }


def _section(row: Any, names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "crn": row["crn"],
        "parentCrn": row["parent_crn"],
        "courseCode": row["course_code"],
        "title": row["title"],
        "ue": row["ue"],
        "component": row["component"],
        "programmes": json.loads(row["programmes"] or "[]"),
        "groupLabel": row["group_label"],
        "teacherName": row["teacher_name"],
        "hours": row["hours"],
        "hoursSaid": row["hours_said"],
        "comments": row["comments"],
        "position": row["position"],
        "updatedAt": row["updated_at"],
        "updatedBy": names.get(row["updated_by"], row["updated_by"]),
    }


def classes_of(term: dict[str, Any], series: list[dict[str, Any]], sections: dict[str, dict[str, Any]]):
    """The dated classes a plan's series make, and the ones a holiday takes away.

    A class lands on the Monday of its teaching week plus its weekday. One that falls on a
    holiday is not a class; it is listed apart, so a coordinator can see what the holiday
    cost and put it back elsewhere.
    """
    mondays = teaching_mondays(term["weekOne"], term["without"], term["weeks"])
    holidays = {entry["date"]: entry.get("label", "") for entry in term["holidays"]}
    classes: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for one in series:
        moved = {move["week"]: move for move in one["moves"]}
        teacher = one["teacherName"] or sections.get(one["sectionId"], {}).get("teacherName", "")
        for week in one["weeks"]:
            monday = mondays.get(week)
            if monday is None:
                continue
            slot = moved.get(week) or one
            day = (monday + timedelta(days=slot["weekday"] - 1)).isoformat()
            entry = {
                "seriesId": one["id"],
                "sectionId": one["sectionId"],
                "week": week,
                "meetsOn": day,
                "weekday": slot["weekday"],
                "startsAt": slot["startsAt"],
                "endsAt": slot["endsAt"],
                "room": slot["room"],
                "teacherName": slot["teacherName"] or teacher,
                "moved": week in moved,
            }
            if day in holidays:
                skipped.append({**entry, "holiday": holidays[day]})
            else:
                classes.append(entry)
    classes.sort(key=lambda entry: (entry["meetsOn"], entry["startsAt"], entry["sectionId"]))
    return classes, skipped


class PlanStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------ the semester

    def plans(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT t.term_code, t.name, t.week_one, t.weeks,
                               (SELECT count(*) FROM plan_sections s WHERE s.term_code = t.term_code) AS sections,
                               (SELECT count(*) FROM plan_series r WHERE r.term_code = t.term_code) AS series
                        FROM plan_terms t ORDER BY t.term_code DESC""")
            ).mappings()
            return [
                {
                    "termCode": row["term_code"],
                    "semesterId": semester_of(row["term_code"]),
                    "name": row["name"],
                    "weekOne": row["week_one"],
                    "weeks": row["weeks"],
                    "sections": row["sections"],
                    "series": row["series"],
                }
                for row in rows
            ]

    def create(self, term_code: str, name: str, *, actor: str = "") -> dict[str, Any]:
        code = str(term_code or "").strip()
        if not _TERM.match(code):
            raise InvalidPlan("A plan is kept under the portal's term code, six digits: 262720.")
        with self.engine.begin() as connection:
            taken = connection.execute(
                text("SELECT 1 FROM plan_terms WHERE term_code = :term"), {"term": code}
            ).first()
            if taken:
                raise InvalidPlan(f"There is a plan for {code} already.")
            connection.execute(
                text("""INSERT INTO plan_terms (term_code, name, updated_at, updated_by)
                        VALUES (:term, :name, :at, :by)"""),
                {"term": code, "name": _short(name, "name") or code, "at": _now(), "by": actor},
            )
            _as_semester(connection, self._term(connection, code), actor)
        return self.plan(code)

    def _term(self, connection: Connection, term_code: str) -> dict[str, Any]:
        row = connection.execute(
            text("SELECT * FROM plan_terms WHERE term_code = :term"), {"term": term_code}
        ).mappings().first()
        if not row:
            raise PlanNotFound(term_code)
        return {
            "termCode": row["term_code"],
            "semesterId": semester_of(row["term_code"]),
            "name": row["name"],
            "weekOne": row["week_one"],
            "weeks": row["weeks"],
            "without": json.loads(row["without"] or "[]"),
            "holidays": json.loads(row["holidays"] or "[]"),
            "updatedAt": row["updated_at"],
            "updatedBy": row["updated_by"],
        }

    def settle(self, term_code: str, fields: dict[str, Any], *, actor: str = "") -> dict[str, Any]:
        """The semester's name, Week 1, how many teaching weeks, its breaks and its holidays."""
        week_one = str(fields.get("weekOne") or "").strip()
        if week_one:
            week_one = _iso_day(week_one, "Week 1").isoformat()
        weeks = int(fields.get("weeks") or 0)
        if not 0 <= weeks <= MOST_WEEKS:
            raise InvalidPlan(f"A semester has between 1 and {MOST_WEEKS} teaching weeks.")
        without = sorted(
            {_monday(_iso_day(day, "A week without classes")).isoformat() for day in fields.get("without") or []}
        )
        holidays: dict[str, str] = {}
        for entry in fields.get("holidays") or []:
            day = _iso_day(entry.get("date"), "A holiday").isoformat()
            holidays[day] = _short(entry.get("label"), "holiday's name")
        with self.engine.begin() as connection:
            self._term(connection, term_code)
            longest = connection.execute(
                text("SELECT weeks FROM plan_series WHERE term_code = :term"), {"term": term_code}
            ).scalars()
            used = max((max(json.loads(raw or "[]") or [0]) for raw in longest), default=0)
            if weeks and used > weeks:
                raise InvalidPlan(
                    f"Classes are planned in week {used}; "
                    f"take them out of it before ending the semester at week {weeks}."
                )
            connection.execute(
                text("""UPDATE plan_terms SET name = :name, week_one = :week_one, weeks = :weeks,
                            without = :without, holidays = :holidays, updated_at = :at, updated_by = :by
                        WHERE term_code = :term"""),
                {
                    "term": term_code,
                    "name": _short(fields.get("name"), "name") or term_code,
                    "week_one": week_one,
                    "weeks": weeks,
                    "without": json.dumps(without),
                    "holidays": json.dumps([{"date": day, "label": label} for day, label in sorted(holidays.items())]),
                    "at": _now(),
                    "by": actor,
                },
            )
            _as_semester(connection, self._term(connection, term_code), actor)
        return self.plan(term_code)

    def plan(self, term_code: str) -> dict[str, Any]:
        """The whole plan: the semester, its classes to place, its series, and the dated classes."""
        with self.engine.connect() as connection:
            term = self._term(connection, term_code)
            section_rows = connection.execute(
                text("SELECT * FROM plan_sections WHERE term_code = :term ORDER BY position, course_code, title"),
                {"term": term_code},
            ).mappings().all()
            series_rows = connection.execute(
                text("SELECT * FROM plan_series WHERE term_code = :term ORDER BY created_at, id"),
                {"term": term_code},
            ).mappings().all()
            move_rows = connection.execute(
                text("""SELECT m.* FROM plan_series_moves m JOIN plan_series s ON s.id = m.series_id
                        WHERE s.term_code = :term"""),
                {"term": term_code},
            ).mappings().all()
        emails = {term["updatedBy"]} | {row["updated_by"] for row in section_rows}
        emails |= {row["updated_by"] for row in series_rows} | {row["created_by"] for row in series_rows}
        names = {email: name_for(email) for email in emails if email}
        term["updatedBy"] = names.get(term["updatedBy"], term["updatedBy"])
        moves: dict[str, list[Any]] = {}
        for move in move_rows:
            moves.setdefault(move["series_id"], []).append(move)
        sections = [_section(row, names) for row in section_rows]
        series = [_series(row, moves.get(row["id"], []), names) for row in series_rows]
        classes, skipped = classes_of(term, series, {section["id"]: section for section in sections})
        return {**term, "sections": sections, "series": series, "classes": classes, "skipped": skipped}

    # ------------------------------------------------------------------ the classes to place

    def _section_fields(self, fields: dict[str, Any]) -> dict[str, Any]:
        hours = fields.get("hours")
        if hours is not None:
            hours = float(hours)
            if not 0 <= hours <= MOST_HOURS:
                raise InvalidPlan(f"Hours asked for are between 0 and {MOST_HOURS}.")
        programmes: dict[str, str] = {}
        for value in fields.get("programmes") or []:
            words = _short(value, "programme")
            if words:
                programmes.setdefault(words.casefold(), words)
        crn = str(fields.get("crn") or "").strip()
        if crn and not crn.isdigit():
            raise InvalidPlan(f"{crn!r} is not a CRN: CRNs are numbers.")
        parent = str(fields.get("parentCrn") or "").strip()
        if parent and not parent.isdigit():
            raise InvalidPlan(f"{parent!r} is not a parent CRN: CRNs are numbers.")
        title = _short(fields.get("title"), "class's name")
        code = _short(fields.get("courseCode"), "course code").upper()
        if not title and not code:
            raise InvalidPlan("A class to place needs a course code or a name.")
        return {
            "crn": crn,
            "parent_crn": parent,
            "course_code": code,
            "title": title,
            "ue": _short(fields.get("ue"), "UE"),
            "component": _short(fields.get("component"), "type"),
            "programmes": json.dumps(list(programmes.values())),
            "group_label": _short(fields.get("groupLabel"), "group"),
            "teacher_name": _short(fields.get("teacherName"), "teacher's name"),
            "hours": hours,
            "hours_said": _short(fields.get("hoursSaid"), "hours as asked"),
            "comments": str(fields.get("comments") or "").strip()[:2000],
            "position": int(fields.get("position") or 0),
        }

    def _crn_free(self, connection: Connection, term_code: str, crn: str, keeping: str = "") -> None:
        if not crn:
            return
        taken = connection.execute(
            text("SELECT title FROM plan_sections WHERE term_code = :term AND crn = :crn AND id <> :keeping"),
            {"term": term_code, "crn": crn, "keeping": keeping},
        ).first()
        if taken:
            raise InvalidPlan(f"CRN {crn} is in the plan already, as {taken[0] or 'another class'}.")

    def add_section(self, term_code: str, fields: dict[str, Any], *, actor: str = "") -> dict[str, Any]:
        section = self._section_fields(fields)
        section_id = str(uuid.uuid4())
        with self.engine.begin() as connection:
            self._term(connection, term_code)
            self._crn_free(connection, term_code, section["crn"])
            connection.execute(
                text("""INSERT INTO plan_sections (id, term_code, crn, parent_crn, course_code, title, ue, component,
                            programmes, group_label, teacher_name, hours, hours_said, comments, position,
                            updated_at, updated_by)
                        VALUES (:id, :term, :crn, :parent_crn, :course_code, :title, :ue, :component,
                            :programmes, :group_label, :teacher_name, :hours, :hours_said, :comments, :position,
                            :at, :by)"""),
                {**section, "id": section_id, "term": term_code, "at": _now(), "by": actor},
            )
        return self._one_section(section_id)

    def update_section(
        self, term_code: str, section_id: str, fields: dict[str, Any], *, actor: str = ""
    ) -> dict[str, Any]:
        section = self._section_fields(fields)
        with self.engine.begin() as connection:
            self._crn_free(connection, term_code, section["crn"], keeping=section_id)
            changed = connection.execute(
                text("""UPDATE plan_sections SET crn = :crn, parent_crn = :parent_crn, course_code = :course_code,
                            title = :title, ue = :ue, component = :component, programmes = :programmes,
                            group_label = :group_label, teacher_name = :teacher_name, hours = :hours,
                            hours_said = :hours_said, comments = :comments, position = :position,
                            updated_at = :at, updated_by = :by
                        WHERE id = :id AND term_code = :term"""),
                {**section, "id": section_id, "term": term_code, "at": _now(), "by": actor},
            )
        if changed.rowcount == 0:
            raise PlanNotFound(section_id)
        return self._one_section(section_id)

    def remove_section(self, term_code: str, section_id: str) -> None:
        """Take a class off the plan, with everywhere it was placed."""
        with self.engine.begin() as connection:
            gone = connection.execute(
                text("DELETE FROM plan_sections WHERE id = :id AND term_code = :term"),
                {"id": section_id, "term": term_code},
            )
        if gone.rowcount == 0:
            raise PlanNotFound(section_id)

    def _one_section(self, section_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(
                text("SELECT * FROM plan_sections WHERE id = :id"), {"id": section_id}
            ).mappings().first()
        if not row:
            raise PlanNotFound(section_id)
        return _section(row, {row["updated_by"]: name_for(row["updated_by"])} if row["updated_by"] else {})

    # ------------------------------------------------------------------ placing classes

    def _weeks(self, values: object, term: dict[str, Any]) -> list[int]:
        try:
            weeks = sorted({int(value) for value in (values or [])})  # type: ignore[union-attr]
        except (TypeError, ValueError) as exc:
            raise InvalidPlan("Weeks are teaching-week numbers: 1, 2, 3.") from exc
        if not weeks:
            raise InvalidPlan("Choose at least one week for the class to meet in.")
        last = term["weeks"] or MOST_WEEKS
        if weeks[0] < 1 or weeks[-1] > last:
            raise InvalidPlan(f"The semester's teaching weeks are 1 to {last}.")
        return weeks

    def _slot(self, fields: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
        """A weekday, an hour and a room, checked; anything not given is the base's."""
        base = base or {}
        given = {key: fields[key] for key in OWN if key in fields}
        slot = {
            "weekday": _weekday(given.get("weekday", base.get("weekday"))),
            "startsAt": _time(given.get("startsAt", base.get("startsAt")), "start"),
            "endsAt": _time(given.get("endsAt", base.get("endsAt")), "end"),
            "room": _short(given.get("room", base.get("room", "")), "room"),
            "teacherName": _short(given.get("teacherName", base.get("teacherName", "")), "teacher's name"),
        }
        if slot["startsAt"] >= slot["endsAt"]:
            raise InvalidPlan("A class ends after it starts.")
        return slot

    def _load_series(self, connection: Connection, term_code: str, series_id: str) -> dict[str, Any]:
        row = connection.execute(
            text("SELECT * FROM plan_series WHERE id = :id AND term_code = :term FOR UPDATE"),
            {"id": series_id, "term": term_code},
        ).mappings().first()
        if not row:
            raise PlanNotFound(series_id)
        moves = connection.execute(
            text("SELECT * FROM plan_series_moves WHERE series_id = :id"), {"id": series_id}
        ).mappings().all()
        return _series(row, list(moves), {})

    def _check_revision(self, series: dict[str, Any], revision: int | None) -> None:
        if revision is not None and revision != series["revision"]:
            raise PlanConflict(name_for(series["updatedBy"]) if series["updatedBy"] else "", series["updatedAt"])

    def _insert_series(  # noqa: PLR0913 - where, which class, when, which weeks, the note, and who
        self, connection: Connection, term_code: str, section_id: str, slot: dict[str, Any], weeks: list[int],
        note: str, actor: str,
    ) -> str:
        series_id = str(uuid.uuid4())
        at = _now()
        connection.execute(
            text("""INSERT INTO plan_series (id, term_code, section_id, weekday, starts_at, ends_at, room,
                        teacher_name, weeks, note, revision, created_at, created_by, updated_at, updated_by)
                    VALUES (:id, :term, :section, :weekday, :starts_at, :ends_at, :room, :teacher, :weeks,
                        :note, 1, :at, :by, :at, :by)"""),
            {
                "id": series_id,
                "term": term_code,
                "section": section_id,
                "weekday": slot["weekday"],
                "starts_at": slot["startsAt"],
                "ends_at": slot["endsAt"],
                "room": slot["room"],
                "teacher": slot["teacherName"],
                "weeks": json.dumps(weeks),
                "note": note,
                "at": at,
                "by": actor,
            },
        )
        return series_id

    def _save_series(  # noqa: PLR0913 - the series, its new slot, weeks and note, and who
        self, connection: Connection, series: dict[str, Any], slot: dict[str, Any], weeks: list[int], note: str,
        actor: str,
    ) -> None:
        connection.execute(
            text("""UPDATE plan_series SET weekday = :weekday, starts_at = :starts_at, ends_at = :ends_at,
                        room = :room, teacher_name = :teacher, weeks = :weeks, note = :note,
                        revision = revision + 1, updated_at = :at, updated_by = :by
                    WHERE id = :id"""),
            {
                "id": series["id"],
                "weekday": slot["weekday"],
                "starts_at": slot["startsAt"],
                "ends_at": slot["endsAt"],
                "room": slot["room"],
                "teacher": slot["teacherName"],
                "weeks": json.dumps(weeks),
                "note": note,
                "at": _now(),
                "by": actor,
            },
        )

    def place(self, term_code: str, fields: dict[str, Any], *, actor: str = "") -> dict[str, Any]:
        """Put a class on the calendar: a weekday, an hour, a room, and the weeks it repeats in."""
        with self.engine.begin() as connection:
            term = self._term(connection, term_code)
            section = connection.execute(
                text("SELECT id FROM plan_sections WHERE id = :id AND term_code = :term"),
                {"id": str(fields.get("sectionId") or ""), "term": term_code},
            ).first()
            if not section:
                raise InvalidPlan("Choose which class this is from the plan's classes to place.")
            slot = self._slot(fields)
            weeks = self._weeks(fields.get("weeks"), term)
            series_id = self._insert_series(
                connection, term_code, section[0], slot, weeks, _short(fields.get("note"), "note"), actor
            )
        return self._series_of(term_code, series_id)

    def change(  # noqa: PLR0913 - which class, which part of the series, the change, its revision, and who
        self, term_code: str, series_id: str, *, scope: str, week: int | None, changes: dict[str, Any],
        revision: int | None, actor: str = "",
    ) -> dict[str, Any]:
        """Change one week of a series, that week and the ones after it, or all of it."""
        if scope not in SCOPES:
            raise InvalidPlan("Say whether the change is for this class, the following ones, or all of them.")
        with self.engine.begin() as connection:
            term = self._term(connection, term_code)
            series = self._load_series(connection, term_code, series_id)
            self._check_revision(series, revision)
            weeks = series["weeks"]
            if scope != "all" and week not in weeks:
                raise InvalidPlan(f"This class does not meet in week {week}.")
            if scope == "following" and week == weeks[0]:
                scope = "all"
            if scope == "one" and len(weeks) == 1:
                scope = "all"
            note = _short(changes.get("note", series["note"]), "note")

            if scope == "all":
                fresh = self._change_all(connection, term, series, changes, note, actor)
            elif scope == "following":
                fresh = self._change_following(connection, term, series, week, changes, note, actor)
            else:
                fresh = self._change_one(connection, series, week, changes, note, actor)
            return self._series_of(term_code, fresh, connection)

    def _change_all(  # noqa: PLR0913 - the series, its semester, the change, and who
        self, connection: Connection, term: dict[str, Any], series: dict[str, Any], changes: dict[str, Any],
        note: str, actor: str,
    ) -> str:
        slot = self._slot(changes, series)
        weeks = self._weeks(changes["weeks"], term) if "weeks" in changes else series["weeks"]
        if any(key in changes for key in OWN):
            # The whole series moves, and so do the weeks that had been moved on their own.
            connection.execute(text("DELETE FROM plan_series_moves WHERE series_id = :id"), {"id": series["id"]})
        else:
            connection.execute(
                text("DELETE FROM plan_series_moves WHERE series_id = :id AND NOT (week = ANY(:weeks))"),
                {"id": series["id"], "weeks": weeks},
            )
        self._save_series(connection, series, slot, weeks, note, actor)
        return series["id"]

    def _change_following(  # noqa: PLR0913 - the series, its semester, from which week, the change, and who
        self, connection: Connection, term: dict[str, Any], series: dict[str, Any], week: int,
        changes: dict[str, Any], note: str, actor: str,
    ) -> str:
        before = [each for each in series["weeks"] if each < week]
        after = [each for each in series["weeks"] if each >= week]
        if "weeks" in changes:
            after = [each for each in self._weeks(changes["weeks"], term) if each >= week]
            if not after:
                raise InvalidPlan(f"Keep at least one week from week {week} on, or delete these classes.")
        slot = self._slot(changes, series)
        base = {key: series[key] for key in OWN}
        self._save_series(connection, series, base, before, series["note"], actor)
        connection.execute(
            text("DELETE FROM plan_series_moves WHERE series_id = :id AND week >= :week"),
            {"id": series["id"], "week": week},
        )
        return self._insert_series(connection, term["termCode"], series["sectionId"], slot, after, note, actor)

    def _change_one(  # noqa: PLR0913 - the series, which week, the change, and who
        self, connection: Connection, series: dict[str, Any], week: int, changes: dict[str, Any], note: str,
        actor: str,
    ) -> str:
        if "weeks" in changes:
            raise InvalidPlan("A single class keeps its week; change the weeks for the whole series.")
        current = next((move for move in series["moves"] if move["week"] == week), None)
        slot = self._slot(changes, current or series)
        if all(slot[key] == series[key] for key in OWN):
            connection.execute(
                text("DELETE FROM plan_series_moves WHERE series_id = :id AND week = :week"),
                {"id": series["id"], "week": week},
            )
        else:
            connection.execute(
                text("""INSERT INTO plan_series_moves (series_id, week, weekday, starts_at, ends_at, room,
                            teacher_name, updated_at, updated_by)
                        VALUES (:id, :week, :weekday, :starts_at, :ends_at, :room, :teacher, :at, :by)
                        ON CONFLICT (series_id, week) DO UPDATE SET weekday = excluded.weekday,
                            starts_at = excluded.starts_at, ends_at = excluded.ends_at, room = excluded.room,
                            teacher_name = excluded.teacher_name, updated_at = excluded.updated_at,
                            updated_by = excluded.updated_by"""),
                {
                    "id": series["id"],
                    "week": week,
                    "weekday": slot["weekday"],
                    "starts_at": slot["startsAt"],
                    "ends_at": slot["endsAt"],
                    "room": slot["room"],
                    "teacher": slot["teacherName"],
                    "at": _now(),
                    "by": actor,
                },
            )
        base = {key: series[key] for key in OWN}
        self._save_series(connection, series, base, series["weeks"], note, actor)
        return series["id"]

    def remove(  # noqa: PLR0913 - which class, which part of the series, against which revision, by whom
        self, term_code: str, series_id: str, *, scope: str, week: int | None, revision: int | None, actor: str = ""
    ) -> None:
        """Take one class of a series away, that one and those after it, or the whole series."""
        if scope not in SCOPES:
            raise InvalidPlan("Say whether to delete this class, the following ones, or all of them.")
        with self.engine.begin() as connection:
            series = self._load_series(connection, term_code, series_id)
            self._check_revision(series, revision)
            weeks = series["weeks"]
            if scope != "all" and week not in weeks:
                raise InvalidPlan(f"This class does not meet in week {week}.")
            if scope == "all":
                left = []
            elif scope == "one":
                left = [each for each in weeks if each != week]
            else:
                left = [each for each in weeks if each < week]
            if not left:
                connection.execute(text("DELETE FROM plan_series WHERE id = :id"), {"id": series_id})
                return
            connection.execute(
                text("DELETE FROM plan_series_moves WHERE series_id = :id AND NOT (week = ANY(:weeks))"),
                {"id": series_id, "weeks": left},
            )
            connection.execute(
                text("""UPDATE plan_series SET weeks = :weeks, revision = revision + 1, updated_at = :at,
                            updated_by = :by
                        WHERE id = :id"""),
                {"id": series_id, "weeks": json.dumps(left), "at": _now(), "by": actor},
            )

    def _series_of(self, term_code: str, series_id: str, connection: Connection | None = None) -> dict[str, Any]:
        if connection is None:
            with self.engine.connect() as fresh:
                return self._series_of(term_code, series_id, fresh)
        row = connection.execute(
            text("SELECT * FROM plan_series WHERE id = :id AND term_code = :term"), {"id": series_id, "term": term_code}
        ).mappings().first()
        if not row:
            raise PlanNotFound(series_id)
        moves = connection.execute(
            text("SELECT * FROM plan_series_moves WHERE series_id = :id"), {"id": series_id}
        ).mappings().all()
        emails = {row["created_by"], row["updated_by"]} - {""}
        return _series(row, list(moves), {email: name_for(email) for email in emails})
