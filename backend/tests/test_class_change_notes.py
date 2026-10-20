"""Linking a class the registrar removed to the one that replaced it, and noting either."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import portal as api
from sorbonne.main import app
from sorbonne.services.class_change_notes import AnnotationRefused, ClassChangeNotes
from sorbonne.services.facility_timetable import FacilityTimetableStore
from tests.conftest import TEST_DATABASE_URL

TERM = "262710"
TUESDAY = ("2026-11-03", "08:30", "10:00")
THURSDAY = ("2026-11-05", "13:15", "14:45")
FRIDAY = ("2026-11-06", "08:30", "10:00")


def slot(cls: tuple[str, str, str]) -> dict[str, str]:
    return {"meetsOn": cls[0], "startsAt": cls[1], "endsAt": cls[2]}


@pytest.fixture
def store() -> FacilityTimetableStore:
    held = FacilityTimetableStore(TEST_DATABASE_URL)
    with held.engine.begin() as connection:
        for table in (
            "class_change_links",
            "class_change_notes",
            "facility_meeting_changes",
            "facility_meetings",
            "facility_sections",
            "facility_pulls",
        ):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608
    return held


def sweep(store: FacilityTimetableStore, meetings: list[tuple[str, str, str]], *, at: str) -> None:
    store.record_pull(
        term_code=TERM,
        asked=["24007"],
        sections=[
            {
                "crn": "24007",
                "courseCode": "SCEN-102",
                "title": "Maths Readiness",
                "teacherName": "Ahmed Menaa",
                "ours": True,
                "meetings": [{"meetsOn": d, "startsAt": s, "endsAt": e, "room": "4.024"} for d, s, e in meetings],
            }
        ],
        silent=[],
        failed=[],
        complete=True,
        now=at,
    )


@pytest.fixture
def moved(store: FacilityTimetableStore) -> ClassChangeNotes:
    """The registrar took Tuesday's class away and put one on Thursday."""
    sweep(store, [TUESDAY, FRIDAY], at="2026-10-20T06:00:00+00:00")
    sweep(store, [THURSDAY, FRIDAY], at="2026-10-21T06:00:00+00:00")
    return ClassChangeNotes(store.engine, store)


def test_a_class_that_went_is_linked_to_the_one_it_was_rescheduled_into(moved: ClassChangeNotes):
    link = moved.link(TERM, "24007", slot(TUESDAY), slot(THURSDAY), note="Room clash", author_name="Patricia")

    assert (link["from"], link["to"], link["note"], link["byName"]) == (
        slot(TUESDAY), slot(THURSDAY), "Room clash", "Patricia",
    )
    [held] = moved.for_term(TERM)["links"]
    assert held["matches"] is True
    assert moved.rescheduled_into(TERM) == {("24007", *THURSDAY): slot(TUESDAY)}


def test_only_a_class_the_section_lost_and_one_it_gained_can_be_linked(moved: ClassChangeNotes):
    with pytest.raises(AnnotationRefused, match="lost"):
        moved.link(TERM, "24007", slot(FRIDAY), slot(THURSDAY))
    with pytest.raises(AnnotationRefused, match="gained"):
        moved.link(TERM, "24007", slot(TUESDAY), slot(FRIDAY))
    with pytest.raises(AnnotationRefused, match="not changed"):
        moved.link(TERM, "99999", slot(TUESDAY), slot(THURSDAY))


def test_linking_a_class_again_replaces_its_old_link(moved: ClassChangeNotes, store: FacilityTimetableStore):
    """A class is rescheduled into one class, not two."""
    sweep(store, [THURSDAY, ("2026-11-10", "08:30", "10:00")], at="2026-10-22T06:00:00+00:00")
    first = moved.link(TERM, "24007", slot(TUESDAY), slot(THURSDAY))
    moved.link(TERM, "24007", slot(TUESDAY), slot(("2026-11-10", "08:30", "10:00")))

    links = moved.for_term(TERM)["links"]
    assert [link["to"] for link in links] == [slot(("2026-11-10", "08:30", "10:00"))]
    assert not moved.unlink(first["id"])


def test_a_link_the_registrar_undoes_is_kept_and_said_not_to_match(
    moved: ClassChangeNotes, store: FacilityTimetableStore
):
    moved.link(TERM, "24007", slot(TUESDAY), slot(THURSDAY))

    # Tuesday is back: the section has lost nothing, and the link no longer describes it.
    sweep(store, [TUESDAY, THURSDAY, FRIDAY], at="2026-10-22T06:00:00+00:00")

    [link] = moved.for_term(TERM)["links"]
    assert link["matches"] is False


def test_a_note_is_kept_on_either_side_and_taken_away_when_emptied(moved: ClassChangeNotes):
    moved.note(TERM, "24007", "removed", slot(TUESDAY), "Teacher off sick", author_name="Patricia")
    moved.note(TERM, "24007", "added", slot(THURSDAY), "Extra session before the exam")
    moved.note(TERM, "24007", "removed", slot(TUESDAY), "Teacher off sick, confirmed")

    notes = moved.for_term(TERM)["notes"]
    assert [(note["side"], note["note"], note["matches"]) for note in notes] == [
        ("removed", "Teacher off sick, confirmed", True),
        ("added", "Extra session before the exam", True),
    ]
    assert moved.note(TERM, "24007", "removed", slot(TUESDAY), "  ") is None
    assert [note["side"] for note in moved.for_term(TERM)["notes"]] == ["added"]


def test_the_pages_link_and_note_signed_by_whoever_is_signed_in(moved: ClassChangeNotes):
    app.dependency_overrides[api.get_class_notes] = lambda: moved
    try:
        client = TestClient(app)
        made = client.put(
            f"/api/v1/portal/facility-timetable/{TERM}/class-links",
            json={"crn": "24007", "gone": slot(TUESDAY), "arrived": slot(THURSDAY), "note": "Room clash"},
        )
        assert made.status_code == 200, made.text
        refused = client.put(
            f"/api/v1/portal/facility-timetable/{TERM}/class-links",
            json={"crn": "24007", "gone": slot(FRIDAY), "arrived": slot(THURSDAY)},
        )
        assert refused.status_code == 422
        noted = client.put(
            f"/api/v1/portal/facility-timetable/{TERM}/class-notes",
            json={"crn": "24007", "side": "added", "cls": slot(THURSDAY), "note": "Moved by the registrar"},
        )
        assert noted.status_code == 200, noted.text
        read = client.get(f"/api/v1/portal/facility-timetable/{TERM}/class-notes").json()
        assert [link["note"] for link in read["links"]] == ["Room clash"]
        assert read["links"][0]["byEmail"]
        assert [note["note"] for note in read["notes"]] == ["Moved by the registrar"]
        assert client.delete(f"/api/v1/portal/class-links/{made.json()['id']}").status_code == 204
        assert client.delete(f"/api/v1/portal/class-links/{made.json()['id']}").status_code == 404
    finally:
        app.dependency_overrides.pop(api.get_class_notes, None)
