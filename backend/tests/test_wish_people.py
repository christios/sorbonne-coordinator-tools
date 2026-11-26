"""Somebody on neither Active teachers nor the part-time list gives their timetable preferences."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import teacher_wishes as coordinators
from sorbonne.api import wish_invite as door
from sorbonne.main import app
from sorbonne.services.course_plans import CoursePlans
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions
from sorbonne.services.portal_lists import PortalListStore
from sorbonne.services.teacher_wishes import WishStore
from sorbonne.services.wish_invitations import InvitationStore
from sorbonne.services.wish_people import WishPeople
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/wishes"
DOOR = "/api/v1/invite/wishes"
TERM = "262720"
NADIA = "nadia.new@gmail.com"
WEEK = [{"id": "tue", "kind": "constraint", "days": [2], "from": 14, "to": 16, "comment": "School run"}]
OTHER_WEEK = [{"id": "fri", "kind": "constraint", "days": [5], "from": 8, "to": 12, "comment": "Clinic"}]
ADDRESSES = (NADIA, "late.second@gmail.com")


@pytest.fixture
def engine():
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for table in ("wish_invitations", "wish_reopenings", "teacher_wishes", "wish_people", "wish_collections"):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed names
        connection.execute(
            text("DELETE FROM active_teachers WHERE id LIKE 'people-test-%' OR lower(email) = ANY(:emails)"),
            {"emails": list(ADDRESSES)},
        )
        for teacher, name, email, terms in (
            ("people-test-joumana", "Joumana El Rifai", "joumana.rifai@gmail.com", [TERM]),
            ("people-test-autumn", "Only Autumn", "only.autumn@gmail.com", ["262710"]),
            ("people-test-sami", "Sami Active", "sami@psuad.ae", [TERM]),
        ):
            connection.execute(
                text("""INSERT INTO active_teachers (id, full_name, email, added_at)
                        VALUES (:id, :name, :email, '2026-11-10')"""),
                {"id": teacher, "name": name, "email": email},
            )
            for term in terms:
                connection.execute(
                    text("INSERT INTO active_teacher_terms (active_id, term_code) VALUES (:id, :term)"),
                    {"id": teacher, "term": term},
                )
    yield engine
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM active_teachers WHERE id LIKE 'people-test-%' OR lower(email) = ANY(:emails)"),
            {"emails": list(ADDRESSES)},
        )


@pytest.fixture
def client(engine, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    wishes, invitations = WishStore(engine), InvitationStore(engine)
    app.dependency_overrides[coordinators.get_wishes] = lambda: wishes
    app.dependency_overrides[coordinators.get_invitations] = lambda: invitations
    app.dependency_overrides[coordinators.get_people] = lambda: WishPeople(engine)
    app.dependency_overrides[door.get_wishes] = lambda: wishes
    app.dependency_overrides[door.get_invitations] = lambda: invitations
    app.dependency_overrides[door.get_reductions] = lambda: HourReductions(engine)
    app.dependency_overrides[door.get_course_plans] = lambda: CoursePlans(engine)
    monkeypatch.setattr(door, "verify_google_identity", lambda credential: (credential, "Somebody"))
    try:
        yield TestClient(app, base_url="https://testserver")
    finally:
        for get in (
            coordinators.get_wishes,
            coordinators.get_invitations,
            coordinators.get_people,
            door.get_wishes,
            door.get_invitations,
            door.get_reductions,
            door.get_course_plans,
        ):
            app.dependency_overrides.pop(get, None)


def collecting(client: TestClient) -> None:
    made = client.put(f"{AT}/collection/{TERM}", json={"deadline": "2099-01-10", "message": ""})
    assert made.status_code == 200, made.text


def added(client: TestClient, name: str = "  Nadia   New ", email: str = " Nadia.New@Gmail.com ") -> dict:
    made = client.post(f"{AT}/{TERM}/people", json={"name": name, "email": email})
    assert made.status_code == status.HTTP_201_CREATED, made.text
    return made.json()


def rows(client: TestClient) -> dict[str, dict]:
    return {row["teacherId"]: row for row in client.get(AT, params={"term": TERM}).json()["teachers"]}


def test_somebody_on_neither_list_is_added_and_gives_their_preferences_alone(client: TestClient, engine):
    assert client.post(f"{AT}/{TERM}/people", json={"name": "Nadia New", "email": NADIA}).status_code == 409
    collecting(client)
    made = added(client)
    assert (made["name"], made["existing"], made["invitation"]["email"]) == ("Nadia New", False, NADIA)
    nadia = rows(client)[made["teacherId"]]
    assert (nadia["name"], nadia["active"], nadia["added"], nadia["byHand"]) == ("Nadia New", False, True, True)
    sami = rows(client)["people-test-sami"]
    assert (sami["active"], sami["added"], sami["byHand"]) == (True, False, False)

    # Full-time, and leading a course, she would have both steps; not active, she has neither.
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE active_teachers SET staff_status = 'FT' WHERE id = :id"), {"id": made["teacherId"]}
        )
    code = made["code"]
    signed = client.post(f"{DOOR}/{code}/session", json={"credential": NADIA})
    assert signed.status_code == 200, signed.text
    form = signed.json()
    assert (form["teacherName"], form["reductions"], form["coursePlans"]) == ("Nadia New", None, [])
    refused = client.put(f"{DOOR}/{code}/reductions", json={"items": {}, "note": ""})
    assert refused.status_code == status.HTTP_403_FORBIDDEN
    assert client.put(f"{DOOR}/{code}/course-plans", json={"courses": []}).status_code == status.HTTP_403_FORBIDDEN
    saved = client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK, "submit": True})
    assert saved.status_code == 200, saved.text
    assert rows(client)[made["teacherId"]]["wishes"]["status"] == "submitted"

    # By the shared link too: the address set for her opens her form.
    shared = client.post(f"{AT}/collection/{TERM}/share-link").json()["shareCode"]
    assert client.post(f"{DOOR}/{shared}/session", json={"credential": NADIA}).json()["teacherName"] == "Nadia New"

    # Nowhere else is she a teacher: no section, Teacher hours or Teaching loads picks her.
    everyone = PortalListStore(TEST_DATABASE_URL).list_active_teachers()
    assert made["teacherId"] not in {teacher["id"] for teacher in everyone}
    assert "people-test-sami" in {teacher["id"] for teacher in everyone}


def test_an_address_held_already_puts_that_teacher_on_the_list_never_a_second_record(client: TestClient):
    collecting(client)
    autumn = added(client, "Somebody Else", "Only.Autumn@gmail.com")
    assert (autumn["teacherId"], autumn["name"], autumn["existing"]) == ("people-test-autumn", "Only Autumn", True)
    row = rows(client)["people-test-autumn"]
    assert (row["active"], row["added"], row["byHand"]) == (False, True, False)

    for address, name in (("joumana.rifai@gmail.com", "Joumana El Rifai"), ("only.autumn@gmail.com", "Only Autumn")):
        twice = client.post(f"{AT}/{TERM}/people", json={"name": "Anyone", "email": address})
        assert twice.status_code == status.HTTP_409_CONFLICT
        assert twice.json()["detail"].startswith(f"{name} is on this semester's list already")
    added(client)
    assert client.post(f"{AT}/{TERM}/people", json={"name": "Nadia", "email": NADIA}).status_code == 409
    assert client.post(f"{AT}/{TERM}/people", json={"name": "  ", "email": NADIA}).status_code == 422


def test_linked_to_the_active_teacher_the_answer_and_invitation_move_with_them(client: TestClient, engine):
    collecting(client)
    made = added(client)
    code = made["code"]
    client.post(f"{DOOR}/{code}/session", json={"credential": NADIA})
    assert client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK, "submit": True}).status_code == 200

    def link(to: str, keep: str = ""):
        return client.post(f"{AT}/{TERM}/people/{made['teacherId']}/link", json={"to": to, "keep": keep})

    assert link("people-test-autumn").status_code == status.HTTP_422_UNPROCESSABLE_CONTENT  # not active here
    joumana = client.post(f"{AT}/{TERM}/people/people-test-joumana/link", json={"to": "people-test-sami"})
    assert joumana.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT  # no record made by hand

    # Both answered: nothing moves until somebody says whose answer to keep.
    assert client.put(f"{AT}/{TERM}/people-test-sami", json={"blocks": OTHER_WEEK}).status_code == 200
    clash = link("people-test-sami")
    assert clash.status_code == status.HTTP_409_CONFLICT
    assert "choose whose to keep" in clash.json()["detail"]
    linked = link("people-test-sami", keep="person")
    assert linked.status_code == 200, linked.text
    assert linked.json() == {"name": "Sami Active"}

    listed = rows(client)
    assert made["teacherId"] not in listed
    sami = listed["people-test-sami"]
    assert ([block["id"] for block in sami["wishes"]["blocks"]], sami["wishes"]["updatedBy"]) == (["tue"], NADIA)
    assert sami["invitation"]["email"] == NADIA
    with engine.connect() as connection:
        gone = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": made["teacherId"]})
        assert gone.first() is None
    # Her link still opens her form, now Sami's.
    assert client.get(f"{DOOR}/{code}/form").json()["teacherName"] == "Sami Active"


def test_somebody_added_is_taken_off_the_list_with_their_answer(client: TestClient, engine):
    collecting(client)
    made = added(client)
    assert client.put(f"{AT}/{TERM}/{made['teacherId']}", json={"blocks": WEEK}).status_code == 200
    assert client.delete(f"{AT}/{TERM}/people/people-test-joumana").status_code == 422  # active: off Active teachers
    assert client.delete(f"{AT}/{TERM}/people/{made['teacherId']}").status_code == status.HTTP_204_NO_CONTENT
    assert made["teacherId"] not in rows(client)
    assert client.get(f"{DOOR}/{made['code']}").status_code == status.HTTP_401_UNAUTHORIZED
    with engine.connect() as connection:
        gone = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": made["teacherId"]})
        assert gone.first() is None

    # Somebody the department holds stays held: only this semester's list lets go of them.
    added(client, "Only Autumn", "only.autumn@gmail.com")
    assert client.delete(f"{AT}/{TERM}/people/people-test-autumn").status_code == status.HTTP_204_NO_CONTENT
    assert "people-test-autumn" not in rows(client)
    with engine.connect() as connection:
        kept = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = 'people-test-autumn'"))
        assert kept.first() is not None
