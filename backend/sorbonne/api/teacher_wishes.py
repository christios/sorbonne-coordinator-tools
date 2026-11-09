"""Timetable wishes: a semester's collection, and each teacher's answer to it.

Read and edited by anybody signed in, as the plan is: the coordinators open a semester's
collection and answer for a teacher who sent theirs by email. Teachers answering for
themselves (the SCEN Requests app, an invitation) come through their own doors later.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.teacher_wishes import InvalidWishes, NoCollection, UnknownTeacher, WishStore

router = APIRouter(prefix="/wishes", tags=["wishes"])


def get_wishes() -> WishStore:
    return WishStore(engine_for(config.database_url))


def _actor(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    return str(getattr(staff, "email", "") or "")


class CollectionInput(BaseModel):
    deadline: str = Field(default="", max_length=10)
    message: str = Field(default="", max_length=2000)
    days: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5], max_length=7)
    firstHour: int = Field(default=8, ge=0, le=23)
    lastHour: int = Field(default=19, ge=1, le=24)
    mustQuota: int = Field(default=3, ge=0, le=10)
    cantCap: int = Field(default=12, ge=0, le=60)


class Cell(BaseModel):
    day: int = Field(ge=1, le=7)
    hour: int = Field(ge=0, le=23)
    kind: str = Field(max_length=10)


class Away(BaseModel):
    model_config = {"populate_by_name": True}
    start: str = Field(alias="from", max_length=10)
    end: str = Field(alias="to", max_length=10)
    reason: str = Field(default="", max_length=160)


class AnswerInput(BaseModel):
    cells: list[Cell] = Field(default_factory=list, max_length=7 * 24)
    limits: dict[str, int | None] = Field(default_factory=dict)
    away: list[Away] = Field(default_factory=list, max_length=20)
    needs: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=2000)
    levels: dict[str, str] = Field(default_factory=dict)
    overCapReason: str = Field(default="", max_length=1000)
    submit: bool = False


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, InvalidWishes):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    if isinstance(exc, NoCollection):
        return HTTPException(
            status.HTTP_409_CONFLICT, detail="Open this semester's collection of wishes before answering for anybody."
        )
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Not a teacher on Active teachers.")


@router.get("")
def semester(term: str, wishes: WishStore = Depends(get_wishes)) -> dict[str, Any]:
    try:
        return wishes.semester(term)
    except InvalidWishes as exc:
        raise _refused(exc) from exc


@router.put("/collection/{term}")
def open_collection(
    term: str, body: CollectionInput, request: Request, wishes: WishStore = Depends(get_wishes)
) -> dict[str, Any]:
    try:
        return wishes.open_collection(term, body.model_dump(), _actor(request))
    except InvalidWishes as exc:
        raise _refused(exc) from exc


@router.put("/{term}/{teacher_id}")
def save(
    term: str, teacher_id: str, body: AnswerInput, request: Request, wishes: WishStore = Depends(get_wishes)
) -> dict[str, Any]:
    given = body.model_dump()
    given["away"] = [{"from": entry.start, "to": entry.end, "reason": entry.reason} for entry in body.away]
    try:
        return wishes.save(term, teacher_id, given, _actor(request))
    except (InvalidWishes, NoCollection, UnknownTeacher) as exc:
        raise _refused(exc) from exc


@router.delete("/{term}/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
def forget(term: str, teacher_id: str, wishes: WishStore = Depends(get_wishes)) -> None:
    try:
        wishes.forget(term, teacher_id)
    except InvalidWishes as exc:
        raise _refused(exc) from exc
