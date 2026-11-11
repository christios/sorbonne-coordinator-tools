"""Invitations: a teacher gives their timetable wishes themselves, through a link."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import teacher_wishes as coordinators
from sorbonne.api import wish_invite as door
from sorbonne.main import app
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import SignInRejected
from sorbonne.services.teacher_wishes import WishStore
from sorbonne.services.wish_invitations import INVITEE_COOKIE, InvitationStore, read_invitee_session
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/wishes"
DOOR = "/api/v1/invite/wishes"
TERM = "262720"
GMAIL = "joumana.rifai@gmail.com"


@pytest.fixture
def stores() -> tuple[WishStore, InvitationStore]:
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for table in ("wish_invitations", "wish_reopenings", "teacher_wishes", "wish_collections"):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed names
        connection.execute(text("DELETE FROM active_teachers WHERE id LIKE 'invite-test-%'"))
        for teacher, name, terms in (
            ("invite-test-joumana", "Joumana El Rifai", [TERM, "262710"]),
            ("invite-test-autumn", "Only Autumn", ["262710"]),
        ):
            connection.execute(
                text("INSERT INTO active_teachers (id, full_name, added_at) VALUES (:id, :name, '2026-11-10')"),
                {"id": teacher, "name": name},
            )
            for term in terms:
                connection.execute(
                    text("INSERT INTO active_teacher_terms (active_id, term_code) VALUES (:id, :term)"),
                    {"id": teacher, "term": term},
                )
    return WishStore(engine), InvitationStore(engine)


@pytest.fixture
def client(stores: tuple[WishStore, InvitationStore], monkeypatch: pytest.MonkeyPatch) -> TestClient:
    wishes, invitations = stores
    app.dependency_overrides[coordinators.get_wishes] = lambda: wishes
    app.dependency_overrides[coordinators.get_invitations] = lambda: invitations
    app.dependency_overrides[door.get_wishes] = lambda: wishes
    app.dependency_overrides[door.get_invitations] = lambda: invitations

    # Google, as it would answer for whoever signs in: the address a test says.
    def google(credential: str) -> tuple[str, str]:
        if credential == "not-google":
            raise SignInRejected("That Google sign-in could not be verified.")
        return credential, "Somebody"

    monkeypatch.setattr(door, "verify_google_identity", google)
    try:
        # The invitee's cookie is Secure: it travels over https only, as in production.
        yield TestClient(app, base_url="https://testserver")
    finally:
        for get in (coordinators.get_wishes, coordinators.get_invitations, door.get_wishes, door.get_invitations):
            app.dependency_overrides.pop(get, None)


def collecting(client: TestClient, deadline: str = "2099-01-10") -> None:
    made = client.put(f"{AT}/collection/{TERM}", json={"deadline": deadline, "message": "Tell us by January."})
    assert made.status_code == 200, made.text


def invited(client: TestClient, email: str = GMAIL) -> str:
    made = client.post(f"{AT}/{TERM}/invite-test-joumana/invitation", json={"email": email})
    assert made.status_code == 201, made.text
    return made.json()["code"]


WEEK = [{"id": "tue", "kind": "constraint", "days": [2], "from": 14, "to": 16}]


def test_only_a_teacher_of_the_semester_can_be_invited_and_only_while_collecting(client: TestClient):
    refused = client.post(f"{AT}/{TERM}/invite-test-joumana/invitation", json={"email": GMAIL})
    assert refused.status_code == status.HTTP_409_CONFLICT
    collecting(client)
    autumn = client.post(f"{AT}/{TERM}/invite-test-autumn/invitation", json={"email": "autumn@gmail.com"})
    assert autumn.status_code == status.HTTP_404_NOT_FOUND
    wrong = client.post(f"{AT}/{TERM}/invite-test-joumana/invitation", json={"email": "not an address"})
    assert wrong.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_link_says_what_it_is_for_and_whose_address_to_sign_in_with(client: TestClient):
    collecting(client)
    code = invited(client, " Joumana.Rifai@Gmail.com ")
    seen = client.get(f"{DOOR}/{code}")
    assert seen.status_code == 200, seen.text
    assert {key: value for key, value in seen.json().items() if key != "semesterName"} == {
        "teacherName": "Joumana El Rifai",
        "email": "j************@gmail.com",
        "deadline": "2099-01-10",
        "message": "Tell us by January.",
        "signedIn": False,
    }
    listed = client.get(AT, params={"term": TERM}).json()
    mine = next(row for row in listed["teachers"] if row["teacherId"] == "invite-test-joumana")
    assert mine["invitation"]["email"] == GMAIL
    assert mine["invitation"]["openedAt"]
    # The link is nowhere in what the coordinator's page reads back.
    assert code not in str(listed)


def test_a_link_that_is_not_one_and_a_link_invited_again_are_refused(client: TestClient):
    collecting(client)
    assert client.get(f"{DOOR}/not-a-code").status_code == status.HTTP_401_UNAUTHORIZED
    first = invited(client)
    second = invited(client)
    assert client.get(f"{DOOR}/{first}").status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get(f"{DOOR}/{second}").status_code == 200
    client.delete(f"{AT}/{TERM}/invite-test-joumana/invitation")
    assert client.get(f"{DOOR}/{second}").json()["detail"].startswith("This invitation link is not valid")


def test_only_the_address_invited_signs_in(client: TestClient):
    collecting(client)
    code = invited(client)
    other = client.post(f"{DOOR}/{code}/session", json={"credential": "someone.else@gmail.com"})
    assert other.status_code == status.HTTP_403_FORBIDDEN
    assert "j************@gmail.com" in other.json()["detail"]
    assert client.post(f"{DOOR}/{code}/session", json={"credential": "not-google"}).status_code == 401
    # Without signing in, nothing of the answer is shown or taken.
    assert client.get(f"{DOOR}/{code}/form").status_code == status.HTTP_401_UNAUTHORIZED
    assert client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK}).status_code == status.HTTP_401_UNAUTHORIZED

    signed = client.post(f"{DOOR}/{code}/session", json={"credential": GMAIL})
    assert signed.status_code == 200, signed.text
    assert signed.json()["teacherName"] == "Joumana El Rifai"
    assert signed.json()["window"] == {"open": True, "deadline": "2099-01-10", "reopenedUntil": ""}
    assert read_invitee_session(client.cookies.get(INVITEE_COOKIE))["email"] == GMAIL


def test_the_teacher_answers_for_themself_and_the_coordinator_sees_it(client: TestClient):
    collecting(client)
    code = invited(client)
    client.post(f"{DOOR}/{code}/session", json={"credential": GMAIL})
    saved = client.put(
        f"{DOOR}/{code}/answer", json={"blocks": WEEK, "submit": True}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["wishes"]["status"] == "submitted"
    listed = client.get(AT, params={"term": TERM}).json()
    mine = next(row for row in listed["teachers"] if row["teacherId"] == "invite-test-joumana")
    assert (mine["wishes"]["source"], mine["wishes"]["updatedBy"]) == ("invitation", GMAIL)
    assert mine["invitation"]["signedInAt"]


def test_one_invitation_session_opens_no_other(client: TestClient):
    collecting(client)
    code = invited(client)
    client.post(f"{DOOR}/{code}/session", json={"credential": GMAIL})
    # Invited again: the new link needs signing in again, the old session does not carry over.
    fresh = invited(client)
    assert client.get(f"{DOOR}/{fresh}/form").status_code == status.HTTP_401_UNAUTHORIZED


def test_after_the_deadline_only_a_coordinator_changes_the_answer_unless_reopened(client: TestClient):
    collecting(client, deadline="2020-01-10")
    code = invited(client)
    client.post(f"{DOOR}/{code}/session", json={"credential": GMAIL})
    late = client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK})
    assert late.status_code == status.HTTP_409_CONFLICT
    assert "deadline has passed" in late.json()["detail"]
    # The coordinator may still answer for them.
    assert client.put(f"{AT}/{TERM}/invite-test-joumana", json={"blocks": WEEK}).status_code == 200

    reopened = client.put(f"{AT}/{TERM}/invite-test-joumana/reopen", json={"until": "2099-02-01"})
    assert reopened.json() == {"open": True, "deadline": "2020-01-10", "reopenedUntil": "2099-02-01"}
    assert client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK, "submit": True}).status_code == 200
    client.delete(f"{AT}/{TERM}/invite-test-joumana/reopen")
    assert client.put(f"{DOOR}/{code}/answer", json={"blocks": WEEK}).status_code == status.HTTP_409_CONFLICT


def test_last_semesters_answer_is_offered_to_start_from_with_only_its_weekly_blocks(
    client: TestClient, stores: tuple[WishStore, InvitationStore]
):
    wishes, _ = stores
    with wishes.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO wish_collections (term_code, deadline, opened_at, updated_at)
                    VALUES ('262710', '2026-08-01', '', '')""")
        )
    wishes.save(
        "262710",
        "invite-test-joumana",
        {
            "blocks": [
                *WEEK,
                {"id": "away", "kind": "constraint", "days": [4], "from": 8, "to": 19, "repeat": "once",
                 "week": "2026-09-28"},
            ],
            "note": "Mornings",
        },
    )
    collecting(client)
    code = invited(client)
    form = client.post(f"{DOOR}/{code}/session", json={"credential": GMAIL}).json()
    assert form["wishes"] is None
    assert form["previous"]["termCode"] == "262710"
    assert form["previous"]["wishes"]["note"] == "Mornings"
    # The weekly block carries over; the day away was that semester's.
    assert [block["id"] for block in form["previous"]["wishes"]["blocks"]] == ["tue"]
