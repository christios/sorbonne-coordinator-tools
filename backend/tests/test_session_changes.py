"""What happened to one dated class: cancelled, or covered by somebody else."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import portal as api
from sorbonne.main import app
from sorbonne.services.session_changes import ChangeNotFound, NoCoverTeacher, SessionChangeStore
from tests.conftest import TEST_DATABASE_URL

TERM = "262710"
BASE = "/api/v1/portal"


@pytest.fixture
def store() -> SessionChangeStore:
    held = SessionChangeStore(TEST_DATABASE_URL)
    with held.engine.begin() as connection:
        connection.execute(text("DELETE FROM session_changes"))
    return held


@pytest.fixture
def client(store: SessionChangeStore) -> TestClient:
    # The router builds its store from config.database_url — the developer's own database
    # under pytest — so the route under test must be pointed at the test one.
    app.dependency_overrides[api.get_session_changes] = lambda: store
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def slot(**over):
    base = {"term_code": TERM, "crn": "23436", "meets_on": "2026-09-14", "starts_at": "08:15", "ends_at": "10:15"}
    return {**base, **over}


def test_a_slot_carries_one_fact_which_the_next_word_replaces(store: SessionChangeStore):
    first = store.set_change(**slot(), kind="cancelled", author_email="a@x", author_name="A")
    second = store.set_change(
        **slot(), kind="covered", cover_teacher_name="Grace  Younes", author_email="b@x", author_name="B"
    )

    held = store.changes_for(TERM)

    assert len(held) == 1
    assert held[0]["id"] == first["id"] == second["id"]
    assert (held[0]["kind"], held[0]["coverTeacherName"], held[0]["authorName"]) == ("covered", "Grace Younes", "B")
    assert held[0]["createdAt"] <= held[0]["updatedAt"]


def test_a_covered_class_has_to_name_who_covered_it(store: SessionChangeStore):
    with pytest.raises(NoCoverTeacher):
        store.set_change(**slot(), kind="covered", cover_teacher_name="  ")


def test_cancelling_forgets_any_cover_teacher_said_before(store: SessionChangeStore):
    store.set_change(**slot(), kind="covered", cover_teacher_name="Grace Younes", cover_teacher_id="t1")
    saved = store.set_change(**slot(), kind="cancelled")
    assert (saved["coverTeacherName"], saved["coverTeacherId"]) == ("", "")


def test_clearing_a_note_means_the_class_ran_as_planned(store: SessionChangeStore):
    saved = store.set_change(**slot(), kind="cancelled")
    store.clear_change(saved["id"])
    assert store.changes_for(TERM) == []
    with pytest.raises(ChangeNotFound):
        store.clear_change(saved["id"])


def test_notes_are_read_per_term_in_calendar_order(store: SessionChangeStore):
    store.set_change(**slot(meets_on="2026-09-21"), kind="cancelled")
    store.set_change(**slot(meets_on="2026-09-14", crn="24311"), kind="cancelled")
    store.set_change(**slot(term_code="262720"), kind="cancelled")

    assert [(row["meetsOn"], row["crn"]) for row in store.changes_for(TERM)] == [
        ("2026-09-14", "24311"),
        ("2026-09-21", "23436"),
    ]


def test_the_calendar_writes_a_note_signed_by_whoever_is_signed_in(client: TestClient, store: SessionChangeStore):
    saved = client.put(
        f"{BASE}/session-changes",
        json={"termCode": TERM, "crn": "23436", "meetsOn": "2026-09-14", "startsAt": "08:15:00", "endsAt": "10:15:00",
              "kind": "covered", "coverTeacherName": "Sudarshan Shinde", "note": "Grace away"},
    )

    assert saved.status_code == status.HTTP_200_OK, saved.text
    body = saved.json()
    assert (body["startsAt"], body["endsAt"], body["kind"]) == ("08:15", "10:15", "covered")
    assert body["authorEmail"]
    assert client.get(f"{BASE}/session-changes", params={"term": TERM}).json()["changes"][0]["id"] == body["id"]

    refused = client.put(
        f"{BASE}/session-changes",
        json={"termCode": TERM, "crn": "23436", "meetsOn": "2026-09-14", "startsAt": "08:15", "kind": "covered"},
    )
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    assert client.delete(f"{BASE}/session-changes/{body['id']}").status_code == status.HTTP_204_NO_CONTENT
    assert client.delete(f"{BASE}/session-changes/{body['id']}").status_code == status.HTTP_404_NOT_FOUND
