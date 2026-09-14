"""Who sees whose syllabus, through the API rather than the rule on its own."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.staff_auth import StaffUser


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)

AUTHOR = StaffUser(email="professor@sorbonne.ae", name="A Professor")
OTHER = StaffUser(email="another@sorbonne.ae", name="Another Professor")
ADMIN = StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=True)


@pytest.fixture(autouse=True)
def clear_syllabi():
    yield
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_field_history"))
        connection.execute(text("DELETE FROM syllabi"))


@pytest.fixture
def as_user(monkeypatch):
    """A client signed in as somebody.

    The identity travels on the request rather than in a patched global, because a test that
    signs two people in needs both clients to keep working — patching a global would make the
    first client quietly become the second person.
    """
    people = {user.email: user for user in (AUTHOR, OTHER, ADMIN)}

    def whoever_is_calling(_cookie, authorization, **_kwargs):
        return people.get((authorization or "").removeprefix("Bearer ").strip())

    monkeypatch.setattr(auth_gate, "user_for_request", whoever_is_calling)

    def sign_in(user: StaffUser) -> TestClient:
        return TestClient(app, headers={"Authorization": f"Bearer {user.email}"})

    return sign_in


def write_syllabus(client: TestClient, title: str = "Geometric optics") -> dict:
    response = client.post(
        "/api/v1/syllabi",
        json={"courseTitle": title, "courseCode": "PHYS-118", "academicYear": "2026-2027"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def sees(client: TestClient, syllabus_id: str) -> bool:
    """Whether this syllabus is in the library as this person sees it.

    Asked about the one syllabus rather than about the whole list, because the database
    carries whatever else the suite has left in it.
    """
    return any(item["id"] == syllabus_id for item in client.get("/api/v1/syllabi").json()["items"])


def test_a_new_syllabus_belongs_to_whoever_wrote_it_and_starts_private(as_user) -> None:
    created = write_syllabus(as_user(AUTHOR))

    assert created["ownerEmail"] == AUTHOR.email
    assert created["visibility"] == "private"


def test_another_professor_neither_sees_a_draft_nor_can_open_it(as_user) -> None:
    created = write_syllabus(as_user(AUTHOR))

    other = as_user(OTHER)
    assert not sees(other, created["id"])
    # Reported as missing, not as forbidden: which drafts exist is itself private.
    assert other.get(f"/api/v1/syllabi/{created['id']}").status_code == 404


def test_an_administrator_cannot_read_a_draft_that_was_never_submitted(as_user) -> None:
    created = write_syllabus(as_user(AUTHOR))

    admin = as_user(ADMIN)
    assert not sees(admin, created["id"])
    assert admin.get(f"/api/v1/syllabi/{created['id']}").status_code == 404


def test_submitting_for_review_opens_it_to_an_administrator_and_to_nobody_else(as_user) -> None:
    author = as_user(AUTHOR)
    created = write_syllabus(author)

    assert author.patch(f"/api/v1/syllabi/{created['id']}/review", json={"submitted": True}).status_code == 200

    assert sees(as_user(ADMIN), created["id"])
    assert not sees(as_user(OTHER), created["id"])


def test_only_its_author_may_put_a_syllabus_up_for_review(as_user) -> None:
    created = write_syllabus(as_user(AUTHOR))
    as_user(AUTHOR).patch(f"/api/v1/syllabi/{created['id']}/review", json={"submitted": True})

    refused = as_user(ADMIN).patch(f"/api/v1/syllabi/{created['id']}/review", json={"submitted": False})

    assert refused.status_code == 403


def test_publishing_shows_it_to_everybody_and_taking_it_back_withdraws_the_review(as_user) -> None:
    author = as_user(AUTHOR)
    created = write_syllabus(author)
    author.patch(f"/api/v1/syllabi/{created['id']}/review", json={"submitted": True})

    published = author.patch(f"/api/v1/syllabi/{created['id']}/visibility", json={"visibility": "public"})
    assert published.json()["visibility"] == "public"
    assert sees(as_user(OTHER), created["id"])

    withdrawn = author.patch(f"/api/v1/syllabi/{created['id']}/visibility", json={"visibility": "private"})
    assert withdrawn.json()["submittedAt"] is None
    assert not sees(as_user(ADMIN), created["id"])


def test_a_professor_cannot_write_to_somebody_elses_public_syllabus(as_user) -> None:
    author = as_user(AUTHOR)
    created = write_syllabus(author)
    author.patch(f"/api/v1/syllabi/{created['id']}/visibility", json={"visibility": "public"})

    refused = as_user(OTHER).patch(
        f"/api/v1/syllabi/{created['id']}",
        json={"expectedRevision": created["revision"], "content": {}, "courseTitle": "Mine now"},
    )

    assert refused.status_code == 403


def test_a_professor_may_read_the_catalogue_and_may_not_rewrite_it(as_user) -> None:
    member = as_user(AUTHOR)

    assert member.get("/api/v1/syllabus-catalogues/assessment-types").status_code == 200
    refused = member.post("/api/v1/syllabus-catalogues/assessment-types", json={"label": "Invented", "payload": {}})
    assert refused.status_code == 403
