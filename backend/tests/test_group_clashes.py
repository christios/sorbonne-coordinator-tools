"""Which groups meet at the same hour — the constraint a fill must respect."""

from __future__ import annotations

from sorbonne.services.enrolment_resolution import Group
from sorbonne.services.group_clashes import Session, clashes

CM_A = Group(id="g-cm-a", scope_id="s-cm", label="A", crns={"MATH-001": "22151"})
TD_1 = Group(id="g-td-1", scope_id="s-td", label="1", crns={"MATH-011": "23652"})
TD_2 = Group(id="g-td-2", scope_id="s-td", label="2", crns={"MATH-011": "23653"})
LANG_F1 = Group(id="g-lang-f1", scope_id="s-lang", label="F1", crns={"SCEN-101": "23302"})

MONDAY = "2026-08-31"
NEXT_MONDAY = "2026-09-07"


def at(crn: str, date: str, start: str, end: str) -> Session:
    return Session(crn=crn, date=date, start=start, end=end)


def test_two_groups_of_different_blocks_meeting_at_the_same_hour_clash():
    found = clashes(
        groups=[CM_A, TD_1],
        sessions=[at("22151", MONDAY, "08:30:00", "10:00:00"), at("23652", MONDAY, "09:00:00", "10:30:00")],
        assignments={("A001", "s-cm"): "g-cm-a", ("A001", "s-td"): "g-td-1", ("A002", "s-cm"): "g-cm-a"},
    )

    assert found == [
        {
            "groups": [
                {"id": "g-cm-a", "scopeId": "s-cm", "label": "A"},
                {"id": "g-td-1", "scopeId": "s-td", "label": "1"},
            ],
            "windows": [{"weekday": "Mon", "start": "09:00", "end": "10:00", "crns": ["22151", "23652"], "dates": 1}],
            "students": ["A001"],
        }
    ]


def test_groups_of_the_same_block_are_never_compared():
    # A student is in one TD group, not two, so TD 1 against TD 2 is nobody's problem.
    found = clashes(
        groups=[TD_1, TD_2],
        sessions=[at("23652", MONDAY, "08:30", "10:00"), at("23653", MONDAY, "08:30", "10:00")],
        assignments={},
    )

    assert found == []


def test_sessions_that_only_touch_do_not_clash():
    found = clashes(
        groups=[CM_A, TD_1],
        sessions=[at("22151", MONDAY, "08:30", "10:00"), at("23652", MONDAY, "10:00", "11:30")],
        assignments={},
    )

    assert found == []


def test_sessions_on_different_days_do_not_clash():
    found = clashes(
        groups=[CM_A, TD_1],
        sessions=[at("22151", MONDAY, "08:30", "10:00"), at("23652", "2026-09-01", "08:30", "10:00")],
        assignments={},
    )

    assert found == []


def test_a_weekly_slot_is_one_window_that_happens_every_week():
    found = clashes(
        groups=[CM_A, TD_1],
        sessions=[
            at("22151", MONDAY, "08:30", "10:00"),
            at("22151", NEXT_MONDAY, "08:30", "10:00"),
            at("23652", MONDAY, "08:30", "10:00"),
            at("23652", NEXT_MONDAY, "08:30", "10:00"),
        ],
        assignments={},
    )

    assert found[0]["windows"] == [
        {"weekday": "Mon", "start": "08:30", "end": "10:00", "crns": ["22151", "23652"], "dates": 2}
    ]


def test_a_group_whose_own_crns_overlap_is_a_clash_with_itself():
    both = Group(id="g-cm-b", scope_id="s-cm", label="B", crns={"MATH-001": "22151", "PHYS-001": "22160"})

    found = clashes(
        groups=[both],
        sessions=[at("22151", MONDAY, "08:30", "10:00"), at("22160", MONDAY, "08:30", "10:00")],
        assignments={("A001", "s-cm"): "g-cm-b"},
    )

    assert len(found) == 1
    assert found[0]["groups"] == [{"id": "g-cm-b", "scopeId": "s-cm", "label": "B"}]
    assert found[0]["students"] == ["A001"]


def test_the_pairs_with_students_already_in_both_come_first():
    found = clashes(
        groups=[CM_A, TD_1, LANG_F1],
        sessions=[
            at("22151", MONDAY, "08:30", "10:00"),
            at("23652", MONDAY, "08:30", "10:00"),
            at("23302", MONDAY, "08:30", "10:00"),
        ],
        assignments={("A001", "s-td"): "g-td-1", ("A001", "s-lang"): "g-lang-f1"},
    )

    labels = [[group["label"] for group in clash["groups"]] for clash in found]
    assert labels == [["1", "F1"], ["A", "1"], ["A", "F1"]]


def test_a_crn_the_timetable_has_no_hours_for_clashes_with_nothing():
    assert clashes(groups=[CM_A, TD_1], sessions=[], assignments={}) == []
