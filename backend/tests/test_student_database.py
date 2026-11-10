"""Cohorts and their catalogue of groups and CRNs."""

import pytest
from uuid import uuid4

from sqlalchemy import text

from sorbonne.services.group_reference_import import parse_group_reference
from sorbonne.services.workbook_diff import diff_reference
from sorbonne.services.student_database import (
    CohortNotFound,
    CohortSpansSemesters,
    DuplicateLabel,
    InvalidCohortMove,
    InvalidRule,
    SavedSearch,
    SharedSetTaken,
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
    assert fields == {
        "id", "label", "capacity", "note", "parentGroupId", "parentGroupIds", "firstFor", "parallelWith", "majors",
        "byMajor", "assigned", "crns",
    }


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


def _since(database: StudentDatabase, student_id: str, cohort_id: str) -> str:
    """When the student was placed in that cohort, as their record says."""
    student = next(s for s in database.list_students() if s["studentId"] == student_id)
    return next(c["since"] for c in student["cohorts"] if c["id"] == cohort_id)


def test_placing_a_student_records_when(database: StudentDatabase, cohort: dict) -> None:
    _hold(database, "A001")

    database.set_cohort(["A001"], cohort["id"])

    assert _since(database, "A001", cohort["id"]), "placement should leave a moment behind"


def test_re_saving_a_student_into_the_same_cohort_is_not_a_placement(
    database: StudentDatabase, cohort: dict
) -> None:
    # The moment is the baseline "what changed since we put them here" is measured
    # from. Moving it on a no-op would silently forgive every change made in between.
    _hold(database, "A001")
    database.set_cohort(["A001"], cohort["id"])
    first = _since(database, "A001", cohort["id"])

    database.set_cohort(["A001"], cohort["id"])

    assert _since(database, "A001", cohort["id"]) == first


def test_moving_to_another_cohort_is_a_new_placement(database: StudentDatabase, cohort: dict) -> None:
    _hold(database, "A001")
    database.set_cohort(["A001"], cohort["id"])
    first = _since(database, "A001", cohort["id"])
    other = database.create_cohort(name="Elsewhere")

    database.set_cohort(["A001"], other["id"])

    student = next(s for s in database.list_students() if s["studentId"] == "A001")
    # Two cohorts of the same semester (neither names a term): the move takes them out of the first.
    assert [c["id"] for c in student["cohorts"]] == [other["id"]]
    assert _since(database, "A001", other["id"]) >= first


def test_a_cohort_holds_its_students_semester_by_semester(database: StudentDatabase) -> None:
    """L1 in Semester 1 and in Semester 2: moving them in one semester leaves the other alone."""
    # This file does not clear the record between tests, so the students are this test's own.
    a001 = f"S{uuid4().hex[:8].upper()}"
    _hold(database, a001)
    l1 = database.create_cohort(name="L1", term="2026-27")
    l2 = database.create_cohort(name="L2", term="2026-27")
    spring_set = database.add_scope(l1["id"], code="TD", name="Tutorials", term_id="spring")
    group = database.add_group(spring_set, label="1")

    database.set_cohort([a001], l1["id"], term_id="autumn")
    database.set_cohort([a001], l1["id"], term_id="spring")
    database.assign(student_id=a001, scope_id=spring_set, group_id=group)
    student = next(s for s in database.list_students() if s["studentId"] == a001)
    assert sorted((c["name"], c["termId"]) for c in student["cohorts"]) == [("L1", "autumn"), ("L1", "spring")]
    assert database.get_cohort(l1["id"])["memberCounts"] == {"autumn": 1, "spring": 1}

    # Into L2 for the autumn only: their spring in L1, and its group, stay.
    database.set_cohort([a001], l2["id"], term_id="autumn")
    student = next(s for s in database.list_students() if s["studentId"] == a001)
    assert sorted((c["name"], c["termId"]) for c in student["cohorts"]) == [("L1", "spring"), ("L2", "autumn")]
    assert [g["groupLabel"] for g in student["groups"]] == ["1"]

    # Out of their cohort in the spring: out of L1 there, and out of its group.
    database.set_cohort([a001], None, term_id="spring")
    student = next(s for s in database.list_students() if s["studentId"] == a001)
    assert [(c["name"], c["termId"]) for c in student["cohorts"]] == [("L2", "autumn")]
    assert student["groups"] == []


def test_a_set_takes_only_the_students_its_cohort_holds_in_its_semester(database: StudentDatabase) -> None:
    a001 = f"S{uuid4().hex[:8].upper()}"
    _hold(database, a001)
    l1 = database.create_cohort(name="L1", term="2026-27")
    database.set_cohort([a001], l1["id"], term_id="autumn")
    spring_set = database.add_scope(l1["id"], code="TD", name="Tutorials", term_id="spring")
    group = database.add_group(spring_set, label="1")

    placed = database.assign_many(scope_id=spring_set, student_ids=[a001], group_id=group)

    assert (placed["assigned"], placed["skipped"]) == (0, [a001]), "in L1 in the autumn, not yet in the spring"


def test_rolling_over_carries_a_cohorts_students_into_the_next_semester(database: StudentDatabase) -> None:
    a001, a002, a003, a004 = (f"R{uuid4().hex[:8].upper()}" for _ in range(4))
    for student in (a001, a002, a003):
        _hold(database, student)
    # Semesters of its own: the test database keeps other tests' memberships.
    autumn, spring = (f"{season}-{uuid4().hex[:6]}" for season in ("autumn", "spring"))
    with database.engine.begin() as connection:
        connection.execute(
            text("INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, '262720')"), {"t": spring}
        )
    l1 = database.create_cohort(name="L1", term="2026-27", terms=["262710"])
    database.set_cohort([a001, a002, a003], l1["id"], term_id=autumn)
    # A003 is already in another cohort in the spring, and stays there.
    l2 = database.create_cohort(name="L2", term="2026-27")
    database.set_cohort([a003], l2["id"], term_id=spring)

    rolled = database.roll_over(l1["id"], autumn, spring)

    assert rolled["cohort"]["id"] == l1["id"], "the same cohort, in another semester"
    assert (rolled["added"], rolled["skipped"]) == (2, [a003])
    assert rolled["cohort"]["memberCounts"] == {autumn: 3, spring: 2}, "nobody leaves the autumn"
    # The spring's portal term is now one the cohort expects, so the register checks it there.
    assert rolled["cohort"]["terms"] == ["262710", "262720"]

    # Again: only who is not in it yet.
    _hold(database, a004)
    database.set_cohort([a004], l1["id"], term_id=autumn)
    again = database.roll_over(l1["id"], autumn, spring)
    assert again["added"] == 1


def test_saving_a_cohorts_settings_after_a_roll_over_keeps_the_new_term(database: StudentDatabase) -> None:
    """The settings dialog sent back the terms it had opened with, without 262720: on 9 Nov
    2026 all four rolled-over cohorts listed 262710 alone. A term it holds students in stays."""
    student = f"R{uuid4().hex[:8].upper()}"
    _hold(database, student)
    autumn, spring = (f"{season}-{uuid4().hex[:6]}" for season in ("autumn", "spring"))
    with database.engine.begin() as connection:
        connection.execute(
            text("INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, '262720')"), {"t": spring}
        )
    l1 = database.create_cohort(name="L1", term="2026-27", terms=["262710"])
    database.set_cohort([student], l1["id"], term_id=autumn)
    database.roll_over(l1["id"], autumn, spring)

    database.update_cohort(l1["id"], name="L1", term="2026-27", notes="", terms=["262710"])

    assert database.get_cohort(l1["id"])["terms"] == ["262710", "262720"]
    assert next(c for c in database.list_cohorts() if c["id"] == l1["id"])["terms"] == ["262710", "262720"]


def test_a_cohort_is_not_rolled_over_into_the_semester_it_is_from(database: StudentDatabase) -> None:
    l1 = database.create_cohort(name="L1")
    with pytest.raises(InvalidCohortMove):
        database.roll_over(l1["id"], "autumn", "autumn")


@pytest.fixture
def two_semesters_of_fys(database: StudentDatabase):
    """FYS as on 9 Nov 2026: its students in both semesters, its sets in the autumn — one of
    them the languages, open to every cohort, with an L1 student placed in it — and a set
    of its own in the spring. Removed afterwards: a set open to every cohort left behind
    turns up in every other test's catalogue."""
    fys_student, l1_student = (f"F{uuid4().hex[:8].upper()}" for _ in range(2))
    _hold(database, fys_student, l1_student)
    autumn, spring = (f"{season}-{uuid4().hex[:6]}" for season in ("autumn", "spring"))
    fys = database.create_cohort(name="FYS", term="2026-27")
    l1 = database.create_cohort(name="L1", term="2026-27")
    database.set_cohort([fys_student], fys["id"], term_id=autumn)
    database.set_cohort([fys_student], fys["id"], term_id=spring)
    database.set_cohort([l1_student], l1["id"], term_id=autumn)
    td = database.add_scope(fys["id"], code="TD", term_id=autumn)
    database.assign(student_id=fys_student, scope_id=td, group_id=database.add_group(td, label="1"))
    lang = database.add_scope(fys["id"], code="LANG", term_id=autumn, open_to_all=True)
    french = database.add_group(lang, label="A0-F1")
    database.assign(student_id=fys_student, scope_id=lang, group_id=french)
    database.assign(student_id=l1_student, scope_id=lang, group_id=french)
    spring_td = database.add_scope(fys["id"], code="TD", term_id=spring)
    database.assign(student_id=fys_student, scope_id=spring_td, group_id=database.add_group(spring_td, label="1"))
    yield fys, l1, fys_student, l1_student, autumn, spring
    with database.engine.begin() as connection:
        connection.execute(text("DELETE FROM student_cohorts WHERE id = ANY(:ids)"), {"ids": [fys["id"], l1["id"]]})


def test_removing_a_cohort_from_one_semester_leaves_the_other_whole(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    fys, _l1, fys_student, l1_student, autumn, spring = two_semesters_of_fys

    taken = database.remove_from_semester(fys["id"], spring)

    sets = [each["code"] for each in taken["sets"]]
    assert (taken["members"], sets, taken["otherSemesters"]) == (1, ["TD"], [autumn])
    assert database.get_cohort(fys["id"])["memberCounts"] == {autumn: 1}
    # The autumn keeps its sets, and both students keep their French group.
    with database.engine.connect() as connection:
        autumn_sets = connection.execute(
            text("SELECT code FROM cohort_scopes WHERE cohort_id = :id ORDER BY code"), {"id": fys["id"]}
        ).scalars().all()
        french = connection.execute(
            text("""SELECT count(*) FROM group_assignments a JOIN cohort_scopes s ON s.id = a.scope_id
                    WHERE s.code = 'LANG' AND a.student_id = ANY(:ids)"""),
            {"ids": [fys_student, l1_student]},
        ).scalar()
    assert (autumn_sets, french) == (["LANG", "TD"], 2)


def test_what_a_semester_holds_is_counted_before_it_is_removed(database: StudentDatabase, two_semesters_of_fys) -> None:
    fys, _l1, _fys_student, _l1_student, autumn, spring = two_semesters_of_fys

    reach = database.semester_reach(fys["id"], autumn)

    assert (reach["members"], reach["placements"], reach["othersPlacements"]) == (1, 3, 1)
    assert sorted((each["code"], each["openToAll"]) for each in reach["sets"]) == [("LANG", True), ("TD", False)]
    assert reach["otherSemesters"] == [spring]


def test_a_cohort_holding_two_semesters_is_not_deleted_whole(database: StudentDatabase, two_semesters_of_fys) -> None:
    fys, *_rest, autumn, spring = two_semesters_of_fys

    with pytest.raises(CohortSpansSemesters):
        database.delete_cohort(fys["id"])
    assert database.get_cohort(fys["id"])["memberCounts"] == {autumn: 1, spring: 1}

    # Once only one semester is left, it can go.
    database.remove_from_semester(fys["id"], spring)
    database.delete_cohort(fys["id"])
    with pytest.raises(CohortNotFound):
        database.get_cohort(fys["id"])


def test_removing_l1_from_a_semester_counts_its_students_language_groups(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    """L1 has no set of its own in the autumn; its student's French group sits in FYS's LANG,
    filed under L1. Removing L1 from the autumn takes that group: it is counted beforehand."""
    _fys, l1, *_rest, autumn, _spring = two_semesters_of_fys

    reach = database.semester_reach(l1["id"], autumn)

    assert (reach["members"], reach["sets"], reach["sharedSets"], reach["sharedPlacements"]) == (1, [], ["LANG"], 1)


def test_a_cohort_whose_only_other_semester_is_a_language_group_is_not_deleted_whole(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    """Its student moved on in the spring but kept a French group filed under it there:
    deleting the cohort would take that group, so the spring still counts as held."""
    fys, l1, _fys_student, l1_student, autumn, spring = two_semesters_of_fys
    with database.engine.begin() as connection:
        lang = connection.execute(
            text("SELECT id FROM cohort_scopes WHERE cohort_id = :id AND code = 'LANG'"), {"id": fys["id"]}
        ).scalar()
        connection.execute(
            text("UPDATE cohort_scopes SET term_id = :spring WHERE id = :id"), {"spring": spring, "id": lang}
        )

    assert database.semester_reach(l1["id"], autumn)["otherSemesters"] == [spring]
    with pytest.raises(CohortSpansSemesters):
        database.delete_cohort(l1["id"])
    assert database.cohort_members(l1["id"], autumn) == {l1_student}


def test_a_language_set_takes_only_students_held_in_its_own_semester(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    """A student who joined in the spring is turned away from the autumn's French, and named."""
    fys, _l1, fys_student, _l1_student, _autumn, spring = two_semesters_of_fys
    newcomer = f"N{uuid4().hex[:8].upper()}"
    _hold(database, newcomer)
    database.set_cohort([newcomer], fys["id"], term_id=spring)
    with database.engine.connect() as connection:
        lang, french = connection.execute(
            text("""SELECT s.id, g.id FROM cohort_scopes s JOIN scope_groups g ON g.scope_id = s.id
                    WHERE s.cohort_id = :id AND s.code = 'LANG'"""),
            {"id": fys["id"]},
        ).one()

    report = database.assign_many(scope_id=lang, student_ids=[newcomer, fys_student], group_id=french)

    assert report["skipped"] == [newcomer]


def test_a_semester_holds_one_set_open_to_every_cohort_under_a_code(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    """FYS holds the autumn's LANG, open to every cohort; L1 may not make a second one there,
    which would split the languages between two sets. Its own LANG, or the spring's, is fine."""
    _fys, l1, *_rest, autumn, spring = two_semesters_of_fys

    with pytest.raises(SharedSetTaken, match="already open to every cohort this semester, on FYS"):
        database.add_scope(l1["id"], code="lang", term_id=autumn, open_to_all=True)
    own = database.add_scope(l1["id"], code="LANG", term_id=autumn)
    with pytest.raises(SharedSetTaken):
        database.update_scope(own, code="LANG", name="", note="", open_to_all=True)
    database.add_scope(l1["id"], code="LANG", term_id=spring, open_to_all=True)


def test_a_set_is_carried_into_another_semester_with_its_groups_and_exemptions(
    database: StudentDatabase, two_semesters_of_fys
) -> None:
    """The autumn's LANG made again in the spring: its course, its group with its sub-row,
    and the exemption of a student still held there — not its CRN, nor anybody's placement.
    The L1 student is in no cohort in the spring, so their exemption stays behind."""
    fys, _l1, fys_student, l1_student, autumn, spring = two_semesters_of_fys
    with database.engine.connect() as connection:
        lang, french = connection.execute(
            text("""SELECT s.id, g.id FROM cohort_scopes s JOIN scope_groups g ON g.scope_id = s.id
                    WHERE s.cohort_id = :id AND s.code = 'LANG'"""),
            {"id": fys["id"]},
        ).one()
    course = database.add_course(lang, code="FREN-101", name="French")
    database.set_cell(group_id=french, course_id=course, crn="23304", part=1)
    database.add_major(french, program="MATH - Mathematics", seats=12)
    database.set_exemption(student_id=fys_student, course_id=course, reason="Native speaker")
    database.set_exemption(student_id=l1_student, course_id=course, reason="Native speaker")

    carried = database.carry_scope(lang, spring)

    assert (carried["courses"], carried["groups"], carried["exemptions"]) == (1, 1, 1)
    with database.engine.connect() as connection:
        made = connection.execute(
            text("SELECT term_id, open_to_all FROM cohort_scopes WHERE id = :id"), {"id": carried["scopeId"]}
        ).one()
        cells = connection.execute(
            text("""SELECT count(*) FROM group_crns c JOIN scope_groups g ON g.id = c.group_id
                    WHERE g.scope_id = :id"""),
            {"id": carried["scopeId"]},
        ).scalar()
        placed = connection.execute(
            text("SELECT count(*) FROM group_assignments WHERE scope_id = :id"), {"id": carried["scopeId"]}
        ).scalar()
        seats = connection.execute(
            text("""SELECT m.program, m.seats FROM group_majors m JOIN scope_groups g ON g.id = m.group_id
                    WHERE g.scope_id = :id"""),
            {"id": carried["scopeId"]},
        ).all()
        exempt = connection.execute(
            text("""SELECT e.student_id, e.reason FROM course_exemptions e JOIN scope_courses c ON c.id = e.course_id
                    WHERE c.scope_id = :id"""),
            {"id": carried["scopeId"]},
        ).all()
    assert (made.term_id, made.open_to_all, cells, placed) == (spring, True, 0, 0)
    assert seats == [("MATH - Mathematics", 12)]
    assert exempt == [(fys_student, "Native speaker")]
    # Once there, it is not carried twice; nor into the semester it is from.
    with pytest.raises(DuplicateLabel):
        database.carry_scope(lang, spring)
    with pytest.raises(InvalidCohortMove):
        database.carry_scope(lang, autumn)


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


# ------------------------------------------------------------ workbook placements and sub-rows


def test_a_workbook_row_takes_the_sub_row_and_drops_the_old_one(database: StudentDatabase, cohort: dict) -> None:
    """The upload used to write no sub-row, and kept a stale one when a student changed group."""
    scope_id = database.add_scope(cohort["id"], code="CM", name="", note="")
    maths = database.add_group(scope_id, label="Mathematics")
    physics = database.add_group(scope_id, label="Physics")
    maths_row = database.add_major(maths, program="MATH - Mathematics")
    database.add_major(physics, program="PHYS - Physics")
    both = database.add_group(scope_id, label="1")
    both_maths = database.add_major(both, program="MATH - Mathematics")
    both_physics = database.add_major(both, program="PHYS - Physics")
    database.set_cohort(["A00000001"], cohort["id"])

    def placed_on() -> str:
        return database.assignment_majors_of(cohort["id"]).get("A00000001", {}).get(scope_id, "")

    # A group with one sub-row: that one, whatever the browser said.
    database.apply_workbook_changes(cohort["id"], "", [{"op": "place", "studentId": "A00000001", "groupId": maths}])
    assert placed_on() == maths_row

    # A group with two: the one named, when it is the group's own.
    database.apply_workbook_changes(
        cohort["id"], "", [{"op": "place", "studentId": "A00000001", "groupId": both, "majorId": both_physics}]
    )
    assert placed_on() == both_physics

    # Named nothing, or another group's: none — never the sub-row of the group they left.
    database.apply_workbook_changes(
        cohort["id"], "", [{"op": "place", "studentId": "A00000001", "groupId": both, "majorId": maths_row}]
    )
    assert placed_on() == ""
    assert both_maths
