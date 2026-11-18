"""Course plans: each course's hours, its lead and its weeks, semester by semester.

Read and edited by anybody signed in, as Active courses and the preferences are: coordinators
set a course's CM, TD and TP hours and pick its lead, and lay the weeks out for a lead who sent
them by email. The lead lays them out through their preferences invitation (api/wish_invite).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.course_plans import COORDINATOR, CoursePlans, InvalidCoursePlan, UnknownCourse
from sorbonne.services.engine import engine_for

router = APIRouter(prefix="/course-plans", tags=["course plans"])


def get_plans() -> CoursePlans:
    return CoursePlans(engine_for(config.database_url))


def _actor(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    return str(getattr(staff, "email", "") or "")


class ComponentInput(BaseModel):
    """A component's hours in the semester (per group for TD and TP), and one session's length.

    Read loosely and checked by the store, which says in words what is wrong."""

    hours: float | str | None = None
    length: float | str | None = None


class PlanChange(BaseModel):
    """What a coordinator changes: the hours of some components, the lead, or both."""

    hours: dict[str, ComponentInput] | None = Field(default=None, max_length=3)
    leadId: str | None = Field(default=None, max_length=80)


class LayoutInput(BaseModel):
    """Sessions per teaching week, by component: {"TD": {"2": 1, "3": 1}}, and the lead's note."""

    weeks: dict[str, dict[str, int]] = Field(default_factory=dict, max_length=3)
    note: str | None = Field(default=None, max_length=2000)


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, UnknownCourse):
        return HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"{exc.args[0]} is not active in this semester. Add it on Courses first.",
        )
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/{term_code}")
def semester(term_code: str, plans: CoursePlans = Depends(get_plans)) -> dict[str, Any]:
    """Every course active in the semester with its plan, and the semester's teaching weeks."""
    try:
        return plans.semester(term_code)
    except InvalidCoursePlan as exc:
        raise _refused(exc) from exc


@router.patch("/{term_code}/{course_code}")
def change(
    term_code: str, course_code: str, body: PlanChange, request: Request, plans: CoursePlans = Depends(get_plans)
) -> dict[str, Any]:
    """A course's hours, its lead, or both."""
    actor = _actor(request)
    try:
        held = plans.course(term_code, course_code) if body.hours is None and body.leadId is None else None
        if body.hours is not None:
            held = plans.set_hours(
                term_code,
                course_code,
                {component: entry.model_dump() for component, entry in body.hours.items()},
                actor=actor,
            )
        if body.leadId is not None:
            held = plans.set_lead(term_code, course_code, body.leadId, actor=actor)
    except (InvalidCoursePlan, UnknownCourse) as exc:
        raise _refused(exc) from exc
    return held or {}


@router.put("/{term_code}/{course_code}/weeks")
def lay_out(
    term_code: str, course_code: str, body: LayoutInput, request: Request, plans: CoursePlans = Depends(get_plans)
) -> dict[str, Any]:
    """The weeks laid out by a coordinator, for the lead."""
    try:
        return plans.lay_out(term_code, course_code, body.weeks, body.note, actor=_actor(request), source=COORDINATOR)
    except (InvalidCoursePlan, UnknownCourse) as exc:
        raise _refused(exc) from exc
