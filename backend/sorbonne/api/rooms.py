"""The rooms and their seats, kept on the Rooms page.

Read and edited by anybody signed in: how many a room seats is a fact about the building
that whoever is timetabling needs to be able to correct, not a department setting.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.rooms import InvalidRoom, RoomNotFound, RoomStore

router = APIRouter(prefix="/rooms", tags=["rooms"])


def get_rooms() -> RoomStore:
    return RoomStore(engine_for(config.database_url))


def _actor(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    return str(getattr(staff, "email", "") or "")


class RoomInput(BaseModel):
    code: str = Field(min_length=1, max_length=120)
    name: str = Field(default="", max_length=120)
    building: str = Field(default="", max_length=120)
    kind: str = Field(default="", max_length=120)
    seats: int | None = Field(default=None, ge=0, le=2000)
    aliases: list[str] = Field(default_factory=list, max_length=10)


@router.get("")
def list_rooms(rooms: RoomStore = Depends(get_rooms)) -> dict[str, Any]:
    return {"rooms": rooms.list()}


@router.post("", status_code=status.HTTP_201_CREATED)
def add_room(body: RoomInput, request: Request, rooms: RoomStore = Depends(get_rooms)) -> dict[str, Any]:
    try:
        return rooms.add(body.model_dump(), actor=_actor(request))
    except InvalidRoom as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.patch("/{room_id}")
def update_room(
    room_id: str, body: RoomInput, request: Request, rooms: RoomStore = Depends(get_rooms)
) -> dict[str, Any]:
    try:
        return rooms.update(room_id, body.model_dump(), actor=_actor(request))
    except InvalidRoom as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except RoomNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such room.") from exc


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_room(room_id: str, rooms: RoomStore = Depends(get_rooms)) -> None:
    if not rooms.remove(room_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such room.")
