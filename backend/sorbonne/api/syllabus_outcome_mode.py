"""Who writes the course learning outcomes: read by every syllabus, set by the builder's keeper."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from sorbonne.api.syllabus_catalogues import require_curator
from sorbonne.config import config
from sorbonne.services import coordinator_directory
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_outcome_mode import SyllabusOutcomeMode, UnknownOutcomeMode

router = APIRouter(prefix="/syllabus-outcome-mode", tags=["syllabi"])


def get_outcome_mode() -> SyllabusOutcomeMode:
    return SyllabusOutcomeMode(engine_for(config.database_url))


class OutcomeModeInput(BaseModel):
    mode: str


def _named(mode: dict[str, Any]) -> dict[str, Any]:
    email = mode["updatedBy"]
    return {**mode, "updatedByName": coordinator_directory.name_for(email, "") if email else ""}


@router.get("")
def read_outcome_mode(store: SyllabusOutcomeMode = Depends(get_outcome_mode)) -> dict[str, Any]:
    return _named(store.read())


@router.put("")
def set_outcome_mode(
    body: OutcomeModeInput,
    user: StaffUser = Depends(require_curator),
    store: SyllabusOutcomeMode = Depends(get_outcome_mode),
) -> dict[str, Any]:
    try:
        return _named(store.set(body.mode, actor=user.email))
    except UnknownOutcomeMode as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
