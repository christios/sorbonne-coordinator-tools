"""Cohorts and their catalogue of groups and CRNs."""

import pytest

from sorbonne.services.group_reference_import import parse_group_reference
from sorbonne.services.student_database import (
    CohortNotFound,
    DuplicateLabel,
    StudentDatabase,
)
from tests.conftest import TEST_DATABASE_URL
from tests.test_group_reference_import import (
    COHORT_HEADERS,
    COHORT_ROWS,
    LANGUAGE_HEADERS,
    LANGUAGE_ROWS,
    workbook,
)

A0_SEATS = 30


@pytest.fixture
def database() -> StudentDatabase:
    """conftest migrates this database once per session."""
    return StudentDatabase(TEST_DATABASE_URL)


@pytest.fixture
def cohort(database: StudentDatabase) -> dict:
    return database.create_cohort(name="Foundation Year", term="S1 2026-27")


def scope_of(catalogue, code):
    return next(scope for scope in catalogue["scopes"] if scope["code"] == code)


def group_of(scope, label):
    return next(group for group in scope["groups"] if group["label"] == label)


class TestCohorts:
    def test_a_cohort_is_whatever_the_coordinator_names_it(self, database: StudentDatabase):
        created = database.create_cohort(name="L1 Physics — repeaters", term="S1 2026-27")

        assert created["name"] == "L1 Physics — repeaters"
        assert created["memberCount"] == 0
        assert created["scopeCount"] == 0
        assert created["id"] in {row["id"] for row in database.list_cohorts()}

    def test_renaming_and_deleting(self, database: StudentDatabase, cohort: dict):
        database.update_cohort(cohort["id"], name="Foundation Year", term="S2 2026-27", notes="second semester")

        assert database.get_cohort(cohort["id"])["term"] == "S2 2026-27"

        database.delete_cohort(cohort["id"])

        with pytest.raises(CohortNotFound):
            database.get_cohort(cohort["id"])

    def test_an_unknown_cohort_is_refused_rather_than_invented(self, database: StudentDatabase):
        with pytest.raises(CohortNotFound):
            database.read_catalogue("no-such-cohort")


class TestImportingAWorkbook:
    def test_a_reference_sheet_becomes_scopes_groups_and_crns(self, database: StudentDatabase, cohort: dict):
        report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")

        added = database.import_reference(cohort["id"], report)

        assert added == {"scopes": 2, "courses": 3, "groups": 5, "crns": 6}
        catalogue = database.read_catalogue(cohort["id"])
        assert [scope["code"] for scope in catalogue["scopes"]] == ["CM", "TD"]

    def test_a_group_arrives_as_the_bundle_it_is(self, database: StudentDatabase, cohort: dict):
        database.import_reference(
            cohort["id"], parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")
        )

        catalogue = database.read_catalogue(cohort["id"])
        scope = scope_of(catalogue, "CM")
        courses = {course["id"]: course["code"] for course in scope["courses"]}
        held = {courses[course_id]: cell["crn"] for course_id, cell in group_of(scope, "1")["crns"].items()}

        assert held == {"MATH001": "22151", "MATH009": "23364"}

    def test_the_language_workbook_keeps_its_seats(self, database: StudentDatabase, cohort: dict):
        report = parse_group_reference(workbook(LANGUAGE_HEADERS, LANGUAGE_ROWS), "LANG.xlsx")

        database.import_reference(cohort["id"], report)

        group = group_of(scope_of(database.read_catalogue(cohort["id"]), "A0"), "A0-F1")
        assert group["capacity"] == A0_SEATS
        assert group["note"].startswith("Tuesday")

    def test_reimporting_updates_crns_and_keeps_hand_added_groups(
        self, database: StudentDatabase, cohort: dict
    ):
        database.import_reference(
            cohort["id"], parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")
        )
        scope_id = scope_of(database.read_catalogue(cohort["id"]), "TD")["id"]
        database.add_group(scope_id, label="8")

        corrected = [list(row) for row in COHORT_ROWS]
        corrected[0][0] = 29999  # the registrar moved CM group 1's Pre-calculus CRN
        database.import_reference(
            cohort["id"], parse_group_reference(workbook(COHORT_HEADERS, corrected), "FYS.xlsx")
        )

        catalogue = database.read_catalogue(cohort["id"])
        crns = {cell["crn"] for cell in group_of(scope_of(catalogue, "CM"), "1")["crns"].values()}
        assert "29999" in crns
        assert "8" in {group["label"] for group in scope_of(catalogue, "TD")["groups"]}


class TestEditingTheCatalogue:
    @pytest.fixture
    def scope_id(self, database: StudentDatabase, cohort: dict) -> str:
        return database.add_scope(cohort["id"], code="TD", name="Tutorials")

    def test_a_scope_can_be_built_by_hand_without_any_workbook(
        self, database: StudentDatabase, cohort: dict, scope_id: str
    ):
        course_id = database.add_course(scope_id, code="MATH001", name="Pre-calculus 1", component="TD")
        group_id = database.add_group(scope_id, label="1", capacity=24)
        database.set_cell(group_id=group_id, course_id=course_id, crn="23223", teacher="Dr Ghantous")

        scope = scope_of(database.read_catalogue(cohort["id"]), "TD")
        assert scope["name"] == "Tutorials"
        assert group_of(scope, "1")["crns"][course_id] == {"crn": "23223", "teacher": "Dr Ghantous"}

    def test_two_groups_in_one_scope_cannot_share_a_label(self, database: StudentDatabase, scope_id: str):
        database.add_group(scope_id, label="1")

        with pytest.raises(DuplicateLabel):
            database.add_group(scope_id, label="1")

    def test_two_scopes_in_one_cohort_cannot_share_a_code(self, database: StudentDatabase, cohort: dict):
        database.add_scope(cohort["id"], code="TD")

        with pytest.raises(DuplicateLabel):
            database.add_scope(cohort["id"], code="TD")

    def test_clearing_a_cell_empties_it_rather_than_storing_a_blank(
        self, database: StudentDatabase, cohort: dict, scope_id: str
    ):
        course_id = database.add_course(scope_id, code="MATH001")
        group_id = database.add_group(scope_id, label="1")
        database.set_cell(group_id=group_id, course_id=course_id, crn="23223")

        database.set_cell(group_id=group_id, course_id=course_id, crn="  ")

        scope = scope_of(database.read_catalogue(cohort["id"]), "TD")
        assert group_of(scope, "1")["crns"] == {}

    def test_a_group_can_be_renamed_and_given_a_seat_limit(
        self, database: StudentDatabase, cohort: dict, scope_id: str
    ):
        group_id = database.add_group(scope_id, label="1")

        database.update_group(group_id, label="1A", capacity=18, note="Tuesday")

        group = group_of(scope_of(database.read_catalogue(cohort["id"]), "TD"), "1A")
        assert (group["capacity"], group["note"]) == (18, "Tuesday")

    def test_removing_a_group_takes_its_crns_with_it(
        self, database: StudentDatabase, cohort: dict, scope_id: str
    ):
        course_id = database.add_course(scope_id, code="MATH001")
        group_id = database.add_group(scope_id, label="1")
        database.set_cell(group_id=group_id, course_id=course_id, crn="23223")

        database.delete_group(group_id)

        assert scope_of(database.read_catalogue(cohort["id"]), "TD")["groups"] == []

    def test_deleting_a_scope_leaves_the_others_alone(self, database: StudentDatabase, cohort: dict):
        keep = database.add_scope(cohort["id"], code="CM")
        drop = database.add_scope(cohort["id"], code="TD")

        database.delete_scope(drop)

        assert [scope["id"] for scope in database.read_catalogue(cohort["id"])["scopes"]] == [keep]


def test_the_catalogue_carries_no_student_identity(database: StudentDatabase, cohort: dict):
    database.import_reference(
        cohort["id"], parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")
    )

    catalogue = database.read_catalogue(cohort["id"])

    fields = {key for scope in catalogue["scopes"] for group in scope["groups"] for key in group}

    assert fields == {"id", "label", "capacity", "note", "assigned", "crns"}
