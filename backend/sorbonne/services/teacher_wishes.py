"""Timetable wishes: when each teacher can and can't teach, asked once a semester.

A coordinator opens a semester's collection: a deadline, a message, the week the grid shows,
how many wishes may be a Must (three) and how much can't-teach time a teacher may claim before
having to say why (twelve hours). Each teacher then answers — in the SCEN Requests app, or on
a page here once invited — or a coordinator answers for them after a call or an email.

An answer is a week painted "can't" and "prefer" a quarter of an hour at a time (a cell's
`hour` is where its quarter starts: 14.25 is 14:15-14:30), a few limits on the week,
dates away, room needs and a note. From the painting and the limits come its *wishes*, the
lines a teacher ranks: each block of can't-teach hours (the same hours on several days is
one line), their preferred times as one line, and each limit. Each is a Must or a Would like,
and no more than the collection's quota may be a Must: ranking is choosing, and a list of
nothing but Musts says nothing about which matter.

The Semester plan reads the answers to shade a teacher's week and flag the classes that
break a wish. Nothing here blocks a placement.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.coordinator_directory import name_for

_TERM = re.compile(r"^\d{6}$")
KINDS = ("cant", "prefer")
LEVELS = ("must", "would")
LIMITS = ("maxDays", "maxHoursDay", "maxInRow", "freeDay")
_LIMIT_RANGES = {"maxDays": (1, 6), "maxHoursDay": (1, 12), "maxInRow": (1, 12), "freeDay": (1, 7)}
# Marked week by week, a semester of Tuesday afternoons is fifteen of them.
MOST_AWAY = 80
SUNDAY, MIDNIGHT = 7, 24
MOST_MUSTS, MOST_CANT_HOURS = 10, 60
COMMENT_LENGTH = 300
#: A painted cell is a quarter of an hour.
STEP = 0.25
HOURS_A_DAY = 24


def _clock(hour: float) -> str:
    """14.25 as a wish's key says it: "14.25"; 14.0 as "14", as the page says it."""
    return f"{hour:g}"


class InvalidWishes(ValueError):
    pass


class NoCollection(LookupError):
    pass


class UnknownTeacher(LookupError):
    pass


class ClosedForAnswers(PermissionError):
    """A teacher answering after the deadline, with nobody having reopened it for them."""


#: The deadline is a day in Abu Dhabi: it closes when that day ends there.
ABU_DHABI = timezone(timedelta(hours=4))
#: How an answer came: a coordinator for the teacher, or the teacher through a door of theirs.
COORDINATOR = "coordinator"


def _today() -> str:
    return datetime.now(ABU_DHABI).date().isoformat()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _words(value: object, most: int) -> str:
    return " ".join(str(value or "").split())[:most]


def _term(term_code: str) -> str:
    code = str(term_code or "").strip()
    if not _TERM.match(code):
        raise InvalidWishes("A semester is asked for by its portal term, six digits: 262720.")
    return code


# ---------------------------------------------------------------------- wishes from an answer


def wish_lines(cells: list[dict[str, Any]], limits: dict[str, Any]) -> list[dict[str, Any]]:
    """The wishes an answer makes, in the order a teacher reads them: can't, prefer, limits.

    Can't-teach hours are joined into blocks a day at a time (Tuesday 14:00–18:00), and a block
    of the same hours on several days is one wish (Tuesday and Thursday 14:00–18:00): one thing
    to rank, as it is one thing to the teacher. Preferred hours, however many, are one wish:
    where they would rather teach. The same rule is kept on the page (`wishLines`).
    """
    blocks: dict[tuple[float, float], list[int]] = {}
    by_day: dict[int, list[float]] = {}
    for cell in cells:
        if cell["kind"] == "cant":
            by_day.setdefault(cell["day"], []).append(float(cell["hour"]))
    for day, hours in sorted(by_day.items()):
        run: list[float] = []
        for hour in [*sorted(set(hours)), None]:
            if run and (hour is None or hour != run[-1] + STEP):
                blocks.setdefault((run[0], run[-1] + STEP), []).append(day)
                run = []
            if hour is not None:
                run.append(hour)
    lines = [
        {
            "key": f"cant:{_clock(start)}-{_clock(end)}:{','.join(str(day) for day in days)}",
            "kind": "cant",
            "days": days,
            "from": start,
            "to": end,
        }
        for (start, end), days in sorted(blocks.items(), key=lambda item: (item[1][0], item[0]))
    ]
    if any(cell["kind"] == "prefer" for cell in cells):
        lines.append({"key": "prefer", "kind": "prefer"})
    for name in LIMITS:
        if limits.get(name):
            lines.append({"key": name, "kind": name, "value": limits[name]})
    return lines


# ---------------------------------------------------------------------- reading what was sent


def _collection_input(given: dict[str, Any]) -> dict[str, Any]:
    deadline = str(given.get("deadline") or "").strip()
    if deadline:
        try:
            date.fromisoformat(deadline)
        except ValueError as exc:
            raise InvalidWishes("The deadline is a date: 2027-01-10.") from exc
    days = sorted({int(day) for day in given.get("days") or [1, 2, 3, 4, 5]})
    if not days or any(day < 1 or day > SUNDAY for day in days):
        raise InvalidWishes("The grid's days are 1 (Monday) to 7 (Sunday).")
    first, last = int(given.get("firstHour", 8)), int(given.get("lastHour", 19))
    if not 0 <= first < last <= MIDNIGHT:
        raise InvalidWishes("The grid's hours run from a first hour to a later last hour, within the day.")
    quota, cap = int(given.get("mustQuota", 3)), int(given.get("cantCap", 12))
    if not 0 <= quota <= MOST_MUSTS:
        raise InvalidWishes("Between 0 and 10 preferences can be a Must.")
    if not 0 <= cap <= MOST_CANT_HOURS:
        raise InvalidWishes("The can't-teach cap is between 0 and 60 hours a week.")
    return {
        "deadline": deadline,
        "message": _words(given.get("message"), 2000),
        "days": days,
        "firstHour": first,
        "lastHour": last,
        "mustQuota": quota,
        "cantCap": cap,
    }


def _away(entry: dict[str, Any]) -> dict[str, Any]:
    """A time away: whole days from one date to another, or part of one day, from one quarter
    hour to another (`start` 14, `end` 18 is 14:00-18:00)."""
    try:
        first, last = date.fromisoformat(str(entry.get("from"))), date.fromisoformat(str(entry.get("to")))
    except ValueError as exc:
        raise InvalidWishes("Dates away are dates: 2027-03-15 to 2027-03-19.") from exc
    if last < first:
        raise InvalidWishes("A time away ends on or after the day it starts.")
    kept: dict[str, Any] = {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "reason": _words(entry.get("reason"), 160),
    }
    start, end = entry.get("start"), entry.get("end")
    if start is None and end is None:
        return kept
    try:
        start, end = float(start), float(end)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise InvalidWishes("Part of a day away has a start and an end: 14 to 18.") from exc
    if first != last:
        raise InvalidWishes("Part of a day away is on one day.")
    if not (0 <= start < end <= HOURS_A_DAY) or (start / STEP) % 1 or (end / STEP) % 1:
        raise InvalidWishes("Part of a day away starts and ends on a quarter hour, the end after the start.")
    return {**kept, "start": start, "end": end}


def _answer_input(given: dict[str, Any], collection: dict[str, Any]) -> dict[str, Any]:
    """An answer, checked against its semester's grid, quota and cap."""
    days, first, last = set(collection["days"]), collection["firstHour"], collection["lastHour"]
    cells: dict[tuple[int, float], str] = {}
    for cell in given.get("cells") or []:
        day, hour, kind = int(cell.get("day", 0)), float(cell.get("hour", -1)), str(cell.get("kind", ""))
        if day not in days or not first <= hour < last or kind not in KINDS:
            raise InvalidWishes("A painted hour is outside this semester's grid.")
        if hour / STEP != int(hour / STEP):
            raise InvalidWishes("A painted cell starts on the hour or a quarter past, half past or a quarter to.")
        cells[(day, hour)] = kind
    # On the hour as a whole number, as before quarters: 14, not 14.0.
    painted = [
        {"day": day, "hour": int(hour) if hour.is_integer() else hour, "kind": kind}
        for (day, hour), kind in sorted(cells.items())
    ]

    limits: dict[str, int] = {}
    for name, (low, high) in _LIMIT_RANGES.items():
        value = (given.get("limits") or {}).get(name)
        if value in (None, "", 0):
            continue
        number = int(value)
        if not low <= number <= high:
            raise InvalidWishes(f"That limit is between {low} and {high}.")
        limits[name] = number

    away = [_away(entry) for entry in (given.get("away") or [])[:MOST_AWAY]]

    lines = wish_lines(painted, limits)
    keys = {line["key"] for line in lines}
    levels = {key: level for key, level in (given.get("levels") or {}).items() if key in keys and level in LEVELS}
    # A comment says why a wish matters: kept only for a wish the answer still makes.
    comments = {
        key: said
        for key, value in (given.get("comments") or {}).items()
        if key in keys and (said := _words(value, COMMENT_LENGTH))
    }
    musts = sum(1 for level in levels.values() if level == "must")
    if musts > collection["mustQuota"]:
        quota = collection["mustQuota"]
        raise InvalidWishes(f"At most {quota} preferences can be a Must. Choose which {quota} matter most.")
    cant_hours = sum(STEP for kind in cells.values() if kind == "cant")
    reason = _words(given.get("overCapReason"), 1000)
    status = "submitted" if given.get("submit") else "draft"
    if status == "submitted" and cant_hours > collection["cantCap"] and not reason:
        raise InvalidWishes(
            f"That is {cant_hours:g} hours you can't teach, over the {collection['cantCap']} a week a teacher may "
            "mark. Say why, for the coordinator, or mark fewer."
        )
    return {
        "cells": painted,
        "limits": limits,
        "away": away,
        "needs": _words(given.get("needs"), 1000),
        "note": str(given.get("note") or "").strip()[:2000],
        "levels": levels,
        "comments": comments,
        "overCapReason": reason if cant_hours > collection["cantCap"] else "",
        "status": status,
    }


def _collection(row: Any) -> dict[str, Any]:
    return {
        "termCode": row["term_code"],
        "deadline": row["deadline"],
        "message": row["message"],
        "days": json.loads(row["days"] or "[1, 2, 3, 4, 5]"),
        "firstHour": row["first_hour"],
        "lastHour": row["last_hour"],
        "mustQuota": row["must_quota"],
        "cantCap": row["cant_cap"],
        "openedAt": row["opened_at"],
        "openedBy": name_for(row["opened_by"]) if row["opened_by"] else "",
    }


def _calendar(plan: Any) -> dict[str, Any] | None:
    """A semester's teaching weeks as the plan keeps them: Week 1, how many, breaks and holidays."""
    if not plan or not plan["week_one"]:
        return None
    return {
        "weekOne": plan["week_one"],
        "weeks": plan["weeks"] or 0,
        "without": json.loads(plan["without"] or "[]"),
        "holidays": json.loads(plan["holidays"] or "[]"),
    }


def _invitation(row: Any) -> dict[str, Any]:
    """An invitation as the coordinator sees it: never its link, which only its hash is kept of."""
    return {
        "email": row["email"],
        "createdAt": row["created_at"],
        "createdBy": name_for(row["created_by"]) if row["created_by"] else "",
        "openedAt": row["opened_at"],
        "signedInAt": row["signed_in_at"],
    }


def _answer(row: Any) -> dict[str, Any]:
    cells = json.loads(row["cells"] or "[]")
    limits = json.loads(row["limits"] or "{}")
    levels = json.loads(row["levels"] or "{}")
    comments = json.loads(row["comments"] or "{}")
    return {
        "status": row["status"],
        "cells": cells,
        "limits": limits,
        "away": json.loads(row["away"] or "[]"),
        "needs": row["needs"],
        "note": row["note"],
        "levels": levels,
        "comments": comments,
        "lines": [
            {**line, "level": levels.get(line["key"], "would"), "comment": comments.get(line["key"], "")}
            for line in wish_lines(cells, limits)
        ],
        "overCapReason": row["over_cap_reason"],
        "source": row["source"],
        "submittedAt": row["submitted_at"],
        "updatedAt": row["updated_at"],
        "updatedBy": name_for(row["updated_by"]) if row["updated_by"] else "",
    }


class WishStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------ the semester's call

    def _collection_row(self, connection: Any, term: str) -> Any:
        return (
            connection.execute(text("SELECT * FROM wish_collections WHERE term_code = :term"), {"term": term})
            .mappings()
            .first()
        )

    def open_collection(self, term_code: str, given: dict[str, Any], actor: str = "") -> dict[str, Any]:
        """Open a semester's collection, or change its deadline, message, grid, quota or cap."""
        term = _term(term_code)
        values = _collection_input(given)
        at = _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO wish_collections (term_code, deadline, message, days, first_hour, last_hour,
                            must_quota, cant_cap, opened_at, opened_by, updated_at, updated_by)
                        VALUES (:term, :deadline, :message, :days, :first, :last, :quota, :cap, :at, :by, :at, :by)
                        ON CONFLICT (term_code) DO UPDATE SET deadline = excluded.deadline,
                            message = excluded.message, days = excluded.days, first_hour = excluded.first_hour,
                            last_hour = excluded.last_hour, must_quota = excluded.must_quota,
                            cant_cap = excluded.cant_cap, updated_at = excluded.updated_at,
                            updated_by = excluded.updated_by"""),
                {
                    "term": term,
                    "deadline": values["deadline"],
                    "message": values["message"],
                    "days": json.dumps(values["days"]),
                    "first": values["firstHour"],
                    "last": values["lastHour"],
                    "quota": values["mustQuota"],
                    "cap": values["cantCap"],
                    "at": at,
                    "by": actor,
                },
            )
            return _collection(self._collection_row(connection, term))

    # ------------------------------------------------------------------ when teachers may answer

    def _window(self, connection: Any, term: str, teacher_id: str, collection: dict[str, Any] | None) -> dict[str, Any]:
        """Whether a teacher may answer now: until the deadline, or until a coordinator's
        reopening for them. A collection with no deadline stays open."""
        until = (
            connection.execute(
                text("SELECT until FROM wish_reopenings WHERE term_code = :term AND teacher_id = :id"),
                {"term": term, "id": teacher_id},
            ).scalar()
            or ""
        )
        deadline = collection["deadline"] if collection else ""
        today = _today()
        open_ = bool(collection) and (not deadline or today <= deadline or bool(until and today <= until))
        return {"open": open_, "deadline": deadline, "reopenedUntil": until}

    def window(self, term_code: str, teacher_id: str) -> dict[str, Any]:
        term = _term(term_code)
        with self.engine.connect() as connection:
            row = self._collection_row(connection, term)
            return self._window(connection, term, teacher_id, _collection(row) if row else None)

    def reopen(self, term_code: str, teacher_id: str, until: str, actor: str = "") -> dict[str, Any]:
        """Let one teacher change their answer after the deadline, until a day."""
        term = _term(term_code)
        try:
            date.fromisoformat(until)
        except ValueError as exc:
            raise InvalidWishes("Reopen until a date: 2027-01-17.") from exc
        with self.engine.begin() as connection:
            known = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": teacher_id})
            if known.first() is None:
                raise UnknownTeacher(teacher_id)
            connection.execute(
                text("""INSERT INTO wish_reopenings (term_code, teacher_id, until, reopened_at, reopened_by)
                        VALUES (:term, :id, :until, :at, :by)
                        ON CONFLICT (term_code, teacher_id) DO UPDATE SET until = excluded.until,
                            reopened_at = excluded.reopened_at, reopened_by = excluded.reopened_by"""),
                {"term": term, "id": teacher_id, "until": until, "at": _now(), "by": actor},
            )
            row = self._collection_row(connection, term)
            return self._window(connection, term, teacher_id, _collection(row) if row else None)

    def close_again(self, term_code: str, teacher_id: str) -> None:
        term = _term(term_code)
        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM wish_reopenings WHERE term_code = :term AND teacher_id = :id"),
                {"term": term, "id": teacher_id},
            )

    def previous(self, term_code: str, teacher_id: str) -> dict[str, Any] | None:
        """The teacher's latest answer for another semester, to start this one from: their
        week, limits, ranks, comments, needs and note — not their dates away, which were that
        semester's."""
        term = _term(term_code)
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("""SELECT w.*, coalesce(nullif(p.name, ''), '') AS semester_name
                            FROM teacher_wishes w LEFT JOIN plan_terms p ON p.term_code = w.term_code
                            WHERE w.teacher_id = :id AND w.term_code <> :term
                            ORDER BY w.updated_at DESC LIMIT 1"""),
                    {"term": term, "id": teacher_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        answer = _answer(row)
        return {"termCode": row["term_code"], "semesterName": row["semester_name"], "wishes": {**answer, "away": []}}

    # ------------------------------------------------------------------ the answers

    def semester(self, term_code: str) -> dict[str, Any]:
        """A semester's collection, and every teacher of it with their answer, if any.

        The teachers are those active in the semester, and anybody who has answered for it
        without being active there (yet): nobody who has answered is left off the list.
        """
        term = _term(term_code)
        with self.engine.connect() as connection:
            row = self._collection_row(connection, term)
            teachers = (
                connection.execute(
                    text("""SELECT a.id, a.email,
                               coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), a.email, a.id) AS name
                        FROM active_teachers a LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                        WHERE EXISTS (SELECT 1 FROM active_teacher_terms t
                                      WHERE t.active_id = a.id AND t.term_code = :term)
                           OR EXISTS (SELECT 1 FROM teacher_wishes w
                                      WHERE w.teacher_id = a.id AND w.term_code = :term)
                        ORDER BY 3"""),
                    {"term": term},
                )
                .mappings()
                .all()
            )
            answers = {
                answer["teacher_id"]: answer
                for answer in connection.execute(
                    text("SELECT * FROM teacher_wishes WHERE term_code = :term"), {"term": term}
                ).mappings()
            }
            # The invitation that stands for each teacher: the latest not withdrawn.
            invitations = {
                invitation["teacher_id"]: invitation
                for invitation in connection.execute(
                    text("""SELECT * FROM wish_invitations WHERE term_code = :term AND withdrawn_at = ''
                            ORDER BY created_at"""),
                    {"term": term},
                ).mappings()
            }
            reopened = {
                each["teacher_id"]: each["until"]
                for each in connection.execute(
                    text("SELECT teacher_id, until FROM wish_reopenings WHERE term_code = :term"), {"term": term}
                ).mappings()
            }
            plan = connection.execute(
                text("SELECT week_one, weeks, without, holidays FROM plan_terms WHERE term_code = :term"),
                {"term": term},
            ).mappings().first()
        return {
            "collection": _collection(row) if row else None,
            # The semester's teaching weeks, for marking time away week by week; None until it has them.
            "calendar": _calendar(plan),
            "teachers": [
                {
                    "teacherId": teacher["id"],
                    "name": teacher["name"],
                    "email": teacher["email"] or "",
                    "wishes": _answer(answers[teacher["id"]]) if teacher["id"] in answers else None,
                    "invitation": _invitation(invitations[teacher["id"]]) if teacher["id"] in invitations else None,
                    "reopenedUntil": reopened.get(teacher["id"], ""),
                }
                for teacher in teachers
            ],
        }

    def save(
        self, term_code: str, teacher_id: str, given: dict[str, Any], actor: str = "", source: str = COORDINATOR
    ) -> dict[str, Any]:
        """Keep a teacher's answer for a semester, as a draft or submitted.

        A coordinator may answer for a teacher at any time. A teacher answering for themselves
        (`source` is their door: "invitation", and later "requests") may until the deadline,
        or until the day a coordinator reopened it for them.
        """
        term = _term(term_code)
        with self.engine.begin() as connection:
            row = self._collection_row(connection, term)
            if row is None:
                raise NoCollection(term)
            known = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": teacher_id}).first()
            if known is None:
                raise UnknownTeacher(teacher_id)
            if source != COORDINATOR and not self._window(connection, term, teacher_id, _collection(row))["open"]:
                raise ClosedForAnswers(term)
            values = _answer_input(given, _collection(row))
            previous = connection.execute(
                text("SELECT submitted_at FROM teacher_wishes WHERE term_code = :term AND teacher_id = :id"),
                {"term": term, "id": teacher_id},
            ).scalar()
            at = _now()
            submitted_at = at if values["status"] == "submitted" else (previous or "")
            connection.execute(
                text("""INSERT INTO teacher_wishes (term_code, teacher_id, status, cells, limits, away, needs, note,
                            levels, comments, over_cap_reason, source, submitted_at, updated_at, updated_by)
                        VALUES (:term, :id, :status, :cells, :limits, :away, :needs, :note, :levels, :comments,
                            :reason, :source, :submitted, :at, :by)
                        ON CONFLICT (term_code, teacher_id) DO UPDATE SET status = excluded.status,
                            cells = excluded.cells, limits = excluded.limits, away = excluded.away,
                            needs = excluded.needs, note = excluded.note, levels = excluded.levels,
                            comments = excluded.comments,
                            over_cap_reason = excluded.over_cap_reason, source = excluded.source,
                            submitted_at = excluded.submitted_at, updated_at = excluded.updated_at,
                            updated_by = excluded.updated_by"""),
                {
                    "term": term,
                    "id": teacher_id,
                    "status": values["status"],
                    "cells": json.dumps(values["cells"]),
                    "limits": json.dumps(values["limits"]),
                    "away": json.dumps(values["away"]),
                    "needs": values["needs"],
                    "note": values["note"],
                    "levels": json.dumps(values["levels"]),
                    "comments": json.dumps(values["comments"]),
                    "reason": values["overCapReason"],
                    "source": source,
                    "submitted": submitted_at,
                    "at": at,
                    "by": actor,
                },
            )
            saved = (
                connection.execute(
                    text("SELECT * FROM teacher_wishes WHERE term_code = :term AND teacher_id = :id"),
                    {"term": term, "id": teacher_id},
                )
                .mappings()
                .one()
            )
        return _answer(saved)

    def forget(self, term_code: str, teacher_id: str) -> None:
        """Take a teacher's answer away, as if they had never answered."""
        term = _term(term_code)
        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM teacher_wishes WHERE term_code = :term AND teacher_id = :id"),
                {"term": term, "id": teacher_id},
            )
