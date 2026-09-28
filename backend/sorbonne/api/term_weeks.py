"""Each semester's Week 1, and the weeks it has no classes in, in Settings.

Read by anybody, since every coordinator's timetable counts from them; set by an
administrator, since they change the week numbers everybody sees.
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


class WeeksWithout(BaseModel):
    # Any day of each week without classes, ISO.
    weeks: list[str] = Field(default_factory=list, max_length=30)


def _everything(weeks: TermWeeks) -> dict[str, Any]:
    return {"weeks": weeks.all(), "without": weeks.without()}


def _administrator(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can set where a semester's weeks start.",
        )
    return str(getattr(staff, "email", "") or "")


@router.get("")
def list_weeks(weeks: TermWeeks = Depends(get_weeks)) -> dict[str, Any]:
    return _everything(weeks)


@router.put("/{term_id}")
def set_week_one(
    term_id: str, body: WeekOne, request: Request, weeks: TermWeeks = Depends(get_weeks)
) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        weeks.set(term_id, body.weekOne, actor=actor)
    except InvalidWeekOne as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _everything(weeks)


@router.put("/{term_id}/without")
def set_weeks_without(
    term_id: str, body: WeeksWithout, request: Request, weeks: TermWeeks = Depends(get_weeks)
) -> dict[str, Any]:
    """The weeks a semester has no classes in, which its week numbers skip."""
    actor = _administrator(request)
    try:
        weeks.set_without(term_id, body.weeks, actor=actor)
    except InvalidWeekOne as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _everything(weeks)
