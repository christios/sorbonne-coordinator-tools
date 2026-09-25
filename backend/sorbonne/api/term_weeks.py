"""Each semester's Week 1, in Settings.

Read by anybody, since every coordinator's timetable counts from it; set by an
administrator, since it changes the week numbers everybody sees.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.term_weeks import InvalidWeekOne, TermWeeks

router = APIRouter(prefix="/term-weeks", tags=["term-weeks"])


def get_weeks() -> TermWeeks:
    return TermWeeks(engine_for(config.database_url))


class WeekOne(BaseModel):
    # Any day of the first teaching week, ISO; blank to take it away.
    weekOne: str = Field(default="", max_length=10)


@router.get("")
def list_weeks(weeks: TermWeeks = Depends(get_weeks)) -> dict[str, Any]:
    return {"weeks": weeks.all()}


@router.put("/{term_id}")
def set_week_one(
    term_id: str, body: WeekOne, request: Request, weeks: TermWeeks = Depends(get_weeks)
) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can set where a semester's weeks start.",
        )
    try:
        weeks.set(term_id, body.weekOne, actor=str(getattr(staff, "email", "") or ""))
    except InvalidWeekOne as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"weeks": weeks.all()}
