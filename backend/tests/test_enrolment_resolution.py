"""The rule that turns blocks into enrolments, and what it refuses to do quietly.

These are the cases that decide whether a student gets a timetable, so each one is here on
its own: a student in no group, a group with no CRN, a scope nobody has filled, two cohorts
on one semester, and a CRN the timetable has never heard of.
"""

from __future__ import annotations

from sorbonne.services.enrolment_resolution import (
    Group,
    Major,
    Scope,
    Section,
    readiness,
    resolve,
    validate,
)

CM = Scope(id="s-cm", cohort_id="c1", code="CM", name="Lectures")
TD = Scope(id="s-td", cohort_id="c1", code="TD", name="Tutorials")

CM_A = Group(id="g-cm-a", scope_id="s-cm", label="A", crns={"MATH-001": ["22151"]})
TD_1 = Group(id="g-td-1", scope_id="s-td", label="1", crns={"MATH-011": ["23652"]})
TD_2 = Group(id="g-td-2", scope_id="s-td", label="2", crns={"MATH-011": ["23653"]})

SECTIONS = [
    Section(crn="22151", code="MATH-001-CM-GR.A", kind="Lecture", group_label="Gr. A"),
    Section(crn="23652", code="MATH-011-TD-Gr.1", kind="Tutorial", group_label="Gr. 1"),
    Section(crn="23653", code="MATH-011-TD-Gr.2", kind="Tutorial", group_label="Gr. 2"),
]


# ------------------------------------------------------------------- resolving


def test_a_student_gets_the_crns_of_every_group_they_are_in():
    enrolments = resolve(
        scopes=[CM, TD],
        groups=[CM_A, TD_1],
        assignments={("A001", "s-cm"): ("g-cm-a", ""), ("A001", "s-td"): ("g-td-1", "")},
    )
    assert enrolments == {"A001": ["22151", "23652"]}


def test_a_student_with_no_group_for_a_scope_simply_misses_those_courses():
    enrolments = resolve(scopes=[CM, TD], groups=[CM_A, TD_1], assignments={("A001", "s-cm"): ("g-cm-a", "")})
    assert enrolments == {"A001": ["22151"]}


def test_a_student_in_nothing_at_all_is_left_out_entirely():
    assert resolve(scopes=[CM], groups=[CM_A], assignments={}) == {}


def test_an_assignment_to_another_semesters_scope_is_ignored():
    """Scopes are per semester; publishing one must not drag the other's groups in."""
    enrolments = resolve(
        scopes=[CM],
        groups=[CM_A, TD_1],
        assignments={("A001", "s-cm"): ("g-cm-a", ""), ("A001", "s-other"): ("g-td-1", "")},
    )
    assert enrolments == {"A001": ["22151"]}


def test_an_assignment_to_a_group_that_has_been_deleted_is_ignored():
    assert resolve(scopes=[CM], groups=[], assignments={("A001", "s-cm"): ("g-cm-a", "")}) == {}


def test_a_group_with_no_crn_yet_contributes_nothing():
    empty = Group(id="g-cm-b", scope_id="s-cm", label="B", crns={"MATH-001": []})
    assert resolve(scopes=[CM], groups=[empty], assignments={("A001", "s-cm"): ("g-cm-b", "")}) == {}


def test_two_cohorts_on_one_semester_both_appear():
    other = Scope(id="s-cm2", cohort_id="c2", code="CM", name="Lectures")
    other_group = Group(id="g-cm2", scope_id="s-cm2", label="A", crns={"PHYS-002": ["24110"]})
    enrolments = resolve(
        scopes=[CM, other],
        groups=[CM_A, other_group],
        assignments={("A001", "s-cm"): ("g-cm-a", ""), ("A002", "s-cm2"): ("g-cm2", "")},
    )
    assert enrolments == {"A001": ["22151"], "A002": ["24110"]}


# ------------------------------------------------------------------- readiness


def test_a_cohort_with_everybody_assigned_is_ready():
    report = readiness(
        cohort_name="Foundation Year",
        students=["A001", "A002"],
        scopes=[CM],
        groups=[CM_A],
        course_codes={"s-cm": ["MATH-001"]},
        assignments={("A001", "s-cm"): ("g-cm-a", ""), ("A002", "s-cm"): ("g-cm-a", "")},
    )
    assert report["isReady"]
    assert report["warnings"] == []
    assert report["studentsResolved"] == 2  # noqa: PLR2004


def test_students_with_no_group_are_counted_and_named():
    report = readiness(
        cohort_name="L1",
        students=["A001", "A002", "A003"],
        scopes=[TD],
        groups=[TD_1, TD_2],
        course_codes={"s-td": ["MATH-011"]},
        assignments={("A001", "s-td"): ("g-td-1", "")},
    )
    assert not report["isReady"]
    assert "2 with no Tutorials group" in report["warnings"]
    assert report["unassigned"]["TD"] == ["A002", "A003"]
    assert report["studentsResolved"] == 1


def test_a_scope_nobody_has_filled_says_so_rather_than_blaming_the_students():
    report = readiness(
        cohort_name="L2",
        students=["A001"],
        scopes=[TD],
        groups=[],
        course_codes={"s-td": ["MATH-011"]},
        assignments={},
    )
    assert report["warnings"] == ["Tutorials has no groups yet"]
    assert report["unassigned"] == {}


def test_a_group_missing_a_crn_for_one_of_its_courses_is_reported():
    half = Group(id="g-td-3", scope_id="s-td", label="3", crns={"MATH-011": ["23652"]})
    report = readiness(
        cohort_name="L1",
        students=["A001"],
        scopes=[TD],
        groups=[half],
        course_codes={"s-td": ["MATH-011", "PHYS-002"]},
        assignments={("A001", "s-td"): ("g-td-3", "")},
    )
    assert "Tutorials 3 has no CRN for PHYS-002" in report["warnings"]


# ------------------------------------------------------------------ validation


def test_a_crn_the_timetable_holds_is_matched_and_carries_the_section():
    verdicts = validate(groups=[CM_A], sections=SECTIONS)
    assert verdicts["g-cm-a|MATH-001"]["status"] == "matched"
    assert verdicts["g-cm-a|MATH-001"]["section"]["groupLabel"] == "Gr. A"


def test_a_crn_the_timetable_does_not_hold_is_flagged():
    stray = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": ["99999"]})
    verdict = validate(groups=[stray], sections=SECTIONS)["g|MATH-001"]
    assert verdict["status"] == "unknown"
    assert "99999" in verdict["detail"]


def test_an_untimetabled_crn_is_not_accused_of_being_wrong():
    """The timetable is the registrar's, so its silence is a gap in what we were told.

    Twenty-seven live sections wear this today and not one of them is a fault: the sweep
    has not been asked about them, or the registrar has booked no room yet. "Not in this
    semester's timetable" read as an accusation against a perfectly correct CRN, and sent
    a coordinator looking for a typo that was not there.
    """
    stray = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": ["99999"]})
    verdict = validate(groups=[stray], sections=SECTIONS)["g|MATH-001"]

    assert "No timetable for CRN 99999 yet" in verdict["detail"]
    assert "not in this semester" not in verdict["detail"].lower()
    # The other direction is still said as ours, because a typo landing on a real section
    # of the wrong subject IS our mistake to fix.
    wrong = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": ["23652"]})
    assert "is MATH-011" in validate(groups=[wrong], sections=SECTIONS)["g|MATH-001"]["detail"]


def test_a_crn_belonging_to_a_different_course_is_the_subtler_failure():
    """A typo that lands on a real section of the wrong subject would otherwise pass."""
    wrong = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": ["23652"]})
    verdict = validate(groups=[wrong], sections=SECTIONS)["g|MATH-001"]
    assert verdict["status"] == "mismatched"
    assert "MATH-011" in verdict["detail"]


def test_an_empty_crn_is_missing_rather_than_wrong():
    blank = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": []})
    assert validate(groups=[blank], sections=SECTIONS)["g|MATH-001"]["status"] == "missing"


def test_codes_are_compared_past_the_separators_the_two_systems_disagree_about():
    # The workbook writes MATH001, the registrar writes MATH-001-CM-GR.A. Same course.
    loose = Group(id="g", scope_id="s-cm", label="A", crns={"math001": ["22151"]})
    assert validate(groups=[loose], sections=SECTIONS)["g|math001"]["status"] == "matched"


# ------------------------------------- a set whose groups hold one programme of the cohort


TP = Scope(id="s-tp", cohort_id="c1", code="TP", name="Practicals")
MATHS = Major(id="m-maths", program="Mathematics")
PHYS = Major(id="m-phys", program="Physics")
CM_MATHS = Group(id="g-cm-m", scope_id="s-cm", label="Mathematics", majors=(MATHS,))
CM_PHYS = Group(id="g-cm-p", scope_id="s-cm", label="Physics", majors=(PHYS,))
TP_PHYS = Group(
    id="g-tp",
    scope_id="s-tp",
    label="Physics",
    crns={"PHYS-208": ["24240"]},
    majors=(Major(id="m-tp-phys", program="Physics", crns={"PHYS-208": ["24240"]}),),
)


def physics_practicals(assignments: dict) -> dict:
    return readiness(
        cohort_name="L2",
        students=["A001", "A002"],
        scopes=[CM, TP],
        groups=[CM_MATHS, CM_PHYS, TP_PHYS],
        course_codes={"s-cm": [], "s-tp": ["PHYS-208"]},
        assignments=assignments,
    )


def test_a_mathematician_is_not_missing_from_a_set_closed_to_physicists():
    """36 of L2's 44 students and 11 of L3's 16 were reported missing from the practicals.

    They are mathematicians, and the practicals' one group holds physicists only. That is
    not a worklist; it is a wall of noise standing in front of one.
    """
    report = physics_practicals(
        {
            ("A001", "s-cm"): ("g-cm-m", "m-maths"),
            ("A002", "s-cm"): ("g-cm-p", "m-phys"),
            ("A002", "s-tp"): ("g-tp", "m-tp-phys"),
        }
    )

    assert report["isReady"]
    assert report["unassigned"] == {}


def test_a_physicist_missing_from_it_is_still_missing():
    # The difference between not asking a mathematician for a physics group and quietly
    # forgetting a physicist.
    report = physics_practicals({("A001", "s-cm"): ("g-cm-m", "m-maths"), ("A002", "s-cm"): ("g-cm-p", "m-phys")})

    assert report["unassigned"]["TP"] == ["A002"]
    assert "1 with no Practicals group" in report["warnings"]


def test_a_student_whose_programme_nothing_records_stays_expected():
    """Fail open. On production exactly one student is in this position, and the honest
    answer about them is "we do not know", not "not our problem".
    """
    report = physics_practicals({("A002", "s-cm"): ("g-cm-p", "m-phys"), ("A002", "s-tp"): ("g-tp", "m-tp-phys")})

    assert report["unassigned"]["TP"] == ["A001"]


def test_a_set_with_a_group_open_to_everybody_still_expects_everybody():
    # Every set in Foundation Year is this, and none of them changes.
    report = readiness(
        cohort_name="L1",
        students=["A001", "A002"],
        scopes=[TD],
        groups=[TD_1],
        course_codes={"s-td": ["MATH-011"]},
        assignments={("A001", "s-td"): ("g-td-1", "")},
    )

    assert report["unassigned"]["TD"] == ["A002"]


# ------------------------- one group, two sub-rows: what mutualized teaching comes to


LECTURES = Group(
    id="g-cm",
    scope_id="s-cm",
    label="1",
    # Shared by everybody in the group: the mutualized lecture.
    crns={"CPSC-100": ["22155"]},
    majors=(
        # The mathematicians' sub-row takes the shared lecture and their own philosophy,
        # and is not taught the physicists' option.
        Major(
            id="m-maths",
            program="MATH - Mathematics",
            crns={"CPSC-100": ["22155"], "MATH-113": ["23307"]},
            not_taught=frozenset({"PHYS-118"}),
        ),
        # The physicists' takes the shared lecture and their own option.
        Major(
            id="m-phys",
            program="PHYS - Physics",
            crns={"CPSC-100": ["22155"], "PHYS-118": ["22150"]},
            not_taught=frozenset({"MATH-113"}),
        ),
    ),
)


def test_a_student_on_a_sub_row_gets_what_the_sub_row_comes_to():
    """The seat decides the CRNs: the shared lecture, plus the sub-row's own, minus what
    it is not taught. A mathematician in CM 1 is not sent to the physicists' option."""
    enrolments = resolve(
        scopes=[CM],
        groups=[LECTURES],
        assignments={("A001", "s-cm"): ("g-cm", "m-maths"), ("A002", "s-cm"): ("g-cm", "m-phys")},
    )

    assert enrolments == {"A001": ["22155", "23307"], "A002": ["22150", "22155"]}


def test_a_student_on_no_sub_row_of_such_a_group_gets_only_what_everybody_shares():
    enrolments = resolve(scopes=[CM], groups=[LECTURES], assignments={("A003", "s-cm"): ("g-cm", "")})
    assert enrolments == {"A003": ["22155"]}


def test_a_group_is_not_asked_for_a_crn_in_a_course_none_of_its_sub_rows_is_taught():
    """One lecture set holding the mathematicians' philosophy and the physicists' option is
    what merging ten sets into three produces, and every blank cell in it is correct."""
    report = readiness(
        cohort_name="L1",
        students=["A001", "A002"],
        scopes=[CM],
        groups=[LECTURES],
        course_codes={"s-cm": ["CPSC-100", "MATH-113", "PHYS-118"]},
        assignments={("A001", "s-cm"): ("g-cm", "m-maths"), ("A002", "s-cm"): ("g-cm", "m-phys")},
    )

    assert report["warnings"] == []
    assert report["isReady"]


def test_a_group_is_still_asked_for_a_crn_in_a_course_a_sub_row_takes_and_has_no_crn_for():
    # The shared lecture struck from nobody, and no CRN anywhere: a real gap.
    bare = Group(
        id="g-cm",
        scope_id="s-cm",
        label="1",
        majors=(Major(id="m-maths", program="MATH - Mathematics", crns={"MATH-113": ["23307"]}),),
    )
    report = readiness(
        cohort_name="L1",
        students=["A001"],
        scopes=[CM],
        groups=[bare],
        course_codes={"s-cm": ["CPSC-100", "MATH-113"]},
        assignments={("A001", "s-cm"): ("g-cm", "m-maths")},
    )

    assert "Lectures 1 has no CRN for CPSC-100" in report["warnings"]


def test_a_group_whose_only_sub_row_is_not_taught_a_course_is_not_asked_for_its_crn():
    """MTP 1A holds mathematicians alone and is not taught the physicists' practical: the
    set carries it for the groups that are, and this group is no gap."""
    maths_only = Group(
        id="g-1a",
        scope_id="s-tp",
        label="1A",
        crns={"PHYS-125": ["23639"]},
        majors=(
            Major(
                id="m",
                program="MATH - Mathematics",
                crns={"PHYS-125": ["23639"]},
                not_taught=frozenset({"PHYS-118"}),
            ),
        ),
    )
    report = readiness(
        cohort_name="L1",
        students=["A001"],
        scopes=[TP],
        groups=[maths_only],
        course_codes={"s-tp": ["PHYS-125", "PHYS-118"]},
        assignments={("A001", "s-tp"): ("g-1a", "m")},
    )

    assert report["warnings"] == []


def test_a_group_with_no_sub_rows_is_asked_for_every_course():
    # Blank means everyone, which is every set in Foundation Year today.
    report = readiness(
        cohort_name="L1",
        students=["A001"],
        scopes=[CM],
        groups=[Group(id="g-cm", scope_id="s-cm", label="1", crns={"CPSC-100": ["22155"]})],
        course_codes={"s-cm": ["CPSC-100", "MATH-113", "PHYS-118"]},
        assignments={("A001", "s-cm"): ("g-cm", "")},
    )

    assert any("has no CRN for" in warning for warning in report["warnings"])
