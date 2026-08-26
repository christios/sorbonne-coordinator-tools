"""The rule that turns blocks into enrolments, and what it refuses to do quietly.

These are the cases that decide whether a student gets a timetable, so each one is here on
its own: a student in no group, a group with no CRN, a scope nobody has filled, two cohorts
on one semester, and a CRN the timetable has never heard of.
"""

from __future__ import annotations

from sorbonne.services.enrolment_resolution import (
    Group,
    Scope,
    Section,
    readiness,
    resolve,
    validate,
)

CM = Scope(id="s-cm", cohort_id="c1", code="CM", name="Lectures")
TD = Scope(id="s-td", cohort_id="c1", code="TD", name="Tutorials")

CM_A = Group(id="g-cm-a", scope_id="s-cm", label="A", crns={"MATH-001": "22151"})
TD_1 = Group(id="g-td-1", scope_id="s-td", label="1", crns={"MATH-011": "23652"})
TD_2 = Group(id="g-td-2", scope_id="s-td", label="2", crns={"MATH-011": "23653"})

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
        assignments={("A001", "s-cm"): "g-cm-a", ("A001", "s-td"): "g-td-1"},
    )
    assert enrolments == {"A001": ["22151", "23652"]}


def test_a_student_with_no_group_for_a_scope_simply_misses_those_courses():
    enrolments = resolve(scopes=[CM, TD], groups=[CM_A, TD_1], assignments={("A001", "s-cm"): "g-cm-a"})
    assert enrolments == {"A001": ["22151"]}


def test_a_student_in_nothing_at_all_is_left_out_entirely():
    assert resolve(scopes=[CM], groups=[CM_A], assignments={}) == {}


def test_an_assignment_to_another_semesters_scope_is_ignored():
    """Scopes are per semester; publishing one must not drag the other's groups in."""
    enrolments = resolve(
        scopes=[CM],
        groups=[CM_A, TD_1],
        assignments={("A001", "s-cm"): "g-cm-a", ("A001", "s-other"): "g-td-1"},
    )
    assert enrolments == {"A001": ["22151"]}


def test_an_assignment_to_a_group_that_has_been_deleted_is_ignored():
    assert resolve(scopes=[CM], groups=[], assignments={("A001", "s-cm"): "g-cm-a"}) == {}


def test_a_group_with_no_crn_yet_contributes_nothing():
    empty = Group(id="g-cm-b", scope_id="s-cm", label="B", crns={"MATH-001": ""})
    assert resolve(scopes=[CM], groups=[empty], assignments={("A001", "s-cm"): "g-cm-b"}) == {}


def test_two_cohorts_on_one_semester_both_appear():
    other = Scope(id="s-cm2", cohort_id="c2", code="CM", name="Lectures")
    other_group = Group(id="g-cm2", scope_id="s-cm2", label="A", crns={"PHYS-002": "24110"})
    enrolments = resolve(
        scopes=[CM, other],
        groups=[CM_A, other_group],
        assignments={("A001", "s-cm"): "g-cm-a", ("A002", "s-cm2"): "g-cm2"},
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
        assignments={("A001", "s-cm"): "g-cm-a", ("A002", "s-cm"): "g-cm-a"},
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
        assignments={("A001", "s-td"): "g-td-1"},
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
    half = Group(id="g-td-3", scope_id="s-td", label="3", crns={"MATH-011": "23652"})
    report = readiness(
        cohort_name="L1",
        students=["A001"],
        scopes=[TD],
        groups=[half],
        course_codes={"s-td": ["MATH-011", "PHYS-002"]},
        assignments={("A001", "s-td"): "g-td-3"},
    )
    assert "Tutorials 3 has no CRN for PHYS-002" in report["warnings"]


# ------------------------------------------------------------------ validation


def test_a_crn_the_timetable_holds_is_matched_and_carries_the_section():
    verdicts = validate(groups=[CM_A], sections=SECTIONS)
    assert verdicts["g-cm-a|MATH-001"]["status"] == "matched"
    assert verdicts["g-cm-a|MATH-001"]["section"]["groupLabel"] == "Gr. A"


def test_a_crn_the_timetable_does_not_hold_is_flagged():
    stray = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": "99999"})
    verdict = validate(groups=[stray], sections=SECTIONS)["g|MATH-001"]
    assert verdict["status"] == "unknown"
    assert "99999" in verdict["detail"]


def test_a_crn_belonging_to_a_different_course_is_the_subtler_failure():
    """A typo that lands on a real section of the wrong subject would otherwise pass."""
    wrong = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": "23652"})
    verdict = validate(groups=[wrong], sections=SECTIONS)["g|MATH-001"]
    assert verdict["status"] == "mismatched"
    assert "MATH-011" in verdict["detail"]


def test_an_empty_crn_is_missing_rather_than_wrong():
    blank = Group(id="g", scope_id="s-cm", label="A", crns={"MATH-001": ""})
    assert validate(groups=[blank], sections=SECTIONS)["g|MATH-001"]["status"] == "missing"


def test_codes_are_compared_past_the_separators_the_two_systems_disagree_about():
    # The workbook writes MATH001, the registrar writes MATH-001-CM-GR.A. Same course.
    loose = Group(id="g", scope_id="s-cm", label="A", crns={"math001": "22151"})
    assert validate(groups=[loose], sections=SECTIONS)["g|math001"]["status"] == "matched"
