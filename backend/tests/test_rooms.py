"""The rooms and their seats, kept on the Rooms page."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import rooms as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.rooms import RoomStore
from sorbonne.services.staff_auth import StaffUser
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/rooms"


@pytest.fixture
def rooms() -> RoomStore:
    store = RoomStore(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM rooms"))
    return store


@pytest.fixture
def client(rooms: RoomStore) -> TestClient:
    app.dependency_overrides[api.get_rooms] = lambda: rooms
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_rooms, None)


def test_a_room_is_kept_with_its_seats_and_the_other_names_the_portal_uses(client: TestClient):
    made = client.post(
        AT,
        json={
            "code": " Roberto  Sorbonne ",
            "name": "Roberto Sorbonne (01.G0.13)",
            "building": "B-1, GF",
            "kind": "Amphi Theatre",
            "seats": 154,
            "aliases": ["B4.Robert", "b4.robert", " "],
        },
    )
    assert made.status_code == status.HTTP_201_CREATED, made.text
    room = made.json()
    # Spacing evened out, and the same other name twice is one.
    assert room["code"] == "Roberto Sorbonne"
    assert room["aliases"] == ["B4.Robert"]
    assert room["seats"] == 154

    changed = client.patch(f"{AT}/{room['id']}", json={**room, "seats": 150, "aliases": ["B4.Robert"]})
    assert changed.json()["seats"] == 150
    assert [entry["code"] for entry in client.get(AT).json()["rooms"]] == ["Roberto Sorbonne"]


def test_a_room_with_no_figure_is_not_a_room_with_no_seats(client: TestClient):
    room = client.post(AT, json={"code": "5.032", "kind": "Chemistry Lab"}).json()
    assert room["seats"] is None


def test_the_same_code_twice_is_refused_whatever_its_case(client: TestClient):
    assert client.post(AT, json={"code": "4.021", "seats": 24}).status_code == status.HTTP_201_CREATED
    assert client.post(AT, json={"code": "4.021"}).status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    other = client.post(AT, json={"code": "4.024", "seats": 36}).json()
    renamed = client.patch(f"{AT}/{other['id']}", json={"code": "4.021", "seats": 36})
    assert renamed.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "on the list already" in renamed.json()["detail"]


def test_seats_are_a_count_of_people(client: TestClient):
    assert client.post(AT, json={"code": "5.111", "seats": -1}).status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert client.post(AT, json={"code": "5.111", "seats": 5000}).status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_room_can_be_taken_off_the_list(client: TestClient):
    room = client.post(AT, json={"code": "3.024", "seats": 20}).json()
    assert client.delete(f"{AT}/{room['id']}").status_code == status.HTTP_204_NO_CONTENT
    assert client.delete(f"{AT}/{room['id']}").status_code == status.HTTP_404_NOT_FOUND
    assert client.patch(f"{AT}/{room['id']}", json={"code": "3.024"}).status_code == status.HTTP_404_NOT_FOUND


def test_any_coordinator_keeps_the_rooms_not_only_an_administrator(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )
    made = client.post(AT, json={"code": "5.112", "seats": 24})
    assert made.status_code == status.HTTP_201_CREATED
    assert made.json()["updatedBy"] == "coordinator@sorbonne.ae"
