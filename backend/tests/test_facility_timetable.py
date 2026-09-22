"""The registrar's schedule, and the difference between quiet and empty.

The interesting cases are all about absence. A pull that fails, a pull that gives up
halfway, a section that answers nothing — each of them looks like "no classes booked" to a
store that does not keep the difference, and each of them would retire real teaching.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from sorbonne.services.facility_timetable import ContradictoryPull, FacilityTimetableStore, change_key
from tests.conftest import TEST_DATABASE_URL

TERM = "262710"


@pytest.fixture
def store() -> FacilityTimetableStore:
    held = FacilityTimetableStore(TEST_DATABASE_URL)
    with held.engine.begin() as connection:
        connection.execute(text("DELETE FROM facility_meeting_changes"))
        connection.execute(text("DELETE FROM session_changes WHERE term_code = :t"), {"t": TERM})
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
        connection.execute(text("DELETE FROM facility_meeting_changes"))
        connection.execute(text("DELETE FROM session_changes WHERE term_code = :t"), {"t": TERM})
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


def test_a_calendar_read_answers_for_every_section_asked_about_and_says_which_it_cannot_see(
    store: FacilityTimetableStore,
):
    """A calendar is read for the gaps, so a section nobody asked about must not look like one.

    `gone` contributes no meetings and `silent` keeps its last ones, exactly as
    `sessions_for` reads them — the calendar and the clash count never disagree about
    whether a class is happening.
    """
    store.record_pull(
        term_code=TERM,
        asked=["23436", "24311", "55555"],
        sections=[section("23436", meetings=[MONDAY, TUESDAY]), section("24311", meetings=[MONDAY])],
        silent=["55555"],
        failed=[],
        complete=True,
    )
    for _ in range(2):
        store.record_pull(term_code=TERM, asked=["24311"], sections=[], silent=["24311"], failed=[], complete=True)

    read = store.timetable_for(TERM, ["24311", "23436", "55555", "99999", ""])

    assert [(row["crn"], row["state"], len(row["meetings"])) for row in read["sections"]] == [
        ("23436", "published", 2),
        ("24311", "gone", 0),
        ("55555", "silent", 0),
        ("99999", "unchecked", 0),
    ]
    first = read["sections"][0]
    assert first["courseCode"] == "MATH-001"
    assert first["teacherName"] == "Cecile Paillot"
    assert first["meetings"][0] == {
        "meetsOn": "2026-09-07", "startsAt": "08:30", "endsAt": "10:00", "room": "5.101/.103",
    }
    assert read["pulledAt"]


def test_a_calendar_read_with_nothing_asked_is_empty_rather_than_the_whole_term(store: FacilityTimetableStore):
    store.record_pull(term_code=TERM, asked=["23436"], sections=[section("23436", meetings=[MONDAY])],
                      silent=[], failed=[], complete=True)

    assert store.timetable_for(TERM, []) == {"termCode": TERM, "sections": [], "pulledAt": ""}


def test_the_registrar_s_hours_are_added_up_from_the_dated_meetings(store: FacilityTimetableStore):
    """A cancelled week or a handover is already in the number; a gone section is not there at all."""
    store.record_pull(
        term_code=TERM,
        asked=["23436", "24311"],
        sections=[
            section("23436", meetings=[MONDAY, TUESDAY, ("2026-09-14", "08:15", "10:15")]),
            section("24311", meetings=[MONDAY]),
        ],
        silent=[],
        failed=[],
        complete=True,
    )
    for _ in range(2):
        store.record_pull(term_code=TERM, asked=["24311"], sections=[], silent=["24311"], failed=[], complete=True)

    hours = store.hours_for(TERM)

    assert hours == {"23436": {"courseCode": "MATH-001", "teacherName": "Cecile Paillot", "hours": 5.0}}
    assert store.hours_for("") == {}


# ------------------------------------------- what a sweep took away

WEDNESDAY = ("2026-09-09", "08:30", "10:00")


def swept(store: FacilityTimetableStore, meetings) -> None:
    store.record_pull(term_code=TERM, asked=["23425"], sections=[section("23425", meetings=meetings)],
                      silent=[], failed=[], complete=True)


def test_a_class_the_registrar_deleted_is_reported(store: FacilityTimetableStore):
    """The fault this exists for: the section still answers, with its classes gone."""
    swept(store, [MONDAY, TUESDAY, WEDNESDAY])
    swept(store, [MONDAY])

    [gone] = store.classes_changed(TERM)

    assert gone["crn"] == "23425"
    assert gone["courseCode"] == "MATH-001"
    assert [meeting["meetsOn"] for meeting in gone["removed"]] == ["2026-09-08", "2026-09-09"]
    assert [meeting["meetsOn"] for meeting in gone["kept"]] == ["2026-09-07"]


def test_another_department_s_deletions_are_not_our_warning(store: FacilityTimetableStore):
    """The sweep covers the electives our students sit in elsewhere; the warning does not.

    Found on production: a Spanish option lost two classes and the banner on our teachers'
    page named a Spanish teacher we do not employ. A clash with that section is ours to
    care about; who teaches it and how often is not.
    """
    def elsewhere(meetings) -> None:
        store.record_pull(term_code=TERM, asked=["20598"], sections=[section("20598", meetings=meetings, ours=False)],
                          silent=[], failed=[], complete=True)

    elsewhere([MONDAY, TUESDAY, WEDNESDAY])
    elsewhere([MONDAY])

    assert store.classes_changed(TERM) == []


def test_a_first_sweep_reports_nothing(store: FacilityTimetableStore):
    """Everything is new the first time. A page of "added" teaches people to stop reading."""
    swept(store, [MONDAY, TUESDAY])

    assert store.classes_changed(TERM) == []


def test_a_class_put_back_is_no_longer_missing(store: FacilityTimetableStore):
    """The diff is against what is true now, not a history of everything ever said."""
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    swept(store, [MONDAY, TUESDAY])

    assert store.classes_changed(TERM) == []


def test_a_moved_class_reads_as_one_gone_and_one_arrived(store: FacilityTimetableStore):
    """Nothing here can tell a move from a deletion. The coordinator looking at it can.

    Which is why both halves have to be drawn. Shown as a deletion alone, the afternoon it
    moved to is invisible and the week reads as an hour and a half of teaching lost.
    """
    swept(store, [MONDAY])
    swept(store, [("2026-09-07", "13:30", "15:00")])

    [change] = store.classes_changed(TERM)

    assert [(m["meetsOn"], m["startsAt"]) for m in change["removed"]] == [("2026-09-07", "08:30")]
    assert [(m["meetsOn"], m["startsAt"]) for m in change["added"]] == [("2026-09-07", "13:30")]
    # The arrival is standing teaching as well, and it is counted once, in its own column.
    assert change["kept"] == []


def test_a_class_the_registrar_added_is_reported_on_its_own(store: FacilityTimetableStore):
    """A class nobody asked for is a change to answer for, the same as one that went."""
    swept(store, [MONDAY])
    swept(store, [MONDAY, TUESDAY])

    [change] = store.classes_changed(TERM)

    assert change["removed"] == []
    assert [m["meetsOn"] for m in change["added"]] == ["2026-09-08"]
    assert [m["meetsOn"] for m in change["kept"]] == ["2026-09-07"]


def test_a_class_added_and_taken_away_again_is_nobody_s_news(store: FacilityTimetableStore):
    """Back where it began. The diff is against what we first saw, not against last week."""
    swept(store, [MONDAY])
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])

    assert store.classes_changed(TERM) == []


def test_a_class_arriving_asks_again(store: FacilityTimetableStore):
    """An approval answers the change it was given for, and an arrival is a new one."""
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    before = store.classes_changed(TERM)[0]["key"]

    swept(store, [MONDAY, WEDNESDAY])

    assert store.classes_changed(TERM)[0]["key"] != before


def test_the_key_holds_still_while_the_same_classes_are_missing(store: FacilityTimetableStore):
    swept(store, [MONDAY, TUESDAY, WEDNESDAY])
    swept(store, [MONDAY])
    first = store.classes_changed(TERM)[0]["key"]

    swept(store, [MONDAY])
    assert store.classes_changed(TERM)[0]["key"] == first

    swept(store, [])
    assert store.classes_changed(TERM)[0]["key"] != first


def test_a_silent_section_is_not_reported_as_emptied(store: FacilityTimetableStore):
    """Silence is already handled, and its meetings are kept. This must not double up."""
    swept(store, [MONDAY, TUESDAY])
    store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)

    assert store.classes_changed(TERM) == []


def we_cancelled(store: FacilityTimetableStore, meeting) -> None:
    """A class the department said would not happen, said before the registrar agreed."""
    on, start, end = meeting
    with store.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO session_changes
                        (id, term_code, crn, meets_on, starts_at, ends_at, kind, created_at, updated_at)
                    VALUES (gen_random_uuid()::text, :t, '23425', :on, :s, :e, 'cancelled', 'now', 'now')"""),
            {"t": TERM, "on": on, "s": start, "e": end},
        )


def test_a_class_we_cancelled_ourselves_is_not_news(store: FacilityTimetableStore):
    """The registrar agreeing with us is not a warning. It is the system working."""
    swept(store, [MONDAY, TUESDAY])
    we_cancelled(store, TUESDAY)
    swept(store, [MONDAY])

    assert store.classes_changed(TERM) == []


def test_a_section_the_registrar_went_further_on_still_warns(store: FacilityTimetableStore):
    """One cancelled by us, one not. The one we did not know about is what this is for."""
    swept(store, [MONDAY, TUESDAY, WEDNESDAY])
    we_cancelled(store, TUESDAY)
    swept(store, [MONDAY])

    [gone] = store.classes_changed(TERM)

    assert [(m["meetsOn"], m["weCancelled"]) for m in gone["removed"]] == [
        ("2026-09-08", True),
        ("2026-09-09", False),
    ]


def test_the_key_is_named_after_what_is_news(store: FacilityTimetableStore):
    """Cancelling another class later must not reopen a warning already answered."""
    swept(store, [MONDAY, TUESDAY, WEDNESDAY])
    swept(store, [MONDAY])
    before = store.classes_changed(TERM)[0]["key"]

    we_cancelled(store, TUESDAY)

    assert store.classes_changed(TERM)[0]["key"] != before
    assert store.classes_changed(TERM)[0]["key"] == change_key(TERM, "23425", removed=[WEDNESDAY], added=[])


def test_a_removal_keeps_being_reported_through_later_sweeps(store: FacilityTimetableStore):
    """The warning is answered by a coordinator, not by time passing or by syncing again."""
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    swept(store, [MONDAY])
    swept(store, [MONDAY])

    [gone] = store.classes_changed(TERM)

    assert [meeting["meetsOn"] for meeting in gone["removed"]] == ["2026-09-08"]


def test_sweeping_again_does_not_write_the_same_removal_twice(store: FacilityTimetableStore):
    """A sweep compares itself with what is held, and what is held no longer has it."""
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    swept(store, [MONDAY])

    with store.engine.connect() as connection:
        written = connection.execute(text("SELECT count(*) FROM facility_meeting_changes")).scalar()
    assert written == 1


def test_a_section_going_silent_does_not_disturb_the_warning(store: FacilityTimetableStore):
    """Silence says nothing about the classes, so it must not add or remove any."""
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    store.record_pull(term_code=TERM, asked=["23425"], sections=[], silent=["23425"], failed=[], complete=True)

    [gone] = store.classes_changed(TERM)

    assert [meeting["meetsOn"] for meeting in gone["removed"]] == ["2026-09-08"]


def test_the_key_holds_across_sweeps_so_an_approval_lasts(store: FacilityTimetableStore):
    swept(store, [MONDAY, TUESDAY])
    swept(store, [MONDAY])
    approved = store.classes_changed(TERM)[0]["key"]

    swept(store, [MONDAY])
    swept(store, [MONDAY])

    assert store.classes_changed(TERM)[0]["key"] == approved
