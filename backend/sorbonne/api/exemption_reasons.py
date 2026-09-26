"""The reasons a student may not take a course, in Settings.

Anybody signed in may read them — they are what the Exempt button offers. Only an
administrator may change the list, as with the programme codes: they are the words the
whole department filters on.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.exemption_reasons import ExemptionReasons, InvalidReason

router = APIRouter(prefix="/exemption-reasons", tags=["exemption-reasons"])


def get_reasons() -> ExemptionReasons:
    return ExemptionReasons(engine_for(config.database_url))


def _administrator(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can change the reasons a student may not take a course.",
        )
    return str(getattr(staff, "email", "") or "")


class Reason(BaseModel):
    label: str = Field(min_length=1, max_length=120)


@router.get("")
def list_reasons(reasons: ExemptionReasons = Depends(get_reasons)) -> dict[str, Any]:
    return {"reasons": reasons.list()}


@router.post("")
def add_reason(body: Reason, request: Request, reasons: ExemptionReasons = Depends(get_reasons)) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        reasons.add(body.label, actor=actor)
    except InvalidReason as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"reasons": reasons.list()}


@router.delete("/{label}")
def remove_reason(label: str, request: Request, reasons: ExemptionReasons = Depends(get_reasons)) -> dict[str, Any]:
    _administrator(request)
    if not reasons.remove(label):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{label!r} is not on the list.")
    return {"reasons": reasons.list()}
