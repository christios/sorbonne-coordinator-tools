"""Our sections against other departments', at the same hour.

The third kind of overlap. Two of ours is a student clash; neither ours is nobody's
business here; exactly one is a collision, and it wants a different remedy from either.
"""

from __future__ import annotations

from sorbonne.services.section_collisions import collisions

# Two Tuesdays, ours at 16:30-18:00 against an option nobody here owns.
OURS, THEIRS, ALSO_THEIRS, ANOTHER_OF_OURS = "23302", "20581", "20590", "23303"
MEETINGS = [
    (OURS, "2026-09-01", "16:30", "18:00"),
    (OURS, "2026-09-08", "16:30", "18:00"),
    (THEIRS, "2026-09-01", "16:30", "18:00"),
    (THEIRS, "2026-09-08", "16:30", "18:00"),
]
COURSES = {OURS: "SCEN-101", THEIRS: "ENGL-604", ALSO_THEIRS: "ARAB-601", ANOTHER_OF_OURS: "SCEN-101"}


def run(**over):
    return collisions(
        **{
            "meetings": MEETINGS,
            "ours": {OURS, ANOTHER_OF_OURS},
            "courses": COURSES,
            "registered": {},
            "settled": {},
            **over,
        }
    )


def test_one_of_ours_against_one_of_theirs_is_a_collision():
    [row] = run()["collides"]

    assert row["ourCrn"] == OURS
    assert row["ourCourse"] == "SCEN-101"
    assert (row["weekday"], row["startsAt"], row["endsAt"]) == ("Tue", "16:30", "18:00")
    assert row["theirs"] == [{"crn": THEIRS, "courseCode": "ENGL-604"}]


def test_two_of_ours_is_a_student_clash_and_not_reported_here():
    """It belongs to the cohort's page, where the remedy is to move a student."""
    both = [(ANOTHER_OF_OURS, day, "16:30", "18:00") for day in ("2026-09-01", "2026-09-08")]
    found = run(meetings=[*MEETINGS[:2], *both])

    assert found["collides"] == []


def test_neither_of_ours_is_reported_nowhere_at_all():
    """We teach neither and can move neither. Reporting it is permanent unactionable red."""
    theirs_only = [
        (THEIRS, "2026-09-01", "16:30", "18:00"),
        (ALSO_THEIRS, "2026-09-01", "16:30", "18:00"),
    ]
    assert run(meetings=theirs_only)["collides"] == []


def test_it_is_one_row_per_slot_however_many_weeks_it_repeats():
    # Fourteen Tuesdays at one hour is one fact that happened fourteen times.
    [row] = run()["collides"]

    assert row["dates"] == 2


def test_every_foreign_section_in_the_slot_lands_on_one_row():
    """Five options in one protected block is one conversation, not five."""
    crowded = [*MEETINGS, (ALSO_THEIRS, "2026-09-01", "16:30", "18:00")]
    [row] = run(meetings=crowded)["collides"]

    assert [t["courseCode"] for t in row["theirs"]] == ["ENGL-604", "ARAB-601"]


def test_sections_that_only_touch_are_not_a_collision():
    # One ends at 16:30 and the next starts there. Nobody is in two places.
    touching = [(OURS, "2026-09-01", "15:00", "16:30"), (THEIRS, "2026-09-01", "16:30", "18:00")]

    assert run(meetings=touching)["collides"] == []


def test_the_student_count_is_who_the_registrar_has_in_both():
    found = run(registered={OURS: {"A1", "A2", "A3"}, THEIRS: {"A2", "A3", "Z9"}})

    # A2 and A3. Not A1, who is only in ours; not Z9, who is only in theirs.
    assert found["collides"][0]["students"] == 2


def test_the_count_carries_no_student_ids_beyond_a_number():
    """The remedy is about the section. A list of names would only invite the wrong one."""
    row = run(registered={OURS: {"A1"}, THEIRS: {"A1"}})["collides"][0]

    assert row["students"] == 1
    assert "A1" not in repr(row)


def test_a_settled_collision_leaves_the_list_and_keeps_its_reason():
    settled = {(OURS, "Tue", "16:30", "18:00"): {"disposition": "accepted", "note": "protected slot"}}
    found = run(settled=settled)

    assert found["collides"] == []
    [done] = found["settledCollisions"]
    assert done["disposition"] == "accepted"
    assert done["note"] == "protected slot"


def test_moving_our_section_unsettles_it_by_itself():
    """The note is keyed on our section's slot, so it expires when the slot does.

    No expiry bookkeeping: the registrar moves the class, the key stops matching, and the
    collision comes back to be looked at again — which is the right answer, since it is a
    different collision now.
    """
    settled = {(OURS, "Tue", "16:30", "18:00"): {"disposition": "accepted", "note": "protected slot"}}
    moved = [(crn, day, "13:00", "14:30") for crn, day, _s, _e in MEETINGS]

    found = collisions(meetings=moved, ours={OURS, ANOTHER_OF_OURS}, courses=COURSES, registered={}, settled=settled)

    assert len(found["collides"]) == 1
    assert found["settledCollisions"] == []


def test_the_busiest_slot_comes_first():
    quiet = [(ANOTHER_OF_OURS, "2026-09-02", "10:00", "11:00"), (THEIRS, "2026-09-02", "10:00", "11:00")]
    found = run(meetings=[*MEETINGS, *quiet], registered={OURS: {"A1", "A2"}, THEIRS: {"A1", "A2"}})

    assert [row["ourCrn"] for row in found["collides"]] == [OURS, ANOTHER_OF_OURS]


def test_an_unreadable_date_is_skipped_rather_than_landing_on_an_invented_day():
    broken = [("23302", "not-a-date", "16:30", "18:00"), (THEIRS, "not-a-date", "16:30", "18:00")]

    assert run(meetings=broken)["collides"] == []
