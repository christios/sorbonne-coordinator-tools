"""Where the Part-Time Timesheets app posts an approved period.

One route, and the answer matters more than usual: the flow that calls it writes our
status back onto the SharePoint item — `Sent` on a 2xx, `Failed` on anything else — so a
refusal here is what a coordinator sees in the app they approved the sheet in. Every
refusal therefore names what is wrong in words that make sense to somebody who has never
seen this code.

The caller is a machine and carries the department's key rather than a sign-in; the gate
in `services/auth_gate.py` checks it before this is reached.
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from sorbonne.config import config
from sorbonne.services.time_sheet_intake import SCHEMA, TeacherNotKnown, TimeSheetIntake, UnknownSchema
from sorbonne.services.timesheet_prefill import PeriodNotKnown, TimesheetPrefill


router = APIRouter(prefix="/timesheets", tags=["timesheets"])


def get_intake() -> TimeSheetIntake:
    return TimeSheetIntake(config.database_url)


def get_prefill() -> TimesheetPrefill:
    return TimesheetPrefill(config.database_url)


@router.get("/prefill")
def prefill(
    period_start: str = Query("", alias="periodStart"),
    email: str = Query(""),
    sessions: TimesheetPrefill = Depends(get_prefill),
) -> dict[str, Any]:
    """One part-timer's scheduled sessions for one pay period, to pre-fill their draft.

    The other direction from the push, and the same kind of caller: the timesheet app's
    flow, once a day per part-timer, with the department's READ key (checked by the gate).
    Its two refusals are ones the flow skips the person on, so each says what it was given.
    """
    try:
        return sessions.sessions(period_start=period_start, email=email)
    except PeriodNotKnown as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{str(exc) or 'An empty periodStart'} does not start a pay period here: "
                "they run from the 15th of one month to the 14th of the next."
            ),
        ) from exc
    except TeacherNotKnown as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Nobody in the part-time teacher database has the address {exc.email or '(none given)'}.",
        ) from exc


@router.get("/submitted")
def list_submitted(intake: TimeSheetIntake = Depends(get_intake)) -> dict[str, Any]:
    """Every approved period the app has pushed. Behind the sign-in, unlike the push."""
    return {"items": intake.everyone()}


@router.post("")
def receive_timesheet(
    body: dict[str, Any] = Body(...), intake: TimeSheetIntake = Depends(get_intake)
) -> dict[str, Any]:
    """Take one approved timesheet, or say plainly why it cannot be taken."""
    try:
        return intake.receive(body)
    except UnknownSchema as exc:
        raise HTTPException(
            status_code=400,
            detail=f"This is not a timesheet this department understands: expected {SCHEMA}, got {exc}.",
        ) from exc
    except TeacherNotKnown as exc:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Nobody in the part-time teacher database has the address {exc.email or '(none given)'}"
                f"{f' ({exc.name})' if exc.name else ''}. Add them, then set this period back to Pending."
            ),
        ) from exc
