"""How far apart a sync asks the registrar's timetable about two sections.

Read by every page that drives a sync; set by any coordinator, from the Portal sync pop-up.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from sorbonne.config import config
from sorbonne.services import coordinator_directory
from sorbonne.services.engine import engine_for
from sorbonne.services.portal_pace import InvalidPace, PortalPace

router = APIRouter(prefix="/portal-pace", tags=["portal"])


def get_pace() -> PortalPace:
    return PortalPace(engine_for(config.database_url))


class PaceInput(BaseModel):
    secondsApart: int


def _named(pace: dict[str, Any]) -> dict[str, Any]:
    """Who set it, by the name Settings gives them — the address is what was stored."""
    email = pace["updatedBy"]
    return {**pace, "updatedByName": coordinator_directory.name_for(email, "") if email else ""}


@router.get("")
def read_pace(pace: PortalPace = Depends(get_pace)) -> dict[str, Any]:
    return _named(pace.read())


@router.put("")
def set_pace(body: PaceInput, request: Request, pace: PortalPace = Depends(get_pace)) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    try:
        return _named(pace.set(body.secondsApart, actor=getattr(staff, "email", "") or ""))
    except InvalidPace as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
