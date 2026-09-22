"""The task that asks a contracted teacher for the period's time sheet.

Nobody should have to remember that a period has opened. The department pays part-time
teaching in periods, a sheet is filed against each one, and the chasing of them was a
coordinator's memory and a calendar reminder. So the task is made here instead, one per
teacher per period, and it closes itself the moment a sheet claims that period.

Three decisions are worth writing down, because each of them is a limit somebody will
one day want lifted:

*Who gets one.* Only a teacher holding a requisition for the year now running. A task is
a claim on somebody's time, and asking a person with no contract for a sheet they owe
nobody is worse than not asking at all.

*Which periods.* Those of the current academic year that have already opened. The year
is bounded so that a database seen for the first time does not fill with tasks for
periods nobody was working in, and it runs from August because that is where the
department's first period of the year falls.

*Which day they open on.* A semester sets its own, but a month cannot say which semester
it belongs to — August is nobody's semester and January is two. So where the semesters
that have decided all agree, their day is used, and otherwise the department's usual one
is, because a grid of tasks cannot be in two cycles at once.

It runs when the tasks are read rather than on a clock. There is no scheduler here, and
a task nobody has looked at yet has not been missed; by the time anybody can see the
list, the list is right. Writing the same task twice is impossible because its name is
made of the teacher and the period, so running this often is as cheap as running it once.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, text

from sorbonne.services.engine import engine_for
from sorbonne.services.teacher_store import DEFAULT_PERIOD_OPENS_ON

#: The month the department's academic year — and its first pay period — opens in.
FIRST_MONTH_OF_THE_ACADEMIC_YEAR = 8

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

TASK_RESOURCE_TYPE = "teacher"

#: What every task this makes is named after, so its own can be told from anybody else's.
TASK_PREFIX = "time-sheet"


def academic_year_of(today: date) -> str:
    """"2026-2027" — the year August starts, not the one January is in."""
    first = today.year if today.month >= FIRST_MONTH_OF_THE_ACADEMIC_YEAR else today.year - 1
    return f"{first}-{first + 1}"


def opens_on_across(cycles: Mapping[str, int], default: int = DEFAULT_PERIOD_OPENS_ON) -> int:
    """The day this year's periods open on: the semesters' own where they agree."""
    said = {int(day) for day in cycles.values() if int(day) >= 1}
    return said.pop() if len(said) == 1 else default


def period_starts(academic_year: str, opens_on: int, *, opened_by: date) -> list[date]:
    """Every period of that year which has opened by the given day, oldest first."""
    first = int(academic_year.split("-", maxsplit=1)[0])
    found = []
    for step in range(12):
        month = FIRST_MONTH_OF_THE_ACADEMIC_YEAR + step
        start = date(first + (month - 1) // 12, (month - 1) % 12 + 1, opens_on)
        if start <= opened_by:
            found.append(start)
    return found


def period_end(start: date) -> date:
    """The last day of the period that opened on this one: the day before it recurs."""
    month = start.month + 1
    following = date(start.year + (month - 1) // 12, (month - 1) % 12 + 1, start.day)
    return date.fromordinal(following.toordinal() - 1)


def period_label(start: date) -> str:
    """"15 Aug – 14 Sep 2026", said the way the browser says it."""
    closed = period_end(start)
    opened_on = f"{start.day} {MONTHS[start.month - 1]}"
    closed_on = f"{closed.day} {MONTHS[closed.month - 1]}"
    if start.year == closed.year:
        return f"{opened_on} – {closed_on} {closed.year}"
    return f"{opened_on} {start.year} – {closed_on} {closed.year}"


def task_id_for(teacher_id: str, start: date) -> str:
    """One name per teacher per period, so the same task cannot be written twice."""
    return f"{TASK_PREFIX}:{teacher_id}:{start.isoformat()}"


class TimeSheetTasks:
    """Keeps the time-sheet tasks level with the periods that have opened."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def catch_up(self, *, today: date | None = None) -> dict[str, int]:
        """Make the tasks the opened periods call for, and close the ones now answered."""
        day = today or datetime.now(UTC).date()
        year = academic_year_of(day)
        now = datetime.now(UTC).isoformat()
        made = closed = 0
        with self.engine.begin() as connection:
            contracted = [
                str(row[0])
                for row in connection.execute(
                    text("""SELECT DISTINCT teacher_id FROM teacher_requisitions
                            WHERE academic_year = :year ORDER BY teacher_id"""),
                    {"year": year},
                )
            ]
            if not contracted:
                return {"created": 0, "closed": 0, "periods": 0}
            # Both ways a period can be answered: a link somebody typed in, and a sheet
            # the Part-Time Timesheets app pushed here once it was approved.
            filed = {
                (str(row[0]), str(row[1]))
                for row in connection.execute(
                    text("""SELECT teacher_id, period_start FROM teacher_time_sheets WHERE period_start <> ''
                            UNION
                            SELECT teacher_id, period_start FROM pushed_time_sheets""")
                )
            }
            cycles = {
                str(row[0]): int(row[1])
                for row in connection.execute(text("SELECT term_id, opens_on FROM term_pay_cycles"))
            }
            held = {
                str(row[0]): str(row[1])
                for row in connection.execute(
                    text("SELECT id, status FROM tasks WHERE resource_type = :kind AND id LIKE :like"),
                    {"kind": TASK_RESOURCE_TYPE, "like": f"{TASK_PREFIX}:%"},
                )
            }
            starts = period_starts(year, opens_on_across(cycles), opened_by=day)
            for teacher_id in contracted:
                for start in starts:
                    answered = (teacher_id, start.isoformat()) in filed
                    task_id = task_id_for(teacher_id, start)
                    if task_id not in held:
                        _insert(connection, teacher_id, start, answered=answered, now=now)
                        made += 1
                    elif answered and held[task_id] != "COMPLETED":
                        _close(connection, task_id, now)
                        closed += 1
        return {"created": made, "closed": closed, "periods": len(starts)}


def _insert(connection: Any, teacher_id: str, start: date, *, answered: bool, now: str) -> None:
    connection.execute(
        text("""INSERT INTO tasks (
                    id, resource_type, resource_id, template_item_id, title, description, due_date,
                    status, completed_at, revision, created_at, updated_at
                ) VALUES (
                    :id, :kind, :teacher_id, NULL, :title, :description, :due_date,
                    :status, :completed_at, 1, :now, :now
                )"""),
        {
            "id": task_id_for(teacher_id, start),
            "kind": TASK_RESOURCE_TYPE,
            "teacher_id": teacher_id,
            "title": f"Time sheet: {period_label(start)}",
            "description": "Closes itself when a time sheet is filed against this period.",
            "due_date": period_end(start).isoformat(),
            "status": "COMPLETED" if answered else "NOT_STARTED",
            "completed_at": now if answered else None,
            "now": now,
        },
    )


def _close(connection: Any, task_id: str, now: str) -> None:
    """Closed by the sheet arriving, not by anybody pressing anything."""
    connection.execute(
        text("""UPDATE tasks SET status = 'COMPLETED', completed_at = :now,
                     revision = revision + 1, updated_at = :now
                 WHERE id = :id"""),
        {"id": task_id, "now": now},
    )
    connection.execute(
        text("""INSERT INTO task_activity (id, task_id, kind, occurred_at)
                VALUES (:id, :task_id, 'COMPLETED', :now)"""),
        {"id": str(uuid4()), "task_id": task_id, "now": now},
    )
