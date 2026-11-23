"""Hour reductions: every full-timer's year, for the Head of Department.

Read by anybody signed in, since what a full-timer still owes is what the timetable is built
around. The teachers' reductions are set by the Head of Department, an admin of Students and
Timetables, or an administrator; the rules they are worked out from by an administrator alone.
A full-timer declares their own research reductions through the preferences invitation
(api/wish_invite).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.account_access import AccountAccess, account_access, administers
from sorbonne.services.department_roles import DepartmentRoles
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions, InvalidReductions, year_of

router = APIRouter(prefix="/hour-reductions", tags=["hour reductions"])


def get_reductions() -> HourReductions:
    return HourReductions(engine_for(config.database_url))


def get_account_access() -> AccountAccess:
    return account_access()


class ItemInput(BaseModel):
    """One kind: how many (students, hours, or 1 for yes), or which (committees, a headship).

    From the Head of Department, a zero is kept as a zero; no amount and nothing chosen puts
    the kind back to not set."""

    amount: float | None = Field(default=0, ge=0, le=1000)
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


def _is_head(request: Request, reductions: HourReductions) -> bool:
    """Whether the person signed in is the Head of Department named in Settings → Department."""
    email = str(getattr(getattr(request.state, "staff_user", None), "email", "") or "").strip().casefold()
    head = DepartmentRoles(reductions.engine).head()["email"].strip().casefold()
    return bool(email) and email == head


def _can_set(request: Request, reductions: HourReductions, access: AccountAccess) -> bool:
    """The department's reductions and the SAFIR validations are the Head of Department's to set,
    an admin of Students and Timetables', and an administrator's.

    Students and Timetables counts because the Head of Department is matched by the address on
    their teacher record, and people sign in with another one: Lama Tarsissi, named Head of
    Department, could not change a figure until she was made an administrator (16 Nov 2026).
    """
    staff = getattr(request.state, "staff_user", None)
    is_admin = bool(getattr(staff, "is_admin", False))
    email = str(getattr(staff, "email", "") or "")
    if is_admin or (email and administers(access.apps_for(email), "database", platform_admin=False)):
        return True
    return _is_head(request, reductions)


def _setter(request: Request, reductions: HourReductions, access: AccountAccess) -> str:
    if not _can_set(request, reductions, access):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=(
                "Only the Head of Department, an admin of Students and Timetables or an administrator "
                "can set hour reductions."
            ),
        )
    return str(getattr(getattr(request.state, "staff_user", None), "email", "") or "")


def _refused(exc: InvalidReductions) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("")
def year(
    request: Request,
    term: str = "",
    year: str = "",
    reductions: HourReductions = Depends(get_reductions),
    access: AccountAccess = Depends(get_account_access),
) -> dict[str, Any]:
    """A year's sheet, named by the year or by any portal term in it."""
    try:
        held = reductions.year(year or year_of(term))
    except InvalidReductions as exc:
        raise _refused(exc) from exc
    staff = getattr(request.state, "staff_user", None)
    return {
        **held,
        # The teachers' reductions: the Head of Department's, an admin of Students and
        # Timetables' and an administrator's to set.
        "canChange": _can_set(request, reductions, access),
        # The rules every reduction is worked out from: an administrator's alone.
        "canChangeRules": bool(getattr(staff, "is_admin", False)),
    }


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
def set_teacher(  # noqa: PLR0913 - the year, the teacher, the figures, two stores, and who is asking
    year: str,
    teacher_id: str,
    body: SheetInput,
    request: Request,
    reductions: HourReductions = Depends(get_reductions),
    access: AccountAccess = Depends(get_account_access),
) -> dict[str, Any]:
    """The Head of Department's word on one teacher's year."""
    actor = _setter(request, reductions, access)
    try:
        return reductions.set_by_department(
            year, teacher_id, {kind: item.given() for kind, item in body.items.items()}, actor
        )
    except InvalidReductions as exc:
        raise _refused(exc) from exc
