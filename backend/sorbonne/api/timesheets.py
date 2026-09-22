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

from fastapi import APIRouter, Body, Depends, HTTPException

from sorbonne.config import config
from sorbonne.services.time_sheet_intake import SCHEMA, TeacherNotKnown, TimeSheetIntake, UnknownSchema


router = APIRouter(prefix="/timesheets", tags=["timesheets"])


def get_intake() -> TimeSheetIntake:
    return TimeSheetIntake(config.database_url)


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
