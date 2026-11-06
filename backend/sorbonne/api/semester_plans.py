"""The semester plans: classes placed on a calendar before the registrar books them.

Read and edited by anybody signed in. The coordinators and the Head of Department plan a
semester together, with no approval step between them (decided 5 November 2026); what stops
two of them undoing each other is the revision every change names.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.semester_plans import InvalidPlan, PlanConflict, PlanNotFound, PlanStore

router = APIRouter(prefix="/plans", tags=["plans"])


def get_plans() -> PlanStore:
    return PlanStore(engine_for(config.database_url))


def _actor(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    return str(getattr(staff, "email", "") or "")


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, InvalidPlan):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    if isinstance(exc, PlanConflict):
        who = exc.by or "Somebody"
        return HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"{who} changed this class since you opened it. Look at it again before changing it.",
        )
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Not in this plan.")


class PlanInput(BaseModel):
    termCode: str = Field(min_length=6, max_length=6)
    name: str = Field(default="", max_length=160)


class Holiday(BaseModel):
    date: str = Field(max_length=10)
    label: str = Field(default="", max_length=160)


class SettingsInput(BaseModel):
    name: str = Field(default="", max_length=160)
    weekOne: str = Field(default="", max_length=10)
    weeks: int = Field(default=0, ge=0, le=30)
    without: list[str] = Field(default_factory=list, max_length=30)
    holidays: list[Holiday] = Field(default_factory=list, max_length=60)


class SeriesInput(BaseModel):
    sectionId: str = Field(min_length=1, max_length=60)
    weekday: int = Field(ge=1, le=7)
    startsAt: str = Field(max_length=5)
    endsAt: str = Field(max_length=5)
    room: str = Field(default="", max_length=160)
    teacherName: str = Field(default="", max_length=160)
    weeks: list[int] = Field(min_length=1, max_length=30)
    note: str = Field(default="", max_length=160)


class SeriesChanges(BaseModel):
    weekday: int | None = Field(default=None, ge=1, le=7)
    startsAt: str | None = Field(default=None, max_length=5)
    endsAt: str | None = Field(default=None, max_length=5)
    room: str | None = Field(default=None, max_length=160)
    teacherName: str | None = Field(default=None, max_length=160)
    weeks: list[int] | None = Field(default=None, min_length=1, max_length=30)
    note: str | None = Field(default=None, max_length=160)


class ChangeInput(BaseModel):
    scope: Literal["one", "following", "all"]
    # The teaching week of the class that was opened; not needed for the whole series.
    week: int | None = Field(default=None, ge=1, le=30)
    revision: int = Field(ge=1)
    changes: SeriesChanges


@router.get("")
def list_plans(plans: PlanStore = Depends(get_plans)) -> dict[str, Any]:
    return {"plans": plans.plans()}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_plan(body: PlanInput, request: Request, plans: PlanStore = Depends(get_plans)) -> dict[str, Any]:
    try:
        return plans.create(body.termCode, body.name, actor=_actor(request))
    except InvalidPlan as exc:
        raise _refused(exc) from exc


@router.get("/{term_code}")
def read_plan(term_code: str, plans: PlanStore = Depends(get_plans)) -> dict[str, Any]:
    try:
        return plans.plan(term_code)
    except PlanNotFound as exc:
        raise _refused(exc) from exc


@router.delete("/{term_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(term_code: str, plans: PlanStore = Depends(get_plans)) -> None:
    """The semester and the classes placed in it; refused while a cohort has sets or students in it."""
    try:
        plans.delete(term_code)
    except (InvalidPlan, PlanNotFound) as exc:
        raise _refused(exc) from exc


@router.put("/{term_code}/settings")
def settle_plan(
    term_code: str, body: SettingsInput, request: Request, plans: PlanStore = Depends(get_plans)
) -> dict[str, Any]:
    try:
        return plans.settle(term_code, body.model_dump(), actor=_actor(request))
    except (InvalidPlan, PlanNotFound) as exc:
        raise _refused(exc) from exc


# The classes themselves are Groups & CRNs': added, changed and removed there. All the plan
# takes off is one that is no longer there, once nobody needs its placements.
@router.delete("/{term_code}/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_section(term_code: str, section_id: str, plans: PlanStore = Depends(get_plans)) -> None:
    try:
        plans.remove_section(term_code, section_id)
    except (InvalidPlan, PlanNotFound) as exc:
        raise _refused(exc) from exc


@router.post("/{term_code}/series", status_code=status.HTTP_201_CREATED)
def place_class(
    term_code: str, body: SeriesInput, request: Request, plans: PlanStore = Depends(get_plans)
) -> dict[str, Any]:
    try:
        return plans.place(term_code, body.model_dump(), actor=_actor(request))
    except (InvalidPlan, PlanNotFound) as exc:
        raise _refused(exc) from exc


@router.patch("/{term_code}/series/{series_id}")
def change_class(
    term_code: str, series_id: str, body: ChangeInput, request: Request, plans: PlanStore = Depends(get_plans)
) -> dict[str, Any]:
    try:
        return plans.change(
            term_code,
            series_id,
            scope=body.scope,
            week=body.week,
            changes=body.changes.model_dump(exclude_none=True),
            revision=body.revision,
            actor=_actor(request),
        )
    except (InvalidPlan, PlanConflict, PlanNotFound) as exc:
        raise _refused(exc) from exc


@router.delete("/{term_code}/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_class(  # noqa: PLR0913 - which class, which part of the series, its revision, and who is asking
    term_code: str,
    series_id: str,
    request: Request,
    scope: Literal["one", "following", "all"],
    revision: int,
    week: int | None = None,
    plans: PlanStore = Depends(get_plans),
) -> None:
    try:
        plans.remove(term_code, series_id, scope=scope, week=week, revision=revision, actor=_actor(request))
    except (InvalidPlan, PlanConflict, PlanNotFound) as exc:
        raise _refused(exc) from exc
