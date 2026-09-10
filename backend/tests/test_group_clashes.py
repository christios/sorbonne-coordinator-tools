"""Which groups meet at the same hour — the constraint a fill must respect."""

from __future__ import annotations

from sorbonne.services.enrolment_resolution import Group
from sorbonne.services.group_clashes import Session, clashes

CM_A = Group(id="g-cm-a", scope_id="s-cm", label="A", crns={"MATH-001": ["22151"]})
TD_1 = Group(id="g-td-1", scope_id="s-td", label="1", crns={"MATH-011": ["23652"]})
TD_2 = Group(id="g-td-2", scope_id="s-td", label="2", crns={"MATH-011": ["23653"]})
LANG_F1 = Group(id="g-lang-f1", scope_id="s-lang", label="F1", crns={"SCEN-101": ["23302"]})

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
    both = Group(id="g-cm-b", scope_id="s-cm", label="B", crns={"MATH-001": ["22151"], "PHYS-001": ["22160"]})

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


# ------------------------------- courses taught to one programme and not the other


PHYS_CM = Group(id="g-cm-phys", scope_id="s-cm", label="Physics", crns={"PHYS-118": ["24070"]})
MATH_TD = Group(id="g-td-math", scope_id="s-td", label="Mathematics", crns={"MATH-330": ["24100"]})


def test_two_courses_taught_to_different_programmes_never_clash():
    """In L2 and L3 the group IS the programme, and a student takes their own courses.

    So a Physics lecture and a Maths tutorial may sit on the same hour for ever and catch
    nobody. Reporting it is reporting a room booking as a problem, and on production these
    were most of what the page had to say about those two years.
    """
    found = clashes(
        groups=[PHYS_CM, MATH_TD],
        sessions=[at("24070", MONDAY, "08:30", "10:00"), at("24100", MONDAY, "08:30", "10:00")],
        assignments={},
        programs={"24070": "Physics", "24100": "Mathematics"},
    )

    assert found == []


def test_the_same_programme_on_both_sides_still_clashes():
    # The rule rules out a pair with no student in common, not every pair with a programme.
    found = clashes(
        groups=[PHYS_CM, MATH_TD],
        sessions=[at("24070", MONDAY, "08:30", "10:00"), at("24100", MONDAY, "08:30", "10:00")],
        assignments={},
        programs={"24070": "Physics", "24100": "physics "},
    )

    assert len(found) == 1


def test_a_course_for_everyone_is_compared_with_everything():
    """Blank means everyone, which is every course in Foundation Year and L1.

    A named course against an unnamed one is a real clash: the unnamed one is taken by the
    named one's students too.
    """
    found = clashes(
        groups=[PHYS_CM, MATH_TD],
        sessions=[at("24070", MONDAY, "08:30", "10:00"), at("24100", MONDAY, "08:30", "10:00")],
        assignments={},
        programs={"24070": "Physics"},
    )

    assert len(found) == 1


def test_a_group_teaching_both_programmes_still_clashes_with_itself_where_it_should():
    """One group, two courses of different programmes: not a clash, because nobody takes both.

    The self-pair is where this could most easily go wrong — a group carrying a Maths and a
    Physics course at one hour is exactly how L2's CM set is built, and calling that "cannot
    hold anyone at all" would condemn a set that works.
    """
    both = Group(
        id="g-cm", scope_id="s-cm", label="A", crns={"PHYS-118": ["24070"], "MATH-330": ["24100"]}
    )

    found = clashes(
        groups=[both],
        sessions=[at("24070", MONDAY, "08:30", "10:00"), at("24100", MONDAY, "08:30", "10:00")],
        assignments={},
        programs={"24070": "Physics", "24100": "Mathematics"},
    )

    assert found == []


def test_without_programmes_nothing_changes():
    # Every set that does not use them behaves exactly as it did.
    found = clashes(
        groups=[PHYS_CM, MATH_TD],
        sessions=[at("24070", MONDAY, "08:30", "10:00"), at("24100", MONDAY, "08:30", "10:00")],
        assignments={},
    )

    assert len(found) == 1
