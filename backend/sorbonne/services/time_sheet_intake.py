"""Receiving an approved timesheet from the Part-Time Timesheets app.

The app is somebody else's: a Power App over SharePoint, where part-time staff enter the
days they worked and a coordinator approves them. When a period is approved, a flow posts
it here, reads our answer, and writes the result back onto the SharePoint item — `Sent`
when we take it, `Failed` when we do not. That answer is the only thing the flow can tell
anybody, so it is written to be read by a person looking at a list of periods.

Three rules, and each of them is about a push arriving twice or arriving wrong:

*The period is named by the app, not by us.* The SharePoint item id is the key, so a
retry after a failure writes the same row again rather than a second sheet.

*The newest version wins.* A period corrected and re-approved arrives with a higher
version. An older one arriving late — a retry that overtook its own correction — is taken
and ignored, because refusing it would leave the app marking a corrected period Failed.

*A person we cannot place is refused.* The address the app holds is matched against the
part-time database, and a sheet for somebody nobody knows is not stored half-attached:
the flow marks it Failed and whoever approved it sees that where they approved it.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, text

from sorbonne.services.engine import engine_for

#: The only body shape this understands. The app sends its name so a later one can differ.
SCHEMA = "timesheet.period.v1"


class UnknownSchema(Exception):
    """A body from something other than the timesheet app, or a newer one."""


class TeacherNotKnown(Exception):
    """Nobody in the part-time database matches the person the sheet is for."""

    def __init__(self, email: str, name: str) -> None:
        super().__init__(email or name)
        self.email = email
        self.name = name


class TimeSheetIntake:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def receive(self, body: dict[str, Any], *, now: str = "") -> dict[str, Any]:
        """Take one approved period. Says what it did, in the words the flow's log keeps."""
        if str(body.get("schema") or "") != SCHEMA:
            raise UnknownSchema(str(body.get("schema") or "(none)"))
        staff = body.get("staff") or {}
        email = str(staff.get("email") or "").strip()
        number = str(staff.get("staffId") or "").strip()
        name = str(staff.get("name") or "").strip()
        period_id = str(body.get("periodId") or "").strip()
        version = int(body.get("version") or 1)
        stamp = now or datetime.now(UTC).isoformat()

        with self.engine.begin() as connection:
            teacher_id = _teacher_for(connection, email=email, number=number)
            if not teacher_id:
                raise TeacherNotKnown(email, name)
            held = connection.execute(
                text("SELECT version FROM pushed_time_sheets WHERE period_id = :id"), {"id": period_id}
            ).scalar()
            if held is not None and int(held) > version:
                # A retry that overtook its own correction. Taken, so the app stops
                # trying, but the correction is not undone.
                return {"stored": False, "reason": "older", "teacherId": teacher_id, "periodId": period_id}
            connection.execute(
                text("""INSERT INTO pushed_time_sheets (
                            period_id, version, teacher_id, period_start, period_end, period_label,
                            staff_name, staff_number, staff_email, department, position,
                            claimed_hours, approved_by, approved_by_email, approved_on,
                            days, sent_at, received_at
                        ) VALUES (
                            :period_id, :version, :teacher_id, :period_start, :period_end, :period_label,
                            :staff_name, :staff_number, :staff_email, :department, :position,
                            :claimed_hours, :approved_by, :approved_by_email, :approved_on,
                            CAST(:days AS JSONB), :sent_at, :received_at
                        )
                        ON CONFLICT (period_id) DO UPDATE SET
                            version = excluded.version, teacher_id = excluded.teacher_id,
                            period_start = excluded.period_start, period_end = excluded.period_end,
                            period_label = excluded.period_label, staff_name = excluded.staff_name,
                            staff_number = excluded.staff_number, staff_email = excluded.staff_email,
                            department = excluded.department, position = excluded.position,
                            claimed_hours = excluded.claimed_hours, approved_by = excluded.approved_by,
                            approved_by_email = excluded.approved_by_email, approved_on = excluded.approved_on,
                            days = excluded.days, sent_at = excluded.sent_at,
                            received_at = excluded.received_at"""),
                {
                    "period_id": period_id,
                    "version": version,
                    "teacher_id": teacher_id,
                    "period_start": _day(body.get("periodStart")),
                    "period_end": _day(body.get("periodEnd")),
                    "period_label": str(body.get("periodLabel") or "").strip(),
                    "staff_name": name,
                    "staff_number": number,
                    "staff_email": email,
                    "department": str(staff.get("department") or "").strip(),
                    "position": str(staff.get("position") or "").strip(),
                    "claimed_hours": _hours((body.get("totals") or {}).get("hours")),
                    "approved_by": str((body.get("approval") or {}).get("approvedBy") or "").strip(),
                    "approved_by_email": str((body.get("approval") or {}).get("approvedByEmail") or "").strip(),
                    "approved_on": str((body.get("approval") or {}).get("approvedOn") or "").strip(),
                    "days": json.dumps(_days(body.get("days"))),
                    "sent_at": str(body.get("sentAt") or "").strip(),
                    "received_at": stamp,
                },
            )
        return {
            "stored": True,
            "reason": "replaced" if held is not None else "new",
            "teacherId": teacher_id,
            "periodId": period_id,
        }

    def for_teacher(self, teacher_id: str) -> list[dict[str, Any]]:
        """Every period this teacher has had approved, newest first."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"""SELECT {_COLUMNS} FROM pushed_time_sheets
                             WHERE teacher_id = :t ORDER BY period_start DESC"""),
                    {"t": teacher_id},
                )
                .mappings()
                .all()
            )
        return [_sheet(row) for row in rows]

    def filed_periods(self) -> set[tuple[str, str]]:
        """Teacher and period for every approved sheet, for the task that asks for one."""
        with self.engine.connect() as connection:
            return {
                (str(row[0]), str(row[1]))
                for row in connection.execute(text("SELECT teacher_id, period_start FROM pushed_time_sheets"))
            }


_COLUMNS = """period_id, version, teacher_id, period_start, period_end, period_label,
              staff_name, staff_number, staff_email, department, position, claimed_hours,
              approved_by, approved_by_email, approved_on, days, sent_at, received_at"""


def _teacher_for(connection: Any, *, email: str, number: str) -> str:
    """Three ways to the same person, in order of how much the answer can be trusted.

    The address first, because SharePoint takes it from the tenant's own directory and
    nobody typed it. It is looked for on the part-time record and then on the Active
    teachers row, which carries what the registrar holds: on the real data only seven of
    twenty-five part-time teachers have an address of their own, and twenty-three have one
    through the portal. Looking in one place only would have refused most of the
    department.

    The staff number last. It is typed into the timesheet app by hand, so it is the one
    that can be wrong.
    """
    if email:
        found = connection.execute(
            text("SELECT id FROM part_time_teachers WHERE lower(email) = :e LIMIT 1"),
            {"e": email.casefold()},
        ).scalar()
        if found:
            return str(found)
        found = connection.execute(
            text("""SELECT t.id FROM part_time_teachers t
                    JOIN active_teachers a ON a.part_time_teacher_id = t.id
                    WHERE lower(a.email) = :e LIMIT 1"""),
            {"e": email.casefold()},
        ).scalar()
        if found:
            return str(found)
    if number:
        found = connection.execute(
            text("""SELECT t.id FROM part_time_teachers t
                    JOIN active_teachers a ON a.part_time_teacher_id = t.id
                    WHERE upper(a.portal_teacher_id) = :n LIMIT 1"""),
            {"n": number.upper()},
        ).scalar()
        if found:
            return str(found)
    return ""


def _day(value: Any) -> str:
    """A date as the flow formats it. Anything else is kept as text rather than guessed at."""
    return str(value or "").strip()[:10]


def _hours(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _days(value: Any) -> list[dict[str, Any]]:
    """The lines as sent, with only the fields the contract names."""
    if not isinstance(value, list):
        return []
    kept = []
    for line in value:
        if not isinstance(line, dict):
            continue
        kept.append(
            {
                "day": str(line.get("day") or ""),
                "date": _day(line.get("date")),
                "from": str(line.get("from") or ""),
                "to": str(line.get("to") or ""),
                "hours": _hours(line.get("hours")),
                "details": str(line.get("details") or ""),
            }
        )
    return kept


def _sheet(row: Any) -> dict[str, Any]:
    return {
        "periodId": row["period_id"],
        "version": row["version"],
        "teacherId": row["teacher_id"],
        "periodStart": row["period_start"],
        "periodEnd": row["period_end"],
        "periodLabel": row["period_label"],
        "staff": {
            "name": row["staff_name"],
            "staffId": row["staff_number"],
            "email": row["staff_email"],
            "department": row["department"],
            "position": row["position"],
        },
        "claimedHours": row["claimed_hours"],
        "approvedBy": row["approved_by"],
        "approvedByEmail": row["approved_by_email"],
        "approvedOn": row["approved_on"],
        "days": row["days"] or [],
        "sentAt": row["sent_at"],
        "receivedAt": row["received_at"],
    }
