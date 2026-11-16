"""A period the Part-Time Timesheets app closed with nothing to pay, or reopened.

A coordinator in the app can close a part-timer's draft when there is nothing to pay: no
classes in the period, say. A closed period is never approved, so it never arrives here as a
sheet, and until 16 Nov 2026 it looked exactly like a sheet nobody had filed — the period's
"Time sheet" task stayed open, and the teacher's row said "No sheet filed" for good. Now the
app says so (`timesheet.closure.v1`, its own door so that a server not expecting it refuses it
rather than filing it as an approved sheet), and says so again if the period is reopened.

The push's rules, for the same reasons:

*The period is named by the app.* Its item id is the key, so a closure sent twice is one row.

*The latest word wins*, by when it was said (`at`), not by when it arrived: a "reopened" that
arrives after a later "closed" is taken and ignored.

*A person we cannot place is refused*, matched exactly as a pushed sheet is.

And one of its own: *a sheet beats a closure*. An approved sheet for the same teacher and
period answers the period whatever the app said of a draft, in whichever order they arrive.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import Engine, text

from sorbonne.services.engine import engine_for
from sorbonne.services.time_sheet_intake import TeacherNotKnown, UnknownSchema, teacher_for
from sorbonne.services.time_sheet_tasks import follow_the_closure

#: The only body shape this understands.
CLOSURE_SCHEMA = "timesheet.closure.v1"
STATES = ("closed", "reopened")


class BadClosure(ValueError):
    """A closure that says too little to be filed: the reason is written for the app's log."""


def _instant(value: Any, what: str) -> str:
    """A UTC instant, written one way, so that the latest is also the greatest."""
    written = str(value or "").strip()
    if not written:
        raise BadClosure(f"{what} is missing.")
    try:
        moment = datetime.fromisoformat(written.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BadClosure(f"{what} is not a date and time: {written}.") from exc
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).isoformat(timespec="microseconds")


def _hours(value: Any) -> float | None:
    try:
        return None if value is None or value == "" else float(value)
    except (TypeError, ValueError):
        return None


class TimeSheetClosures:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def receive(self, body: dict[str, Any], *, now: str = "") -> dict[str, Any]:
        """Take the app's latest word on one period. Says what it did, for the flow's log."""
        if str(body.get("schema") or "") != CLOSURE_SCHEMA:
            raise UnknownSchema(str(body.get("schema") or "(none)"))
        period_id = str(body.get("periodId") or "").strip()
        if not period_id:
            raise BadClosure("periodId is missing.")
        period_start = str(body.get("periodStart") or "").strip()
        try:
            period_start = date.fromisoformat(period_start).isoformat()
        except ValueError as exc:
            raise BadClosure(f"periodStart is not a day: {period_start or '(none)'}.") from exc
        state = str(body.get("state") or "").strip().lower()
        if state not in STATES:
            raise BadClosure(f"state must be closed or reopened, not {state or '(none)'}.")
        at = _instant(body.get("at"), "at")
        staff = body.get("staff") or {}
        email = str(staff.get("email") or "").strip()
        name = str(staff.get("name") or "").strip()
        by = body.get("by") or {}
        stamp = now or datetime.now(UTC).isoformat()

        with self.engine.begin() as connection:
            # The app sends no staff number with these; the address is the match, as for a push.
            teacher_id = teacher_for(connection, email=email, number=str(staff.get("staffId") or "").strip())
            if not teacher_id:
                raise TeacherNotKnown(email, name)
            held = connection.execute(
                text("SELECT at FROM time_sheet_closures WHERE period_id = :id"), {"id": period_id}
            ).scalar()
            if held is not None and str(held) > at:
                # Said before what is already here: taken, so the app stops trying, and ignored.
                return {"stored": False, "reason": "older", "teacherId": teacher_id, "periodId": period_id}
            connection.execute(
                text("""INSERT INTO time_sheet_closures (
                            period_id, teacher_id, period_start, period_label, state, reason, hours,
                            by_name, by_email, at, sent_at, staff_name, staff_email, received_at
                        ) VALUES (
                            :period_id, :teacher_id, :period_start, :period_label, :state, :reason, :hours,
                            :by_name, :by_email, :at, :sent_at, :staff_name, :staff_email, :received_at
                        )
                        ON CONFLICT (period_id) DO UPDATE SET
                            teacher_id = excluded.teacher_id, period_start = excluded.period_start,
                            period_label = excluded.period_label, state = excluded.state,
                            reason = excluded.reason, hours = excluded.hours, by_name = excluded.by_name,
                            by_email = excluded.by_email, at = excluded.at, sent_at = excluded.sent_at,
                            staff_name = excluded.staff_name, staff_email = excluded.staff_email,
                            received_at = excluded.received_at"""),
                {
                    "period_id": period_id,
                    "teacher_id": teacher_id,
                    "period_start": period_start,
                    "period_label": str(body.get("periodLabel") or "").strip(),
                    "state": state,
                    # A reopening has no reason: what it reopened from is history.
                    "reason": str(body.get("reason") or "").strip() if state == "closed" else "",
                    "hours": _hours(body.get("hours")),
                    "by_name": str(by.get("name") or "").strip(),
                    "by_email": str(by.get("email") or "").strip(),
                    "at": at,
                    "sent_at": str(body.get("sentAt") or "").strip(),
                    "staff_name": name,
                    "staff_email": email,
                    "received_at": stamp,
                },
            )
            follow_the_closure(connection, teacher_id, period_start, stamp)
        return {"stored": True, "state": state, "teacherId": teacher_id, "periodId": period_id}

    def for_teacher(self, teacher_id: str) -> list[dict[str, Any]]:
        """The app's latest word on each of this teacher's periods, newest period first."""
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT DISTINCT ON (period_start)
                               period_id, period_start, period_label, state, reason, hours,
                               by_name, by_email, at
                        FROM time_sheet_closures WHERE teacher_id = :teacher
                        ORDER BY period_start DESC, at DESC"""),
                {"teacher": teacher_id},
            ).mappings()
            return [
                {
                    "periodId": str(row["period_id"]),
                    "periodStart": str(row["period_start"]),
                    "periodLabel": str(row["period_label"]),
                    "state": str(row["state"]),
                    "reason": str(row["reason"]),
                    "hours": row["hours"],
                    "by": str(row["by_name"] or row["by_email"]),
                    "at": str(row["at"]),
                }
                for row in rows
            ]
