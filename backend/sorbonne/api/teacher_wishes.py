"""Timetable wishes: a semester's collection, and each teacher's answer to it.

Read and edited by anybody signed in, as the plan is: the coordinators open a semester's
collection and answer for a teacher who sent theirs by email, invite a teacher to answer
for themselves, and reopen one teacher's answer after the deadline. The invited teacher
comes in through a door of their own (api/wish_invite); the SCEN Requests app will too.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.teacher_wishes import InvalidWishes, NoCollection, UnknownTeacher, WishStore
from sorbonne.services.wish_invitations import InvitationStore

router = APIRouter(prefix="/wishes", tags=["wishes"])


def get_wishes() -> WishStore:
    return WishStore(engine_for(config.database_url))


def get_invitations() -> InvitationStore:
    return InvitationStore(engine_for(config.database_url))


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


class Block(BaseModel):
    """Hours on one or more days, a constraint or a preference, repeating every week, every week
    from `week` (a Monday) on, or in `week` only."""

    model_config = {"populate_by_name": True}
    id: str = Field(default="", max_length=40)
    kind: str = Field(max_length=12)
    days: list[int] = Field(min_length=1, max_length=7)
    start: float = Field(alias="from", ge=0, le=24)
    end: float = Field(alias="to", ge=0, le=24)
    repeat: str = Field(default="all", max_length=4)
    week: str = Field(default="", max_length=10)
    comment: str = Field(default="", max_length=300)

    def given(self) -> dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "days": self.days,
            "from": self.start,
            "to": self.end,
            "repeat": self.repeat,
            "week": self.week,
            "comment": self.comment,
        }


class AnswerInput(BaseModel):
    blocks: list[Block] = Field(default_factory=list, max_length=400)
    limits: dict[str, int | None] = Field(default_factory=dict)
    limitKinds: dict[str, str] = Field(default_factory=dict)
    needs: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=2000)
    comments: dict[str, str] = Field(default_factory=dict)
    overCapReason: str = Field(default="", max_length=1000)
    submit: bool = False

    def given(self) -> dict[str, object]:
        given = self.model_dump()
        given["blocks"] = [block.given() for block in self.blocks]
        return given


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, InvalidWishes):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    if isinstance(exc, NoCollection):
        return HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Open this semester's collection of preferences before answering for anybody.",
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
    given = body.given()
    try:
        return wishes.save(term, teacher_id, given, _actor(request))
    except (InvalidWishes, NoCollection, UnknownTeacher) as exc:
        raise _refused(exc) from exc


class InvitationInput(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ReopenInput(BaseModel):
    until: str = Field(min_length=10, max_length=10)


@router.post("/{term}/{teacher_id}/invitation", status_code=status.HTTP_201_CREATED)
def invite(
    term: str,
    teacher_id: str,
    body: InvitationInput,
    request: Request,
    invitations: InvitationStore = Depends(get_invitations),
) -> dict[str, Any]:
    """Invite a teacher to give their wishes themselves. The link's code is in this answer and
    nowhere else: the page puts it in the email at once. Inviting again withdraws the old link."""
    try:
        code, record = invitations.invite(term, teacher_id, body.email, _actor(request))
    except (InvalidWishes, NoCollection, UnknownTeacher) as exc:
        if isinstance(exc, UnknownTeacher):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Only a teacher on this semester's Active teachers can be invited."
            ) from exc
        raise _refused(exc) from exc
    return {"code": code, "invitation": record}


@router.delete("/{term}/{teacher_id}/invitation", status_code=status.HTTP_204_NO_CONTENT)
def withdraw(term: str, teacher_id: str, invitations: InvitationStore = Depends(get_invitations)) -> None:
    try:
        invitations.withdraw(term, teacher_id)
    except InvalidWishes as exc:
        raise _refused(exc) from exc


@router.put("/{term}/{teacher_id}/reopen")
def reopen(
    term: str, teacher_id: str, body: ReopenInput, request: Request, wishes: WishStore = Depends(get_wishes)
) -> dict[str, Any]:
    """Let one teacher change their answer after the deadline, until a day."""
    try:
        return wishes.reopen(term, teacher_id, body.until, _actor(request))
    except (InvalidWishes, UnknownTeacher) as exc:
        raise _refused(exc) from exc


@router.delete("/{term}/{teacher_id}/reopen", status_code=status.HTTP_204_NO_CONTENT)
def close_again(term: str, teacher_id: str, wishes: WishStore = Depends(get_wishes)) -> None:
    try:
        wishes.close_again(term, teacher_id)
    except InvalidWishes as exc:
        raise _refused(exc) from exc


@router.delete("/{term}/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
def forget(term: str, teacher_id: str, wishes: WishStore = Depends(get_wishes)) -> None:
    try:
        wishes.forget(term, teacher_id)
    except InvalidWishes as exc:
        raise _refused(exc) from exc
