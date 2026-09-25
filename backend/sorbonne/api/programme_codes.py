"""Programme codes the department treats as one, in Settings.

Anybody signed in may read the list — a coordinator placing students needs to know why a
MATS student lands on a MATH row. Only an administrator may change it: it changes who can
be placed where, and which classes can clash, for the whole department at once.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.programme_codes import InvalidProgrammeCode, ProgrammeCodes

router = APIRouter(prefix="/programme-codes", tags=["programme-codes"])


def get_codes() -> ProgrammeCodes:
    return ProgrammeCodes(engine_for(config.database_url))


def _administrator(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can change which programme codes are the same.",
        )
    return str(getattr(staff, "email", "") or "")


class SameAs(BaseModel):
    sameAs: str = Field(min_length=1, max_length=40)


@router.get("")
def list_codes(codes: ProgrammeCodes = Depends(get_codes)) -> dict[str, Any]:
    return {"codes": codes.list()}


@router.put("/{code}")
def set_code(code: str, body: SameAs, request: Request, codes: ProgrammeCodes = Depends(get_codes)) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        codes.set(code, body.sameAs, actor=actor)
    except InvalidProgrammeCode as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"codes": codes.list()}


@router.delete("/{code}")
def remove_code(code: str, request: Request, codes: ProgrammeCodes = Depends(get_codes)) -> dict[str, Any]:
    _administrator(request)
    if not codes.remove(code):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{code} is not on the list.")
    return {"codes": codes.list()}
