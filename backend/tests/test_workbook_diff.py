"""What a workbook would change, and what it deliberately leaves alone.

Both uploads used to write on drop, so the cases that matter here are the ones that were
silent before: a CRN a coordinator had corrected being rewritten, a student being moved
between groups, and anything the workbook no longer mentions — which must survive, because
an out-of-date sheet must not be able to take away a group somebody is sitting in.
"""

from __future__ import annotations

from sorbonne.services.group_reference_import import ImportedCourse, ImportedGroup, ImportedScope, ReferenceImport
from sorbonne.services.workbook_diff import (
    diff_assignments,
    diff_reference,
    summarize_assignments,
    summarize_reference,
)


def held_catalogue(crn: str = "22151") -> dict:
    return {
        "CM": {
            "name": "Lectures",
            "courses": {"MATH001": "Pre-calculus"},
            "groups": {"1": {"id": "g1", "label": "1", "capacity": 0, "note": "", "crns": {"MATH001": crn}}},
        }
    }


def workbook(crn: str = "22151", *, groups=None, courses=None) -> ReferenceImport:
    return ReferenceImport(
        scopes=[
            ImportedScope(
                code="CM",
                name="Lectures",
                courses=courses or [ImportedCourse(code="MATH001", name="Pre-calculus")],
                groups=groups or [ImportedGroup(label="1", crns={"MATH001": (crn, "Dr Maaz")})],
            )
        ]
    )


# ------------------------------------------------------------------ the reference


def test_a_workbook_that_matches_asks_for_no_decisions():
    blocks = diff_reference(held=held_catalogue(), incoming=workbook())
    assert blocks[0]["rows"] == []
    assert blocks[0]["unchanged"] == 1
    assert summarize_reference(blocks)["decisions"] == 0


def test_a_changed_crn_is_one_decision_showing_both_values():
    # The silent overwrite this whole change exists to stop.
    blocks = diff_reference(held=held_catalogue("22151"), incoming=workbook("22159"))
    (row,) = blocks[0]["rows"]
    assert row["status"] == "changed"
    assert row["before"] == "22151"
    assert row["after"] == "22159"
    assert row["detail"] == "CRN 22151 → 22159"


def test_a_cell_row_carries_the_value_it_would_write_and_not_only_the_one_it_shows():
    """`after` is what the screen says; `crn` is what apply writes. They must be the same.

    They were not: the row showed "22151 → 22159" and applied an empty cell, because the
    field apply reads was missing. A row that shows one thing and does another is exactly
    what posting rows back verbatim is supposed to make impossible.
    """
    (row,) = diff_reference(held=held_catalogue("22151"), incoming=workbook("22159"))[0]["rows"]
    assert row["crn"] == row["after"] == "22159"


def test_filling_an_empty_cell_reads_as_new_rather_than_changed():
    held = held_catalogue()
    held["CM"]["groups"]["1"]["crns"] = {}
    (row,) = diff_reference(held=held, incoming=workbook("22159"))[0]["rows"]
    assert row["status"] == "added"
    assert row["before"] == ""


def test_a_group_the_catalogue_lacks_arrives_as_one_decision_not_one_per_crn():
    incoming = workbook(groups=[ImportedGroup(label="2", crns={"MATH001": ("22160", "Dr X")})])
    rows = diff_reference(held=held_catalogue(), incoming=incoming)[0]["rows"]
    assert [row["kind"] for row in rows] == ["group"]
    assert rows[0]["crns"] == {"MATH001": "22160"}


def test_a_course_the_block_does_not_teach_yet_is_its_own_decision():
    incoming = workbook(courses=[ImportedCourse(code="MATH001"), ImportedCourse(code="MATH009", name="Algebra")])
    kinds = [row["kind"] for row in diff_reference(held=held_catalogue(), incoming=incoming)[0]["rows"]]
    assert "course" in kinds


def test_a_block_nothing_is_held_for_is_marked_new():
    blocks = diff_reference(held={}, incoming=workbook())
    assert blocks[0]["isNew"] is True
    assert summarize_reference(blocks)["blocksNew"] == 1


def test_a_group_the_workbook_has_stopped_mentioning_is_left_alone():
    """An out-of-date sheet must not be able to remove a group somebody is sitting in."""
    held = held_catalogue()
    held["CM"]["groups"]["9"] = {"id": "g9", "label": "9", "capacity": 0, "note": "", "crns": {}}
    blocks = diff_reference(held=held, incoming=workbook())
    assert blocks[0]["rows"] == []


def test_block_and_group_names_are_matched_regardless_of_case():
    held = held_catalogue()
    held["CM"]["groups"] = {"a": {"id": "g1", "label": "a", "capacity": 0, "note": "", "crns": {"MATH001": "22151"}}}
    incoming = workbook(groups=[ImportedGroup(label="A", crns={"MATH001": ("22151", "")})])
    assert diff_reference(held=held, incoming=incoming)[0]["rows"] == []


# ---------------------------------------------------------------- the placements

GROUPS = {"CM": {"1": "g1", "2": "g2"}, "TD": {"3": "t3"}}
ROSTER = {"A1", "A2"}


def test_a_student_already_where_the_workbook_puts_them_is_not_a_decision():
    report = diff_assignments(
        held={"A1": {"CM": "1"}}, incoming={"A1": {"CM": "1"}}, groups=GROUPS, known_students=ROSTER
    )
    assert report["rows"] == []
    assert report["unchanged"] == 1


def test_a_student_nobody_has_placed_reads_as_placed():
    report = diff_assignments(held={}, incoming={"A1": {"CM": "1"}}, groups=GROUPS, known_students=ROSTER)
    (row,) = report["rows"]
    assert row["status"] == "placed"
    assert row["groupId"] == "g1"
    assert row["detail"] == "CM 1"


def test_a_student_the_workbook_moves_says_where_from_and_to():
    report = diff_assignments(
        held={"A1": {"CM": "1"}}, incoming={"A1": {"CM": "2"}}, groups=GROUPS, known_students=ROSTER
    )
    (row,) = report["rows"]
    assert row["status"] == "moved"
    assert row["detail"] == "CM 1 → 2"


def test_a_group_the_catalogue_does_not_have_is_named_not_skipped_quietly():
    report = diff_assignments(held={}, incoming={"A1": {"CM": "99"}}, groups=GROUPS, known_students=ROSTER)
    assert report["rows"] == []
    assert report["unknownGroups"] == ["CM 99"]


def test_a_placement_the_workbook_no_longer_mentions_is_left_alone():
    report = diff_assignments(
        held={"A1": {"CM": "1", "TD": "3"}}, incoming={"A1": {"CM": "1"}}, groups=GROUPS, known_students=ROSTER
    )
    assert report["rows"] == []
    assert summarize_assignments(report)["decisions"] == 0


def test_the_summary_counts_placements_and_moves_apart():
    report = diff_assignments(
        held={"A1": {"CM": "1"}},
        incoming={"A1": {"CM": "2"}, "A2": {"CM": "1"}},
        groups=GROUPS,
        known_students=ROSTER,
    )
    totals = summarize_assignments(report)
    assert totals["moved"] == 1
    assert totals["placed"] == 1


def test_a_workbook_id_this_cohort_does_not_hold_is_reported_not_placed():
    """The roster is the registrar's. A spreadsheet must not be able to invent a student.

    The old importer skipped these and said so; the reviewed path has to keep that, or a
    typo in the ID column becomes an assignment for somebody who does not exist.
    """
    report = diff_assignments(
        held={},
        incoming={"A1": {"CM": "1"}, "A00099999": {"CM": "2"}},
        groups=GROUPS,
        known_students=ROSTER,
    )

    assert [row["studentId"] for row in report["rows"]] == ["A1"]
    assert report["unknownStudents"] == ["A00099999"]
    assert summarize_assignments(report)["unknownStudents"] == 1
