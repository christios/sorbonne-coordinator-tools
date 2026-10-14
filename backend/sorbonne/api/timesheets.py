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
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services import coordinator_directory
from sorbonne.services.engine import engine_for
from sorbonne.services.pay_rates import with_pay
from sorbonne.services.time_sheet_tasks import TimeSheetTasks
from sorbonne.services.time_sheet_intake import SCHEMA, TeacherNotKnown, TimeSheetIntake, UnknownSchema
from sorbonne.services.time_sheet_workbooks import SheetNotFound, TimeSheetWorkbooks, Workbook
from sorbonne.services.timesheet_prefill import PeriodNotKnown, TimesheetPrefill


router = APIRouter(prefix="/timesheets", tags=["timesheets"])


def get_intake() -> TimeSheetIntake:
    return TimeSheetIntake(config.database_url)


def get_prefill() -> TimesheetPrefill:
    return TimesheetPrefill(config.database_url)


def get_workbooks() -> TimeSheetWorkbooks:
    return TimeSheetWorkbooks(engine_for(config.database_url))


class WorkbooksInput(BaseModel):
    periodIds: list[str] = Field(min_length=1, max_length=300)


def _download(book: Workbook) -> Response:
    """The file, named for a person reading a Downloads folder, and how many lines it could not place."""
    ascii_name = book.filename.encode("ascii", "replace").decode().replace("?", "_")
    return Response(
        content=book.data,
        media_type=book.media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(book.filename)}',
            "X-Lines-Not-Placed": str(book.unplaced),
        },
    )


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
    """Every approved period the app has pushed, with what each sheet is paid at. Behind the sign-in."""
    return {"items": with_pay(intake.engine, intake.everyone())}


@router.get("/submitted/{period_id}/workbook")
def one_workbook(period_id: str, workbooks: TimeSheetWorkbooks = Depends(get_workbooks)) -> Response:
    """One approved period as the university's Part Time Sheet — or a zip of them, one per rate."""
    try:
        return _download(workbooks.workbook(period_id))
    except SheetNotFound as exc:
        raise HTTPException(status_code=404, detail="That time sheet is not here any more.") from exc


@router.post("/workbooks")
def many_workbooks(body: WorkbooksInput, workbooks: TimeSheetWorkbooks = Depends(get_workbooks)) -> Response:
    """Several approved periods, a Part Time Sheet each, in one zip."""
    try:
        return _download(workbooks.bundle(body.periodIds))
    except SheetNotFound as exc:
        raise HTTPException(status_code=404, detail="None of those time sheets is here any more.") from exc


def get_tasks() -> TimeSheetTasks:
    return TimeSheetTasks(config.database_url)


@router.post("/submitted-to-hr")
def mark_submitted_to_hr(
    body: WorkbooksInput, request: Request, tasks: TimeSheetTasks = Depends(get_tasks)
) -> dict[str, Any]:
    """Tick the "Submitted to HR" task of each of these sheets — the download pop-up's one click."""
    staff = getattr(request.state, "staff_user", None)
    email = str(getattr(staff, "email", "") or "")
    by = coordinator_directory.name_for(email, str(getattr(staff, "name", "") or "")) if email else ""
    return {"marked": tasks.mark_submitted_to_hr(body.periodIds, by=by)}


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
