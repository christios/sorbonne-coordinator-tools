"""Course plans: each course's hours, its lead, and its weeks, semester by semester.

One plan per course per semester, shared by every cohort that takes it (user, 18 Nov 2026):

  - **hours** — CM, TD and TP hours (TD and TP per group) and the length of one session of
    each. Coordinators set them; they are the targets, locked for the lead.
  - **lead** — the teacher who leads the course that semester, picked by hand by coordinators.
    Nothing suggests one, not even the CM teacher.
  - **weeks** — how many sessions of each fall in each teaching week, and the weeks whose
    sessions last longer or shorter than usual (a three-hour exam session). The lead lays them out
    in the Timetable preferences request (a step of its own, only for leads), or a coordinator
    does for them; a lead who disagrees with a total says so in the note.

The teaching weeks are the Semester plan's: Week 1 is the week its first day falls in, and a
week without classes takes no number (`semester_plans.teaching_mondays`). A holiday is a day
inside a teaching week, shown with it.

Groups & CRNs rows keep their own hours, which Teaching loads and requisitions go on reading;
the course plan is compared with them, never written into them. The Semester plan reads the
weeks to propose where a series goes and to flag one that does not match. Nothing here blocks
a placement.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from sorbonne.services.coordinator_directory import name_for
from sorbonne.services.semester_plans import teaching_mondays

COMPONENTS = ("CM", "TD", "TP")
#: The most hours a course's component can have in a semester, and one session's longest.
MOST_HOURS = 500
LONGEST_SESSION = 8
#: The most sessions of one component in one week.
MOST_SESSIONS = 7
NOTE_LENGTH = 2000
CODE_LENGTH = 40
#: Two lengths this close are the same one.
SAME_LENGTH = 0.001
#: How a lay-out came: the lead through their invitation, or a coordinator for them.
LEAD, COORDINATOR = "lead", "coordinator"
_TERM = re.compile(r"^\d{6}$")


class InvalidCoursePlan(ValueError):
    pass


class UnknownCourse(LookupError):
    """A course that is not active in the semester asked about."""


class NotTheLead(PermissionError):
    """A teacher laying out a course somebody else leads, or nobody."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _term(term_code: str) -> str:
    code = str(term_code or "").strip()
    if not _TERM.match(code):
        raise InvalidCoursePlan("A semester is asked for by its portal term, six digits: 262720.")
    return code


def _code(course_code: str) -> str:
    code = str(course_code or "").strip().upper()
    if not code or len(code) > CODE_LENGTH:
        raise InvalidCoursePlan("A course is asked for by its code: MATH-002.")
    return code


def _figure(value: object, label: str, most: float) -> float | None:
    """A number of hours as kept: None for nothing said, else a positive number up to `most`."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(str(value).replace(",", "."))
    except ValueError as exc:
        raise InvalidCoursePlan(f"{label} is a number of hours, like 24 or 1.5.") from exc
    if number == 0:
        return None
    if not 0 < number <= most:
        raise InvalidCoursePlan(f"{label} is between 0 and {most} hours.")
    return round(number, 2)


def _words(value: object, most: int) -> str:
    return str(value or "").strip()[:most]


def teaching_weeks(connection: Connection, term: str) -> list[dict[str, Any]]:
    """The semester's teaching weeks as the Semester plan numbers them: each week's number, its
    Monday ("" while Week 1 is not set), and the holidays that fall in it."""
    plan = (
        connection.execute(
            text("SELECT week_one, weeks, without, holidays FROM plan_terms WHERE term_code = :term"),
            {"term": term},
        )
        .mappings()
        .first()
    )
    if not plan or not plan["weeks"]:
        return []
    count = int(plan["weeks"])
    mondays = teaching_mondays(plan["week_one"] or "", json.loads(plan["without"] or "[]"), count)
    holidays = json.loads(plan["holidays"] or "[]")
    weeks = []
    for week in range(1, count + 1):
        monday = mondays.get(week)
        start = monday.isoformat() if monday else ""
        end = monday.toordinal() + 6 if monday else 0
        weeks.append(
            {
                "week": week,
                "monday": start,
                "holidays": [
                    {"date": entry["date"], "label": entry.get("label", "")}
                    for entry in holidays
                    if monday and monday.toordinal() <= _ordinal(entry.get("date")) <= end
                ],
            }
        )
    return weeks


def _ordinal(day: object) -> int:
    try:
        return datetime.fromisoformat(str(day)).date().toordinal()
    except ValueError:
        return -1


def _layout(raw: object) -> dict[str, dict[str, int]]:
    """Weeks as kept: {"CM": {"1": 1}}; anything unreadable, none."""
    try:
        held = json.loads(raw or "{}") if isinstance(raw, str) else raw
    except ValueError:
        return {}
    if not isinstance(held, dict):
        return {}
    return {
        component: {str(week): int(count) for week, count in (held.get(component) or {}).items() if int(count) > 0}
        for component in COMPONENTS
        if isinstance(held.get(component), dict)
    }


def _lengths(raw: object) -> dict[str, dict[str, float]]:
    """A week's own session length, as kept: {"CM": {"8": 3.0}}; anything unreadable, none."""
    try:
        held = json.loads(raw or "{}") if isinstance(raw, str) else raw
    except ValueError:
        return {}
    if not isinstance(held, dict):
        return {}
    return {
        component: {str(week): float(hours) for week, hours in (held.get(component) or {}).items()}
        for component in COMPONENTS
        if isinstance(held.get(component), dict) and held.get(component)
    }


def _plan(row: Any, names: dict[str, str]) -> dict[str, Any]:
    """A course's plan for a semester, as every page reads it."""
    return {
        "courseCode": row["course_code"],
        "title": row["title"] or "",
        "coefficient": row["coefficient"] or "",
        # Still on the semester's list of active courses; a plan outlives being taken off it.
        "active": bool(row["active"]),
        "components": {
            component: {
                "hours": row[f"{component.lower()}_hours"],
                "length": row[f"{component.lower()}_length"],
            }
            for component in COMPONENTS
        },
        "hoursUpdatedAt": row["hours_updated_at"] or "",
        "hoursUpdatedBy": name_for(row["hours_updated_by"]) if row["hours_updated_by"] else "",
        "leadId": row["lead_id"] or "",
        "leadName": names.get(row["lead_id"] or "", ""),
        "leadSetAt": row["lead_set_at"] or "",
        "leadSetBy": name_for(row["lead_set_by"]) if row["lead_set_by"] else "",
        "weeks": _layout(row["weeks"]),
        # Only the weeks whose sessions last other than the component's usual length.
        "lengths": _lengths(row["lengths"]),
        "note": row["note"] or "",
        "answeredAt": row["answered_at"] or "",
        "answeredBy": (
            names.get(row["lead_id"] or "", "")
            if row["answer_source"] == LEAD
            else (name_for(row["answered_by"]) if row["answered_by"] else "")
        ),
        "answerSource": row["answer_source"] or "",
    }


_PLANS = """
    SELECT a.course_code, a.title, a.coefficient,
           EXISTS (SELECT 1 FROM active_course_terms t
                   WHERE t.course_code = a.course_code AND t.term_code = :term) AS active,
           p.cm_hours, p.td_hours, p.tp_hours, p.cm_length, p.td_length, p.tp_length,
           coalesce(p.hours_updated_at, '') AS hours_updated_at,
           coalesce(p.hours_updated_by, '') AS hours_updated_by,
           coalesce(p.lead_id, '') AS lead_id, coalesce(p.lead_set_at, '') AS lead_set_at,
           coalesce(p.lead_set_by, '') AS lead_set_by, coalesce(p.weeks, '{}') AS weeks,
           coalesce(p.lengths, '{}') AS lengths,
           coalesce(p.note, '') AS note, coalesce(p.answered_at, '') AS answered_at,
           coalesce(p.answered_by, '') AS answered_by, coalesce(p.answer_source, '') AS answer_source
    FROM active_courses a
    LEFT JOIN course_plans p ON p.course_code = a.course_code AND p.term_code = :term
    WHERE (EXISTS (SELECT 1 FROM active_course_terms t WHERE t.course_code = a.course_code AND t.term_code = :term)
           OR p.course_code IS NOT NULL)
"""


class CoursePlans:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------ reading

    @staticmethod
    def _names(connection: Connection) -> dict[str, str]:
        """Every Active teacher's name, as the preferences list writes it."""
        return dict(
            connection.execute(
                text("""SELECT a.id,
                           coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), a.email, a.id)
                        FROM active_teachers a LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id""")
            ).all()
        )

    def semester(self, term_code: str) -> dict[str, Any]:
        """Every course active in the semester, with its plan — empty for one nobody has
        planned — and the semester's teaching weeks."""
        term = _term(term_code)
        with self.engine.connect() as connection:
            names = self._names(connection)
            rows = connection.execute(text(_PLANS + " ORDER BY a.course_code"), {"term": term}).mappings().all()
            weeks = teaching_weeks(connection, term)
        return {"termCode": term, "weeks": weeks, "courses": [_plan(row, names) for row in rows]}

    def course(self, term_code: str, course_code: str, connection: Connection | None = None) -> dict[str, Any]:
        term, code = _term(term_code), _code(course_code)
        if connection is None:
            with self.engine.connect() as fresh:
                return self.course(term, code, fresh)
        row = (
            connection.execute(text(_PLANS + " AND a.course_code = :code"), {"term": term, "code": code})
            .mappings()
            .first()
        )
        if row is None:
            raise UnknownCourse(code)
        return _plan(row, self._names(connection))

    def led_by(self, term_code: str, teacher_id: str) -> dict[str, Any] | None:
        """What a lead's step shows: the courses they lead in the semester and its teaching
        weeks; None for somebody who leads nothing, who never sees the step."""
        term = _term(term_code)
        if not teacher_id:
            return None
        with self.engine.connect() as connection:
            names = self._names(connection)
            rows = (
                connection.execute(
                    text(_PLANS + " AND p.lead_id = :lead ORDER BY a.course_code"), {"term": term, "lead": teacher_id}
                )
                .mappings()
                .all()
            )
            if not rows:
                return None
            weeks = teaching_weeks(connection, term)
        return {"termCode": term, "weeks": weeks, "courses": [_plan(row, names) for row in rows]}

    # ------------------------------------------------------------------ writing

    @staticmethod
    def _active(connection: Connection, term: str, code: str) -> None:
        held = connection.execute(
            text("SELECT 1 FROM active_course_terms WHERE course_code = :code AND term_code = :term"),
            {"code": code, "term": term},
        ).first()
        if held is None:
            raise UnknownCourse(code)

    @staticmethod
    def _ensure(connection: Connection, term: str, code: str) -> None:
        connection.execute(
            text("""INSERT INTO course_plans (term_code, course_code) VALUES (:term, :code)
                    ON CONFLICT DO NOTHING"""),
            {"term": term, "code": code},
        )

    def set_hours(self, term_code: str, course_code: str, given: dict[str, Any], actor: str = "") -> dict[str, Any]:
        """A course's CM, TD and TP hours and the length of a session of each: the coordinators'.

        A component left out is kept as it is; one sent with no hours is cleared. Hours need a
        session length, since the lead lays them out in sessions."""
        term, code = _term(term_code), _code(course_code)
        values: dict[str, float | None] = {}
        for component in COMPONENTS:
            if component not in given:
                continue
            entry = given[component] or {}
            hours = _figure(entry.get("hours"), f"{component} hours", MOST_HOURS)
            length = _figure(entry.get("length"), f"A {component} session", LONGEST_SESSION)
            if hours and not length:
                raise InvalidCoursePlan(
                    f"Say how long one {component} session lasts, so its {hours:g} h can be laid out."
                )
            values[f"{component.lower()}_hours"] = hours
            values[f"{component.lower()}_length"] = length if hours else None
        with self.engine.begin() as connection:
            self._active(connection, term, code)
            self._ensure(connection, term, code)
            if values:
                assignments = ", ".join(f"{column} = :{column}" for column in values)
                connection.execute(
                    text(
                        f"UPDATE course_plans SET {assignments}, hours_updated_at = :at, hours_updated_by = :by "  # noqa: S608 - fixed columns
                        "WHERE term_code = :term AND course_code = :code"
                    ),
                    {**values, "at": _now(), "by": actor, "term": term, "code": code},
                )
            return self.course(term, code, connection)

    def set_lead(self, term_code: str, course_code: str, lead_id: str, actor: str = "") -> dict[str, Any]:
        """The teacher who leads the course this semester, picked by a coordinator; "" for nobody."""
        term, code, lead = _term(term_code), _code(course_code), str(lead_id or "").strip()
        with self.engine.begin() as connection:
            self._active(connection, term, code)
            known = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": lead}).first()
            if lead and known is None:
                raise InvalidCoursePlan("A course lead is one of the department's Active teachers.")
            self._ensure(connection, term, code)
            connection.execute(
                text("""UPDATE course_plans SET lead_id = :lead, lead_set_at = :at, lead_set_by = :by
                        WHERE term_code = :term AND course_code = :code"""),
                {"lead": lead, "at": _now(), "by": actor, "term": term, "code": code},
            )
            return self.course(term, code, connection)

    def lay_out(  # noqa: PLR0913 - which course, its weeks and note, and who laid them out how
        self,
        term_code: str,
        course_code: str,
        weeks: dict[str, Any],
        note: str | None = None,
        *,
        actor: str = "",
        source: str = COORDINATOR,
        lead_id: str = "",
        lengths: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """How many sessions of each component fall in each teaching week, and the lead's note.

        By the lead (`source` "lead", with their `lead_id`) only for a course they lead; by a
        coordinator for anybody's. Only the components the course has hours for are kept: the
        lead lays out the coordinators' totals, never one of their own. A week's sessions may
        last other than the usual length (`lengths`, hours by week), which the totals count.
        """
        return self.lay_out_all(
            term_code,
            [{"courseCode": course_code, "weeks": weeks, "note": note, "lengths": lengths or {}}],
            actor=actor,
            source=source,
            lead_id=lead_id,
        )[0]

    def lay_out_all(
        self,
        term_code: str,
        layouts: list[dict[str, Any]],
        *,
        actor: str = "",
        source: str = COORDINATOR,
        lead_id: str = "",
    ) -> list[dict[str, Any]]:
        """Several courses laid out at once, all or none: a lead's step saves every course they lead."""
        term = _term(term_code)
        saved = []
        with self.engine.begin() as connection:
            count = len(teaching_weeks(connection, term))
            for given in layouts:
                code = _code(given.get("courseCode", ""))
                self._active(connection, term, code)
                current = self.course(term, code, connection)
                if source == LEAD and (not lead_id or current["leadId"] != lead_id):
                    raise NotTheLead(code)
                try:
                    layout = self._checked_layout(given.get("weeks") or {}, current, count)
                    lengths = self._checked_lengths(given.get("lengths") or {}, current, layout)
                except InvalidCoursePlan as exc:
                    # Said with the course's code when the lead's step sends several.
                    if len(layouts) > 1:
                        raise InvalidCoursePlan(f"{code}: {exc}") from exc
                    raise
                note = given.get("note")
                self._ensure(connection, term, code)
                connection.execute(
                    text("""UPDATE course_plans SET weeks = :weeks, lengths = :lengths, note = :note, answered_at = :at,
                                answered_by = :by, answer_source = :source
                            WHERE term_code = :term AND course_code = :code"""),
                    {
                        "weeks": json.dumps(layout),
                        "lengths": json.dumps(lengths),
                        "note": current["note"] if note is None else _words(note, NOTE_LENGTH),
                        "at": _now(),
                        "by": actor,
                        "source": source,
                        "term": term,
                        "code": code,
                    },
                )
                saved.append(self.course(term, code, connection))
        return saved

    @staticmethod
    def _checked_layout(weeks: dict[str, Any], current: dict[str, Any], count: int) -> dict[str, dict[str, int]]:
        layout: dict[str, dict[str, int]] = {}
        for component, by_week in (weeks or {}).items():
            if component not in COMPONENTS:
                raise InvalidCoursePlan(f"A course's sessions are CM, TD or TP, not {component}.")
            if not current["components"][component]["hours"]:
                # Not the course's: the coordinators set no hours for it.
                continue
            kept: dict[str, int] = {}
            for week, sessions in (by_week or {}).items():
                try:
                    number, many = int(str(week)), int(sessions)
                except (TypeError, ValueError) as exc:
                    raise InvalidCoursePlan("Each week holds a whole number of sessions.") from exc
                if many == 0:
                    continue
                if not count:
                    raise InvalidCoursePlan("The semester's teaching weeks are not set yet: nothing can be laid out.")
                if not 1 <= number <= count:
                    raise InvalidCoursePlan(f"The semester's teaching weeks are 1 to {count}.")
                if not 0 < many <= MOST_SESSIONS:
                    raise InvalidCoursePlan(f"A week holds between 0 and {MOST_SESSIONS} {component} sessions.")
                kept[str(number)] = many
            if kept:
                layout[component] = dict(sorted(kept.items(), key=lambda item: int(item[0])))
        return layout

    @staticmethod
    def _checked_lengths(
        lengths: dict[str, Any], current: dict[str, Any], layout: dict[str, dict[str, int]]
    ) -> dict[str, dict[str, float]]:
        """The weeks whose sessions last other than usual: only weeks that have sessions, and only
        where the length differs from the component's usual one."""
        kept: dict[str, dict[str, float]] = {}
        for component, by_week in (lengths or {}).items():
            if component not in COMPONENTS:
                raise InvalidCoursePlan(f"A course's sessions are CM, TD or TP, not {component}.")
            usual = current["components"][component]["length"]
            for week, hours in (by_week or {}).items():
                length = _figure(hours, f"A {component} session in week {week}", LONGEST_SESSION)
                if length is None or str(week) not in layout.get(component, {}):
                    continue
                if usual is not None and abs(length - usual) < SAME_LENGTH:
                    continue
                kept.setdefault(component, {})[str(int(str(week)))] = length
        return {
            component: dict(sorted(weeks.items(), key=lambda item: int(item[0]))) for component, weeks in kept.items()
        }
