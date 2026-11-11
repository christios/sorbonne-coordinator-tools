"""Timetable preferences: when each teacher can and can't teach, asked once a semester.

A coordinator opens a semester's collection: a deadline, a message, the week the grid shows and
how many hours of constraints a teacher may mark in a week before having to say why (twelve).
Each teacher then answers — in the SCEN Requests app, or on a page here once invited — or a
coordinator answers for them after a call or an email.

An answer is a set of *blocks* painted on the week, one week at a time: hours on one or more
days that are a **constraint** (they can't teach then: the plan must keep to it) or a
**preference** (they would like to teach then: the plan tries to). Each block repeats every
week, every week from a given week on, or that one week only — a day away is a constraint for
one week. Where blocks overlap in a week, the one-week block is on top, then the latest-starting
one. Then a few limits on the week, each a constraint or a preference, room needs and a note.

The Semester plan reads the answers to shade a teacher's week and flag the classes that go
against them. Nothing here blocks a placement.
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
#: What a block is: hours a teacher can't teach (the plan must keep to them), or would like to.
KINDS = ("constraint", "preference")
#: How a block repeats: every week, every week from its week on, or its week only.
REPEATS = ("all", "from", "once")
LIMITS = ("maxDays", "maxHoursDay", "maxInRow", "freeDay")
_LIMIT_RANGES = {"maxDays": (1, 6), "maxHoursDay": (1, 12), "maxInRow": (1, 12), "freeDay": (1, 7)}
# A semester of weekly blocks and days away, generously.
MOST_BLOCKS = 400
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


def answer_lines(
    blocks: list[dict[str, Any]], limits: dict[str, Any], kinds: dict[str, str], comments: dict[str, str]
) -> list[dict[str, Any]]:
    """What an answer asks of the plan, one line each: its blocks, then its limits.

    A constraint is held to as a Must, a preference as a Would like: the plan's words for how
    hard a line is. Constraints come first, as a teacher reads them.
    """
    ordered = sorted(blocks, key=lambda block: block["kind"] != "constraint")
    lines = [
        {
            "key": block["id"],
            "kind": block["kind"],
            "days": block["days"],
            "from": block["from"],
            "to": block["to"],
            "repeat": block["repeat"],
            "week": block["week"],
            "level": "must" if block["kind"] == "constraint" else "would",
            "comment": block.get("comment", ""),
        }
        for block in ordered
    ]
    for name in LIMITS:
        if limits.get(name):
            kind = kinds.get(name, "preference")
            lines.append(
                {
                    "key": name,
                    "kind": name,
                    "value": limits[name],
                    "level": "must" if kind == "constraint" else "would",
                    "comment": comments.get(name, ""),
                }
            )
    return lines


def recurring_constraint_hours(blocks: list[dict[str, Any]]) -> float:
    """The hours a week a teacher marks as constraints that repeat: what the cap counts. A week's
    own blocks — a day away — are not counted."""
    quarters = {
        (day, block["from"] + index * STEP)
        for block in blocks
        if block["kind"] == "constraint" and block["repeat"] != "once"
        for day in block["days"]
        for index in range(round((block["to"] - block["from"]) / STEP))
    }
    return len(quarters) * STEP


def _monday(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _from_old(row: Any) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """An answer kept the way it was before blocks (10 Nov 2026): painted quarter hours, dates
    away and Must / Would like, read as blocks and kinds. Never written back this way."""
    cells = json.loads(row["cells"] or "[]")
    levels = json.loads(row["levels"] or "{}")
    comments = json.loads(row["comments"] or "{}")
    blocks: list[dict[str, Any]] = []
    for old_kind, kind in (("cant", "constraint"), ("prefer", "preference")):
        by_day: dict[int, list[float]] = {}
        for cell in cells:
            if cell.get("kind") == old_kind:
                by_day.setdefault(int(cell["day"]), []).append(float(cell["hour"]))
        runs: dict[tuple[float, float], list[int]] = {}
        for day, hours in sorted(by_day.items()):
            run: list[float] = []
            for hour in [*sorted(set(hours)), None]:
                if run and (hour is None or hour != run[-1] + STEP):
                    runs.setdefault((run[0], run[-1] + STEP), []).append(day)
                    run = []
                if hour is not None:
                    run.append(hour)
        for (start, end), days in sorted(runs.items()):
            key = f"cant:{_clock(start)}-{_clock(end)}:{','.join(str(day) for day in days)}"
            said = comments.get(key if old_kind == "cant" else "prefer", "")
            blocks.append(
                {
                    "id": f"old-{len(blocks)}",
                    "kind": kind,
                    "days": days,
                    "from": start,
                    "to": end,
                    "repeat": "all",
                    "week": "",
                    "comment": said,
                }
            )
    for entry in json.loads(row["away"] or "[]"):
        try:
            first, last = date.fromisoformat(entry["from"]), date.fromisoformat(entry["to"])
        except (KeyError, ValueError):
            continue
        weeks: dict[date, list[int]] = {}
        day = first
        while day <= last:
            weeks.setdefault(_monday(day), []).append(day.isoweekday())
            day += timedelta(days=1)
        for monday, days in sorted(weeks.items()):
            blocks.append(
                {
                    "id": f"old-{len(blocks)}",
                    "kind": "constraint",
                    "days": days,
                    "from": float(entry.get("start") if entry.get("start") is not None else 0),
                    "to": float(entry.get("end") if entry.get("end") is not None else HOURS_A_DAY),
                    "repeat": "once",
                    "week": monday.isoformat(),
                    "comment": entry.get("reason", ""),
                }
            )
    kinds = {name: ("constraint" if levels.get(name) == "must" else "preference") for name in LIMITS if name in levels}
    return blocks, kinds


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


def _block(entry: dict[str, Any], index: int, collection: dict[str, Any]) -> dict[str, Any]:
    """A block, checked against the semester's grid: what it is, its days and hours, how it repeats."""
    kind = str(entry.get("kind") or "")
    if kind not in KINDS:
        raise InvalidWishes("A block is a constraint or a preference.")
    try:
        days = sorted({int(day) for day in entry.get("days") or []})
        start, end = float(entry.get("from")), float(entry.get("to"))  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise InvalidWishes("A block has days, and hours from one to another: 14 to 16.") from exc
    if not days or any(day not in collection["days"] for day in days):
        raise InvalidWishes("A block is on the semester's days.")
    # A whole day away reaches past the grid's hours: it is kept to them.
    start, end = max(start, collection["firstHour"]), min(end, collection["lastHour"])
    if not start < end or (start / STEP) % 1 or (end / STEP) % 1:
        raise InvalidWishes("A block starts and ends on a quarter hour, within the grid, its end after its start.")
    repeat = str(entry.get("repeat") or "all")
    if repeat not in REPEATS:
        raise InvalidWishes("A block repeats every week, every week from a week on, or one week only.")
    week = ""
    if repeat != "all":
        try:
            week = date.fromisoformat(str(entry.get("week"))).isoformat()
        except ValueError as exc:
            raise InvalidWishes("A block for some weeks says its week, by its Monday: 2027-01-11.") from exc
        if date.fromisoformat(week).weekday() != 0:
            raise InvalidWishes("A block's week is said by its Monday.")
    ident = _words(entry.get("id"), 40) or f"block-{index}"
    return {
        "id": ident,
        "kind": kind,
        "days": days,
        "from": int(start) if start.is_integer() else start,
        "to": int(end) if end.is_integer() else end,
        "repeat": repeat,
        "week": week,
        "comment": _words(entry.get("comment"), COMMENT_LENGTH),
    }


def _answer_input(given: dict[str, Any], collection: dict[str, Any]) -> dict[str, Any]:
    """An answer, checked against its semester's grid and cap."""
    blocks = [_block(entry, index, collection) for index, entry in enumerate((given.get("blocks") or [])[:MOST_BLOCKS])]
    if len({block["id"] for block in blocks}) != len(blocks):
        raise InvalidWishes("Each block is named once.")

    limits: dict[str, int] = {}
    for name, (low, high) in _LIMIT_RANGES.items():
        value = (given.get("limits") or {}).get(name)
        if value in (None, "", 0):
            continue
        number = int(value)
        if not low <= number <= high:
            raise InvalidWishes(f"That limit is between {low} and {high}.")
        limits[name] = number
    # Each limit set is a constraint or a preference; a preference unless said.
    given_kinds = given.get("limitKinds") or {}
    kinds = {name: ("constraint" if given_kinds.get(name) == "constraint" else "preference") for name in limits}
    comments = {
        name: said
        for name, value in (given.get("comments") or {}).items()
        if name in limits and (said := _words(value, COMMENT_LENGTH))
    }

    hours = recurring_constraint_hours(blocks)
    reason = _words(given.get("overCapReason"), 1000)
    status = "submitted" if given.get("submit") else "draft"
    if status == "submitted" and hours > collection["cantCap"] and not reason:
        raise InvalidWishes(
            f"That is {hours:g} hours a week of constraints, over the {collection['cantCap']} a teacher may mark. "
            "Say why, for the coordinator, or mark fewer."
        )
    # A constraint holds the plan to it: submitted, each says why. A preference may go without.
    unexplained = sum(1 for block in blocks if block["kind"] == "constraint" and not block["comment"]) + sum(
        1 for name in limits if kinds[name] == "constraint" and not comments.get(name)
    )
    if status == "submitted" and unexplained:
        raise InvalidWishes(
            "A constraint needs a reason, for the coordinator: "
            + ("one has none yet." if unexplained == 1 else f"{unexplained} have none yet.")
        )
    return {
        "blocks": blocks,
        "limits": limits,
        "kinds": kinds,
        "needs": _words(given.get("needs"), 1000),
        "note": str(given.get("note") or "").strip()[:2000],
        "comments": comments,
        "overCapReason": reason if hours > collection["cantCap"] else "",
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
    stored = json.loads(row["cells"] or "[]")
    if (stored and "hour" in stored[0]) or json.loads(row["away"] or "[]"):
        blocks, kinds = _from_old(row)
    else:
        blocks, kinds = stored, json.loads(row["levels"] or "{}")
    limits = json.loads(row["limits"] or "{}")
    comments = {name: said for name, said in json.loads(row["comments"] or "{}").items() if name in LIMITS}
    return {
        "status": row["status"],
        "blocks": blocks,
        "limits": limits,
        "limitKinds": kinds,
        "comments": comments,
        "needs": row["needs"],
        "note": row["note"],
        "lines": answer_lines(blocks, limits, kinds, comments),
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
        """The teacher's latest answer for another semester, to start this one from: the blocks
        that repeat every week, limits, needs and note — not the blocks for some weeks, which were
        that semester's."""
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
        # Only what repeats every week carries over: the rest was that semester's own weeks.
        weekly = [block for block in answer["blocks"] if block["repeat"] == "all"]
        return {
            "termCode": row["term_code"],
            "semesterName": row["semester_name"],
            "wishes": {**answer, "blocks": weekly},
        }

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
                    # Blocks are kept where the painted cells were, and each limit's kind where its
                    # Must or Would like was; dates away are blocks now.
                    "cells": json.dumps(values["blocks"]),
                    "limits": json.dumps(values["limits"]),
                    "away": "[]",
                    "needs": values["needs"],
                    "note": values["note"],
                    "levels": json.dumps(values["kinds"]),
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
