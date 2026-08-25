"""Reading who is in which group out of the workbooks coordinators already fill.

The workbook says where its own groups live: every derived CRN column is a formula whose
MATCH names the block and points at the column the group is typed into. Reading that rather
than the header text is what makes a renamed column or a new course tab harmless, so these
tests are mostly about the formula being the map.
"""

from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import Workbook

from sorbonne.services.group_assignment_import import (
    AssignmentImportError,
    parse_group_assignments,
)

# The shape of a real template: an id, the typed groups, then formula columns beside them.
CRN_FORMULA = '=IF($E2="","",IFERROR(INDEX(FYS_CRN,MATCH("{block}|"&${column}2&"|{course}",FYS_KEY,0)),"group?"))'


def workbook(rows: list[list[object]], headers: list[str] | None = None) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = "FYS"
    sheet.append(headers or ["Student ID", "Name", "TD", "CM", "TD CRN", "CM CRN"])
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def template(rows: list[tuple[str, str, str]]) -> bytes:
    """Student id, TD group, CM group — with the formulas that name those columns."""
    built = [
        [
            student,
            "Ignored Name",
            td,
            cm,
            CRN_FORMULA.format(block="TD", column="C", course="MATH011"),
            CRN_FORMULA.format(block="CM", column="D", course="MATH001"),
        ]
        for student, td, cm in rows
    ]
    return workbook(built)


def test_a_students_typed_groups_are_read_per_block():
    report = parse_group_assignments(template([("A00021503", "3", "A")]))

    assert report.students == {"A00021503": {"TD": "3", "CM": "A"}}
    assert report.scopes_seen == {"TD", "CM"}
    assert report.sheets_read == ["FYS"]


def test_the_block_comes_from_the_formula_not_the_header():
    """A renamed column must not change which block a group belongs to."""
    rows = [
        [
            "A00021503",
            "Ignored",
            "3",
            "A",
            CRN_FORMULA.format(block="LANG", column="C", course="SCEN101"),
            CRN_FORMULA.format(block="CM", column="D", course="MATH001"),
        ]
    ]
    report = parse_group_assignments(workbook(rows, ["Student ID", "Name", "Anything", "At All", "x", "y"]))

    assert report.students == {"A00021503": {"LANG": "3", "CM": "A"}}


def test_several_courses_in_one_block_are_one_assignment_not_three():
    rows = [
        [
            "A00021503",
            "Ignored",
            "3",
            "",
            CRN_FORMULA.format(block="TD", column="C", course="MATH011"),
            CRN_FORMULA.format(block="TD", column="C", course="MATH009"),
        ]
    ]
    report = parse_group_assignments(workbook(rows))

    assert report.students == {"A00021503": {"TD": "3"}}
    assert report.assignment_count == 1


def test_a_student_with_nothing_typed_is_unfinished_work_not_an_assignment():
    report = parse_group_assignments(template([("A00021503", "3", "A"), ("A00021504", "", "")]))

    assert "A00021504" not in report.students
    assert report.blank_rows == 1


def test_a_student_half_filled_in_keeps_the_half_that_is_there():
    report = parse_group_assignments(template([("A00021503", "3", "")]))
    assert report.students == {"A00021503": {"TD": "3"}}


def test_student_ids_are_normalised_the_way_the_lookup_normalises_them():
    report = parse_group_assignments(template([(" a000 21503 ", "3", "A")]))
    assert "A00021503" in report.students


def test_a_workbook_with_no_formulas_is_refused_rather_than_read_as_empty():
    plain = workbook([["A00021503", "Ignored", "3", "A", "23652", "22151"]])
    with pytest.raises(AssignmentImportError, match="No group assignments"):
        parse_group_assignments(plain)


def test_something_that_is_not_a_workbook_says_so():
    with pytest.raises(AssignmentImportError, match="could not be read"):
        parse_group_assignments(b"not a workbook", "notes.txt")


def test_the_real_filled_template_reads(tmp_path):
    """Against the actual FYS template, so the fixture cannot drift from the real thing."""
    source = (
        "/Users/chriscay/Documents/scen-student-platform/sample-data/group-templates/"
        "FYS-Groups-26-27-S1_filled.xlsx"
    )
    try:
        content = open(source, "rb").read()  # noqa: SIM115, PTH123
    except FileNotFoundError:  # pragma: no cover - the sample lives in the other repo
        pytest.skip("the filled sample template is not checked out")

    report = parse_group_assignments(content, "FYS-Groups-26-27-S1_filled.xlsx")
    assert report.students
    assert report.scopes_seen
    # Every value read is a group label somebody typed, never a CRN.
    for groups in report.students.values():
        for label in groups.values():
            assert not (label.isdigit() and len(label) == 5)  # noqa: PLR2004
