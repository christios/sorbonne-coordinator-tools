"""Cohorts and their catalogue of groups and CRNs."""

import pytest
from uuid import uuid4

from sorbonne.services.group_reference_import import parse_group_reference
from sorbonne.services.workbook_diff import diff_reference
from sorbonne.services.student_database import (
    CohortNotFound,
    DuplicateLabel,
    InvalidRule,
    SavedSearch,
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


class TestSeedingFromAWorkbook:
    """What lands when a workbook's rows are approved.

    The bulk import that wrote on drop is gone; a workbook now reaches the catalogue only
    through the reviewed path, so what it carries has to survive that trip. The cohort
    style is exercised end to end in `test_workbook_api`; what is here is the language
    workbook, whose groups carry seats and a timetable note that nothing else would notice
    the loss of.
    """

    def test_the_language_workbook_keeps_its_seats(self, database: StudentDatabase, cohort: dict):
        report = parse_group_reference(workbook(LANGUAGE_HEADERS, LANGUAGE_ROWS), "LANG.xlsx")
        blocks = diff_reference(held={}, incoming=report)

        database.apply_workbook_changes(cohort["id"], "", [row for block in blocks for row in block["rows"]])

        group = group_of(scope_of(database.read_catalogue(cohort["id"]), "A0"), "A0-F1")
        assert group["capacity"] == A0_SEATS
        assert group["note"].startswith("Tuesday")


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
        cell = group_of(scope, "1")["crns"][course_id]
        assert cell == {**cell, **{"crn": "23223", "teacher": "Dr Ghantous"}}

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
    report = parse_group_reference(workbook(COHORT_HEADERS, COHORT_ROWS), "FYS.xlsx")
    blocks = diff_reference(held={}, incoming=report)
    database.apply_workbook_changes(cohort["id"], "", [row for block in blocks for row in block["rows"]])

    catalogue = database.read_catalogue(cohort["id"])

    fields = {key for scope in catalogue["scopes"] for group in scope["groups"] for key in group}

    # A programme a group prefers is the group's, not any student's.
    assert fields == {"id", "label", "capacity", "note", "program", "parentGroupId", "assigned", "crns"}


# ------------------------------------------------------------ discrepancies


def test_a_cohort_can_say_which_majors_terms_and_year_it_expects(database: StudentDatabase) -> None:
    made = database.create_cohort(
        name="L1 Maths", majors=["MATH", " PHYS ", "MATH", ""], terms=["262710", "262720"], year_level="L1"
    )

    # Codes as the portal writes them, each once, blanks dropped.
    assert made["majors"] == ["MATH", "PHYS"]
    assert made["terms"] == ["262710", "262720"]
    assert made["yearLevel"] == "L1"
    # And still may say nothing: a cohort with none is judged on status alone.
    plain = database.create_cohort(name="Foundation Year")
    assert (plain["majors"], plain["terms"], plain["yearLevel"]) == ([], [], "")


def test_a_cohort_expectation_can_be_changed(database: StudentDatabase, cohort: dict) -> None:
    changed = database.update_cohort(
        cohort["id"], name=cohort["name"], term=cohort["term"], notes="", majors=["PHYS"], year_level="L2"
    )

    assert (changed["majors"], changed["terms"], changed["yearLevel"]) == (["PHYS"], [], "L2")


def _hold(database: StudentDatabase, *ids: str) -> None:
    """Put students on the record the way a sync does, so they can be placed."""
    # Views are shared and this file does not clear them between tests, so each gets
    # its own rather than colliding on a name.
    view = database.save_filter(SavedSearch(name=f"hold {uuid4()}"))
    database.sync_view(view["id"], list(ids))


def test_placing_a_student_records_when(database: StudentDatabase, cohort: dict) -> None:
    _hold(database, "A001")

    database.set_cohort(["A001"], cohort["id"])

    student = next(s for s in database.list_students() if s["studentId"] == "A001")
    assert student["cohortSince"], "placement should leave a moment behind"


def test_re_saving_a_student_into_the_same_cohort_is_not_a_placement(
    database: StudentDatabase, cohort: dict
) -> None:
    # The moment is the baseline "what changed since we put them here" is measured
    # from. Moving it on a no-op would silently forgive every change made in between.
    _hold(database, "A001")
    database.set_cohort(["A001"], cohort["id"])
    first = next(s for s in database.list_students() if s["studentId"] == "A001")["cohortSince"]

    database.set_cohort(["A001"], cohort["id"])

    again = next(s for s in database.list_students() if s["studentId"] == "A001")["cohortSince"]
    assert again == first


def test_moving_to_another_cohort_is_a_new_placement(database: StudentDatabase, cohort: dict) -> None:
    _hold(database, "A001")
    database.set_cohort(["A001"], cohort["id"])
    first = next(s for s in database.list_students() if s["studentId"] == "A001")["cohortSince"]
    other = database.create_cohort(name="Elsewhere")

    database.set_cohort(["A001"], other["id"])

    moved = next(s for s in database.list_students() if s["studentId"] == "A001")["cohortSince"]
    assert moved >= first and moved != first or moved > first


def test_the_rules_are_kept_whole_and_in_order(database: StudentDatabase) -> None:
    database.replace_discrepancy_rules([])

    kept = database.replace_discrepancy_rules(
        [
            {"field": "STST_CODE", "kind": "changed_to", "values": ["WD", "IS"]},
            {"field": "ESTS_CODE", "kind": "changed"},
            {"field": "MAJOR_CODE_DESC", "kind": "differs"},
            {"field": "STST_CODE", "kind": "is", "values": ["WD"]},
            {"field": "ESTS_CODE", "kind": "is_not", "values": ["EL"]},
        ]
    )

    assert [(r["field"], r["kind"]) for r in kept] == [
        ("STST_CODE", "changed_to"),
        ("ESTS_CODE", "changed"),
        ("MAJOR_CODE_DESC", "differs"),
        ("STST_CODE", "is"),
        ("ESTS_CODE", "is_not"),
    ]
    assert kept[0]["values"] == ["WD", "IS"]
    # Kinds that do not take values carry none, whatever was sent.
    assert kept[1]["values"] == [] and kept[2]["values"] == []
    # A rule is everybody's unless it names a cohort.
    assert all(rule["cohortId"] == "" for rule in kept)
    assert database.list_discrepancy_rules() == kept


def test_a_rule_may_belong_to_one_cohort_and_goes_with_it(database: StudentDatabase, cohort: dict) -> None:
    kept = database.replace_discrepancy_rules(
        [
            {"field": "MAJOR_CODE", "kind": "moved_in", "cohortId": cohort["id"]},  # the old name, still read
            {"field": "STST_CODE", "kind": "changed"},
        ]
    )
    assert [rule["cohortId"] for rule in kept] == [cohort["id"], ""]
    assert (kept[0]["kind"], kept[0]["values"]) == ("belongs", [])

    database.delete_cohort(cohort["id"])

    assert [rule["field"] for rule in database.list_discrepancy_rules()] == ["STST_CODE"]


def test_replacing_the_rules_replaces_them(database: StudentDatabase) -> None:
    database.replace_discrepancy_rules([{"field": "STST_CODE", "kind": "changed"}])

    database.replace_discrepancy_rules([{"field": "ESTS_CODE", "kind": "changed"}])

    assert [r["field"] for r in database.list_discrepancy_rules()] == ["ESTS_CODE"]


def test_a_rule_keeps_its_id_across_a_replace(database: StudentDatabase) -> None:
    # Dismissals in a browser point at a rule by id; a re-save must not orphan them.
    [first] = database.replace_discrepancy_rules([{"field": "STST_CODE", "kind": "changed"}])

    [again] = database.replace_discrepancy_rules([{**first, "values": []}])

    assert again["id"] == first["id"]


@pytest.mark.parametrize(
    ("rule", "why"),
    [
        ({"field": "not a field", "kind": "changed"}, "field name"),
        ({"field": "STST_CODE", "kind": "sometimes"}, "kind"),
        ({"field": "STST_CODE", "kind": "differs"}, "no STST_CODE to differ from"),
        ({"field": "DEPT_CODE", "kind": "differs"}, "no DEPT_CODE to differ from"),
        ({"field": "STST_CODE", "kind": "belongs"}, "must be on MAJOR_CODE"),
        ({"field": "STST_CODE", "kind": "changed_to", "values": []}, "needs at least one value"),
        ({"field": "STST_CODE", "kind": "is", "values": ["", "  "]}, "needs at least one value"),
        ({"field": "STST_CODE", "kind": "is_not", "values": []}, "needs at least one value"),
    ],
)
def test_a_rule_that_cannot_mean_anything_is_refused(database: StudentDatabase, rule: dict, why: str) -> None:
    with pytest.raises(InvalidRule, match=why):
        database.replace_discrepancy_rules([rule])
