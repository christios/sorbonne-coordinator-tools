"""The registrar's schedule, and the difference between quiet and empty.

The interesting cases are all about absence. A pull that fails, a pull that gives up
halfway, a section that answers nothing — each of them looks like "no classes booked" to a
store that does not keep the difference, and each of them would retire real teaching.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from sorbonne.services.facility_timetable import ContradictoryPull, FacilityTimetableStore
from tests.conftest import TEST_DATABASE_URL

TERM = "262710"


@pytest.fixture
def store() -> FacilityTimetableStore:
    held = FacilityTimetableStore(TEST_DATABASE_URL)
    with held.engine.begin() as connection:
        connection.execute(text("DELETE FROM facility_meetings"))
        connection.execute(text("DELETE FROM facility_sections"))
        connection.execute(text("DELETE FROM facility_pulls"))
    return held


def section(crn: str, *, meetings=(), ours: bool = True, head: int | None = None) -> dict:
    return {
        "crn": crn, "courseCode": "MATH-001", "title": "Pre-Calculus 1", "teacherName": "Cecile Paillot",
        "rooms": ["5.101/.103"], "ours": ours, "headCount": head,
        "meetings": [
            {"meetsOn": on, "startsAt": start, "endsAt": end, "room": "5.101/.103"} for on, start, end in meetings
        ],
    }


MONDAY = ("2026-09-07", "08:30", "10:00")
TUESDAY = ("2026-09-08", "08:30", "10:00")


def test_a_section_that_answered_gives_its_meetings_back(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY, TUESDAY])],
                      silent=[], failed=[], complete=True)

    sessions = store.sessions_for(TERM, ["23425"])

    assert [(s.crn, s.date, s.start, s.end) for s in sessions] == [
        ("23425", "2026-09-07", "08:30", "10:00"),
        ("23425", "2026-09-08", "08:30", "10:00"),
    ]


def test_a_moved_meeting_replaces_the_old_one_rather_than_joining_it(store: FacilityTimetableStore):
    # The failure this prevents is the worst kind: a permanent clash against a class that
    # is not there, in the code path the whole feature is sold on.
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    moved = ("2026-09-07", "13:30", "15:00")
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[moved])],
                      silent=[], failed=[], complete=True)

    assert [(s.start, s.end) for s in store.sessions_for(TERM, ["23425"])] == [("13:30", "15:00")]


def test_a_pull_that_asked_about_a_section_it_never_mentions_is_refused(store: FacilityTimetableStore):
    # Not half-applied. A pull that quietly drops a section is how a section goes invisible.
    with pytest.raises(ContradictoryPull):
        store.record_pull(term_code=TERM, asked=["23425", "23426"], sections=[section("23425")],
                          silent=[], failed=[], complete=True)


def test_a_section_nobody_asked_about_is_unchecked_not_clean(store: FacilityTimetableStore):
    coverage = store.coverage_for(TERM, ["23425"])

    assert coverage.unchecked == ["23425"]
    assert coverage.published == []
    assert coverage.blind == ["23425"]


def test_one_silence_is_noted_and_not_believed(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)

    coverage = store.coverage_for(TERM, ["23425"])
    assert coverage.silent == ["23425"]
    # Stale is not absent: until it is believed dead, the last thing the registrar said is
    # still the best thing anybody knows, so it is neither blind nor dropped from clashes.
    assert coverage.blind == []
    assert len(store.sessions_for(TERM, ["23425"])) == 1


def test_two_silences_retire_it_and_it_stops_being_compared(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    for _ in range(2):
        store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)

    assert store.coverage_for(TERM, ["23425"]).gone == ["23425"]
    assert store.sessions_for(TERM, ["23425"]) == []


def test_a_pull_that_gave_up_halfway_cannot_retire_anything(store: FacilityTimetableStore):
    # The one that matters most. An incomplete pull says nothing about what it never
    # reached, so its silences are not evidence and must never count towards being gone.
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    for _ in range(4):
        store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=False)

    assert store.coverage_for(TERM, ["23425"]).published == ["23425"]
    assert len(store.sessions_for(TERM, ["23425"])) == 1


def test_a_failed_call_is_not_evidence_either(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    for _ in range(4):
        store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=[], failed=["23425"], complete=True)

    assert store.coverage_for(TERM, ["23425"]).published == ["23425"]


def test_a_section_that_comes_back_is_published_again_and_forgets_its_silences(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)
    store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[TUESDAY])],
                      silent=[], failed=[], complete=True)

    assert store.coverage_for(TERM, ["23425"]).published == ["23425"]
    # And one more silence must not immediately retire it: the counter went back to zero.
    store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)
    assert store.coverage_for(TERM, ["23425"]).silent == ["23425"]


def test_a_head_count_is_not_kept_for_a_section_that_is_not_ours(store: FacilityTimetableStore):
    # Another department's enrolment is a fact about them, and no verdict of ours needs it.
    store.record_pull(
        term_code=TERM, asked=["20581", "23425"],
        sections=[section("20581", ours=False, head=31), section("23425", ours=True, head=24)],
        silent=[], failed=[], complete=True,
    )

    with store.engine.connect() as connection:
        held = dict(
            connection.execute(
                text("SELECT crn, head_count FROM facility_sections WHERE term_code = :t"), {"t": TERM}
            ).all()
        )
    assert held == {"20581": None, "23425": 24}


def test_the_same_meeting_twice_in_one_pull_is_stored_once(store: FacilityTimetableStore):
    # The portal answers per student, so a section of thirty returns each meeting thirty
    # times. De-duplicated on the way in rather than trusted to be clean.
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=[MONDAY, MONDAY, MONDAY])],
                      silent=[], failed=[], complete=True)

    assert len(store.sessions_for(TERM, ["23425"])) == 1


def test_a_sweep_read_back_and_replayed_lands_the_same_timetable(store: FacilityTimetableStore):
    """The copy between instances is the same write the extension makes, so it must round-trip.

    Nothing else can put this in a developer's database: the registrar is reached through a
    browser extension signed in as a coordinator. Reading it back in the pull's own shape is
    what makes a local copy of production able to answer a clash at all.
    """
    store.record_pull(
        term_code=TERM,
        asked=["23436", "24311", "99999"],
        sections=[section("23436", meetings=[MONDAY, TUESDAY]), section("24311", meetings=[MONDAY], ours=False)],
        silent=["99999"],
        failed=[],
        complete=True,
    )

    sweep = store.sweep(TERM)
    elsewhere = FacilityTimetableStore(TEST_DATABASE_URL)
    with elsewhere.engine.begin() as connection:
        connection.execute(text("DELETE FROM facility_meetings"))
        connection.execute(text("DELETE FROM facility_sections"))
    elsewhere.record_pull(
        term_code=sweep["termCode"],
        asked=sweep["asked"],
        sections=sweep["sections"],
        silent=sweep["silent"],
        failed=sweep["failed"],
        complete=sweep["complete"],
    )

    assert elsewhere.sweep(TERM) == sweep
    # And what the clash reader asks of it survives, which is the point of copying it.
    assert len(elsewhere.sessions_for(TERM, ["23436"])) == 2
    assert elsewhere.coverage_for(TERM, ["23436", "24311", "99999"]).silent == ["99999"]


def test_a_sweep_names_every_section_it_accounts_for_so_a_replay_adds_up(store: FacilityTimetableStore):
    """`asked` must cover answered and quiet alike, or `record_pull` refuses the replay.

    A sweep naming only the sections that answered would read, on arrival, as the registrar
    having cancelled the rest.
    """
    store.record_pull(
        term_code=TERM,
        asked=["23436", "99999"],
        sections=[section("23436")],
        silent=["99999"],
        failed=[],
        complete=True,
    )

    sweep = store.sweep(TERM)

    assert sweep["asked"] == ["23436", "99999"]
    assert [row["crn"] for row in sweep["sections"]] == ["23436"]
    assert sweep["silent"] == ["99999"]


def test_a_term_never_swept_reads_as_nothing_asked_rather_than_as_an_empty_timetable(store: FacilityTimetableStore):
    assert store.sweep("999999") == {
        "termCode": "999999",
        "asked": [],
        "sections": [],
        "silent": [],
        "failed": [],
        "complete": True,
    }
    assert store.terms() == []
