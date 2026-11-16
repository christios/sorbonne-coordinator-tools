"""Hour reductions: every full-timer's year, for the Head of Department.

Read by anybody signed in, since what a full-timer still owes is what the timetable is built
around; changed by an administrator only, as the Head of Department's word is. A full-timer
declares their own research reductions through the preferences invitation (api/wish_invite).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions, InvalidReductions, year_of

router = APIRouter(prefix="/hour-reductions", tags=["hour reductions"])


def get_reductions() -> HourReductions:
    return HourReductions(engine_for(config.database_url))


class ItemInput(BaseModel):
    """One kind: how many (students, hours, or 1 for yes), or which (committees, a headship)."""

    amount: float = Field(default=0, ge=0, le=1000)
    detail: str | list[str] = Field(default="")
    validated: bool = False

    def given(self) -> dict[str, Any]:
        return {"amount": self.amount, "detail": self.detail, "validated": self.validated}


class SheetInput(BaseModel):
    items: dict[str, ItemInput] = Field(default_factory=dict, max_length=30)


class RulesInput(BaseModel):
    service: int | None = Field(default=None, ge=1, le=500)
    rules: dict[str, dict[str, Any]] = Field(default_factory=dict, max_length=30)


def _admin(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only an administrator can change hour reductions.")
    return str(getattr(staff, "email", "") or "")


def _refused(exc: InvalidReductions) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("")
def year(
    request: Request, term: str = "", year: str = "", reductions: HourReductions = Depends(get_reductions)
) -> dict[str, Any]:
    """A year's sheet, named by the year or by any portal term in it."""
    try:
        held = reductions.year(year or year_of(term))
    except InvalidReductions as exc:
        raise _refused(exc) from exc
    staff = getattr(request.state, "staff_user", None)
    return {**held, "canChange": bool(getattr(staff, "is_admin", False))}


@router.get("/rules")
def rules(reductions: HourReductions = Depends(get_reductions)) -> dict[str, Any]:
    return reductions.rules()


@router.put("/rules")
def set_rules(
    body: RulesInput, request: Request, reductions: HourReductions = Depends(get_reductions)
) -> dict[str, Any]:
    actor = _admin(request)
    try:
        return reductions.set_rules(body.model_dump(), actor)
    except InvalidReductions as exc:
        raise _refused(exc) from exc


@router.put("/{year}/{teacher_id}")
def set_teacher(
    year: str, teacher_id: str, body: SheetInput, request: Request, reductions: HourReductions = Depends(get_reductions)
) -> dict[str, Any]:
    """The Head of Department's word on one teacher's year."""
    actor = _admin(request)
    try:
        return reductions.set_by_department(
            year, teacher_id, {kind: item.given() for kind, item in body.items.items()}, actor
        )
    except InvalidReductions as exc:
        raise _refused(exc) from exc
