"""Reading a group-assignment workbook's Reference sheet.

The fixtures are miniatures of the real 26-27 workbooks: the same headers, the same
helper-key column, one or two rows per block. The real files live outside the repository
and carry teacher names, so they are not committed.
"""

from io import BytesIO

import pytest
from openpyxl import Workbook

from sorbonne.services.group_reference_import import (
    ReferenceImportError,
    parse_group_reference,
)

COHORT_HEADERS = [
    "CRN", "Group", "Scope", "Course Code", "Course Name", "Component",
    "Teacher", "Tab", "Group column", "Helper key",
]
LANGUAGE_HEADERS = [
    "CRN", "Language group", "Level", "Group", "Open to", "Day", "Time",
    "Teacher", "Capacity", "Comments", "Helper key",
]

# Foundation Year: one CM block of two groups, one TD block of two, both over two courses.
COHORT_ROWS = [
    [22151, "1", "CM", "MATH001", "Pre-calculus 1", "CM", "Dr Bilal Maaz", "MATH& PHYS CM", "CM group", "CM|1|MATH001"],
    [23364, "1", "CM", "MATH009", "Linear Algebra", "CM", "Dr Samar Ghantous", "MATH& PHYS CM", "CM group",
     "CM|1|MATH009"],
    [23561, "2", "CM", "MATH001", "Pre-calculus 1", "CM", "Dr Bilal Maaz", "MATH& PHYS CM", "CM group", "CM|2|MATH001"],
    [23223, "1", "TD", "MATH001", "Pre-calculus 1", "TD", "Dr Samar Ghantous", "TD", "TD group", "TD|1|MATH001"],
    [23425, "10", "TD", "MATH001", "Pre-calculus 1", "TD", "Mme Cecile Pallot", "TD", "TD group", "TD|10|MATH001"],
    [23224, "2", "TD", "MATH001", "Pre-calculus 1", "TD", "Dr Jad Tarsissi", "TD", "TD group", "TD|2|MATH001"],
]

A0_SEATS = 30

LANGUAGE_ROWS = [
    [23302, "A0-F1", "A0", "F1", "FYS", "Tuesday", "4:30-6:00", "Karima Bendjaballah", 30, None, "A0|F1"],
    [23827, "A0-G1", "A0", "G1", "L1", "Wednesday", "4:30-6:00", "Sara Zaki", 30, None, "A0|G1"],
    [23304, "A1-G1", "A1", "G1", "Mixed", "Wednesday", "4:30-6:00", "Karima Bendjaballah", 24, None, "A1|G1"],
]


def workbook(headers, rows, *, sheet_name="Reference", preamble=3) -> bytes:
    """A Reference sheet with the real files' explanatory rows above the header."""
    book = Workbook()
    sheet = book.active
    sheet.title = sheet_name
    for _ in range(preamble):
        sheet.append(["Foundation Year — Reference: CRN ⇄ group"])
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def scope_of(report, code):
    return next(scope for scope in report.scopes if scope.code == code)


def group_of(scope, label):
    return next(group for group in scope.groups if group.label == label)


class TestCohortWorkbooks:
    def test_a_group_is_the_bundle_of_crns_it_stands_for(self):
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        assert report.style == "cohort"
        assert group_of(scope_of(report, "CM"), "1").crns == {
            "MATH001": ("22151", "Dr Bilal Maaz"),
            "MATH009": ("23364", "Dr Samar Ghantous"),
        }

    def test_each_block_keeps_its_own_groups_and_courses(self):
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        assert [scope.code for scope in report.scopes] == ["CM", "TD"]
        assert [course.code for course in scope_of(report, "CM").courses] == ["MATH001", "MATH009"]
        assert [course.code for course in scope_of(report, "TD").courses] == ["MATH001"]

    def test_the_same_label_in_two_blocks_is_two_different_groups(self):
        # "Group 1" of CM and "group 1" of TD are different students and different CRNs.
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        assert group_of(scope_of(report, "CM"), "1").crns["MATH001"][0] == "22151"
        assert group_of(scope_of(report, "TD"), "1").crns["MATH001"][0] == "23223"

    def test_groups_are_ordered_the_way_a_person_counts(self):
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        assert [group.label for group in scope_of(report, "TD").groups] == ["1", "2", "10"]

    def test_the_courses_and_teachers_come_across(self):
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        course = scope_of(report, "CM").courses[0]
        assert (course.name, course.component) == ("Pre-calculus 1", "CM")
        assert report.crn_count == len(COHORT_ROWS)

    def test_blank_rows_under_the_table_are_ignored(self):
        rows = [*COHORT_ROWS, [None] * len(COHORT_HEADERS), ["", "", "", "", "", "", "", "", "", ""]]

        report = parse_group_reference(workbook(COHORT_HEADERS, rows), "FYS.xlsx")

        assert report.crn_count == len(COHORT_ROWS)


class TestLanguageWorkbooks:
    def test_the_level_is_the_block_and_the_language_group_is_the_group(self):
        report = parse_group_reference(workbook(LANGUAGE_HEADERS, LANGUAGE_ROWS), "LANG.xlsx")

        assert report.style == "language"
        assert [scope.code for scope in report.scopes] == ["A0", "A1"]
        assert [group.label for group in scope_of(report, "A0").groups] == ["A0-F1", "A0-G1"]

    def test_one_class_per_group_becomes_a_single_column(self):
        report = parse_group_reference(workbook(LANGUAGE_HEADERS, LANGUAGE_ROWS), "LANG.xlsx")

        assert [course.code for course in scope_of(report, "A0").courses] == ["CLASS"]
        assert group_of(scope_of(report, "A0"), "A0-F1").crns["CLASS"] == ("23302", "Karima Bendjaballah")

    def test_capacity_and_the_practical_details_are_kept(self):
        report = parse_group_reference(workbook(LANGUAGE_HEADERS, LANGUAGE_ROWS), "LANG.xlsx")

        group = group_of(scope_of(report, "A0"), "A0-F1")
        assert group.capacity == A0_SEATS
        assert group.note == "Tuesday · 4:30-6:00 · open to FYS"


class TestRefusals:
    def test_a_workbook_with_no_reference_sheet_says_so(self):
        content = workbook(COHORT_HEADERS, COHORT_ROWS, sheet_name="TD")

        with pytest.raises(ReferenceImportError, match="no Reference sheet"):
            parse_group_reference(content, "FYS.xlsx")

    def test_a_reference_sheet_with_neither_scope_nor_level_is_refused(self):
        content = workbook(["CRN", "Group", "Course Code"], [[1, "1", "MATH001"]])

        with pytest.raises(ReferenceImportError, match="neither a Scope column nor a Level column"):
            parse_group_reference(content, "odd.xlsx")

    def test_a_header_with_nothing_under_it_is_refused(self):
        with pytest.raises(ReferenceImportError, match="no CRNs under it"):
            parse_group_reference(workbook(COHORT_HEADERS, []), "empty.xlsx")

    def test_something_that_is_not_a_workbook_is_refused(self):
        with pytest.raises(ReferenceImportError, match="could not be read as an Excel workbook"):
            parse_group_reference(b"not a workbook", "notes.txt")
