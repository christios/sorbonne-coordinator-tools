import os

import pytest

from sorbonne.services.syllabus_store import FolderNotEmpty, RevisionConflict, SyllabusNotFound, SyllabusStore
from sorbonne.services.syllabus_templates import FYS_TEMPLATE_ID, get_template
from sorbonne.services.fys_syllabus import INSTRUCTOR_AVAILABILITY_FIELD, cross_template_rows


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def make_store() -> SyllabusStore:
    return SyllabusStore(TEST_DATABASE_URL)


def test_creates_updates_duplicates_and_compares_yearly_syllabi() -> None:
    store = make_store()
    first = store.create(
        course_title="Environmental Science",
        course_code="SCEN-101",
        academic_year="2025-2026",
    )

    updated = store.update(
        first["id"],
        expected_revision=first["revision"],
        content={"description": {"overview": "An introductory course."}},
    )
    second = store.create(
        course_title="Environmental Science",
        course_code="SCEN-101",
        academic_year="2026-2027",
        source_syllabus_id=updated["id"],
    )
    current = store.update(
        second["id"],
        expected_revision=second["revision"],
        content={"description": {"overview": "An applied introductory course."}},
    )

    assert second["seriesId"] == updated["seriesId"]
    assert store.get(updated["id"])["content"]["description"]["overview"] == "An introductory course."

    comparison = store.compare(updated["id"], current["id"])

    assert comparison["left"]["academicYear"] == "2025-2026"
    assert comparison["right"]["academicYear"] == "2026-2027"
    assert comparison["changes"][0]["path"] == "description.overview"
    assert comparison["changes"][0]["label"] == "Course description"
    assert comparison["changes"][0]["kind"] == "changed"


def test_assigns_the_approved_template_to_new_and_duplicated_syllabi() -> None:
    store = make_store()
    first = store.create(
        course_title="Environmental Science",
        course_code="SCEN-101",
        academic_year="2025-2026",
    )
    duplicate = store.create(
        course_title="Environmental Science",
        course_code="SCEN-101",
        academic_year="2026-2027",
        source_syllabus_id=first["id"],
    )

    assert first["templateId"] == "scen-en-v1"
    assert duplicate["templateId"] == first["templateId"]
    assert next(item for item in store.list() if item["id"] == duplicate["id"])["templateId"] == "scen-en-v1"


def test_creates_an_fys_duplicate_in_the_same_series_with_mapped_content() -> None:
    store = make_store()
    source = store.create(course_title="Environmental Science", course_code="SCEN-101", academic_year="2025-2026")
    source = store.update(
        source["id"],
        expected_revision=source["revision"],
        content={
            "description": {"overview": "An introductory environmental science course."},
            "learningOutcomes": {"clos": [{"id": "clo-1", "clo": "CLO 1: Explain ecosystems."}]},
            "schedule": [{"id": "session-1", "topic": "Ecosystems"}],
        },
    )

    duplicate = store.create(
        course_title="Environmental Science",
        course_code="FYS-101",
        academic_year="2026-2027",
        source_syllabus_id=source["id"],
        template_id=FYS_TEMPLATE_ID,
    )

    assert duplicate["seriesId"] == source["seriesId"]
    assert duplicate["templateId"] == FYS_TEMPLATE_ID
    assert duplicate["content"]["description"]["overview"] == "An introductory environmental science course."
    assert duplicate["content"]["learningOutcomes"]["clos"][0]["outcome"] == "CLO 1: Explain ecosystems."
    assert duplicate["content"]["schedule"][0]["topic"] == "Ecosystems"
    assert get_template(FYS_TEMPLATE_ID).document_path.exists()


def test_scen_to_fys_duplicate_carries_mapped_faculty_and_approval_values() -> None:
    store = make_store()
    source = store.create(course_title="Environmental Science", course_code="SCEN-101", academic_year="2025-2026")
    source = store.update(
        source["id"],
        expected_revision=source["revision"],
        content={
            "contacts": {
                "instructor": {
                    "Name": "Dr Example",
                    "Academic rank / status": "Associate Professor",
                    "Affiliation(s)": "SUAD",
                    "Office hours and location": "Monday · 10:00",
                    "Email": "example@sorbonne.ae",
                }
            },
            "documentControl": {"approver": "Professor Head", "approvalDate": "2026-01-01"},
        },
    )

    duplicate = store.create(
        course_title="Environmental Science",
        course_code="FYS-101",
        academic_year="2026-2027",
        source_syllabus_id=source["id"],
        template_id=FYS_TEMPLATE_ID,
    )

    assert duplicate["content"]["facultyDetails"]["staffText"] == "Dr Example · Associate Professor"
    assert duplicate["content"]["facultyDetails"]["institution"] == "SUAD"
    assert duplicate["content"]["signatures"]["courseInstructorName"] == "Dr Example"
    assert duplicate["content"]["signatures"]["hodName"] == "Professor Head"
    assert duplicate["content"]["signatures"]["hodApprovalDate"] == "2026-01-01"


def test_compares_fys_and_scen_versions_with_mapped_and_one_sided_rows() -> None:
    store = make_store()
    scen = store.create(course_title="Environmental Science", course_code="SCEN-101", academic_year="2025-2026")
    scen = store.update(
        scen["id"],
        expected_revision=scen["revision"],
        content={"description": {"overview": "Original description."}, "assessment": {"aiPolicy": "AI Prohibited"}},
    )
    fys = store.create(
        course_title="Environmental Science",
        course_code="FYS-101",
        academic_year="2026-2027",
        source_syllabus_id=scen["id"],
        template_id=FYS_TEMPLATE_ID,
    )
    fys = store.update(
        fys["id"],
        expected_revision=fys["revision"],
        content={
            **fys["content"],
            "description": {"overview": "Updated description."},
            "courseDetails": {"courseWeight": "4"},
        },
    )

    comparison = store.compare(scen["id"], fys["id"])

    assert any(row["label"] == "Course description" and row["status"] == "mapped" for row in comparison["rows"])
    assert any(row["label"] == "AI policy" and row["status"] == "left-only" for row in comparison["rows"])
    assert any(row["label"] == "Course weight" and row["status"] == "right-only" for row in comparison["rows"])


def test_cross_template_comparison_does_not_repeat_mapped_fys_course_details() -> None:
    store = make_store()
    scen = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    scen = store.update(
        scen["id"],
        expected_revision=scen["revision"],
        content={
            "identification": {
                "programmeTitle": "Bachelor in Public Affairs",
                "degreeLevelAndSemester": "Bachelor 3, Semester 2",
                "prerequisites": "Introduction to Public Affairs",
            }
        },
    )
    fys = store.create(
        course_title="Climate Policy",
        course_code="FYS-220",
        academic_year="2026-2027",
        source_syllabus_id=scen["id"],
        template_id=FYS_TEMPLATE_ID,
    )

    rows = store.compare(scen["id"], fys["id"])["rows"]
    labels = [row["label"] for row in rows]

    assert labels.count("Semester") == 1
    assert labels.count("Prerequisites and co-requisites") == 1
    assert "Foundationyear" not in labels


def test_cross_template_comparison_maps_shared_sections_and_retains_real_template_only_fields() -> None:
    scen = {
        "identification": {"contactHours": {"Lectures": "12", "Tutorials": "6", "Laboratory": "6"}},
        "contacts": {
            "instructor": {
                "Name": "Dr Example",
                "Academic Rank / Status": "Associate Professor",
                "Email": "example@sorbonne.ae",
                f"{INSTRUCTOR_AVAILABILITY_FIELD}.": "By appointment",
            }
        },
        "bibliography": {"books": [{"id": "book-1", "title": "Climate Law"}]},
        "assessment": {
            "items": [{"id": "assessment-1", "type": "Essay", "weight": "40", "clos": "CLO 1"}],
            "aiPolicy": "AI Prohibited",
        },
        "learningOutcomes": {"plos": [{"id": "plo-1", "outcome": "PLO 1"}]},
        "documentControl": {"approvalDate": "2026-01-01", "approver": "Head of Department"},
    }
    fys = {
        "courseDetails": {"contactHours": {"Lectures": "12", "Tutorials / Labs": "6"}, "courseWeight": "20"},
        "facultyDetails": {
            "staffText": "Dr Example · Associate Professor",
            "email": "example@sorbonne.ae",
            "officePhone": "02 000 0000",
        },
        "requiredMaterials": {"books": [{"id": "different-id", "title": "Climate Law"}]},
        "assessment": {
            "continuous": [
                {
                    "id": "different-assessment-id",
                    "description": "Essay",
                    "weight": "40",
                    "clos": "CLO 1",
                    "component": "Report",
                }
            ]
        },
        "signatures": {"hodApprovalDate": "2026-01-01", "hodName": "Head of Department"},
    }

    rows = cross_template_rows("scen-en-v1", scen, FYS_TEMPLATE_ID, fys)
    by_label = {row["label"]: row for row in rows}

    assert by_label["Contact hours · Lectures"]["status"] == "mapped"
    assert by_label["Instructor name and status"]["status"] == "mapped"
    assert by_label["Instructor name and status"]["kind"] == "unchanged"
    assert "Academic Rank / Status" not in by_label
    assert by_label["Supplemental books"]["status"] == "mapped"
    assert by_label["Assessment 1 · Description"]["status"] == "mapped"
    assert by_label["Assessment 1 · Weight"]["status"] == "mapped"
    assert by_label["Approval date"]["status"] == "mapped"
    assert by_label["Programme learning outcomes"]["status"] == "left-only"
    assert by_label["AI policy"]["status"] == "left-only"
    assert by_label["Course weight"]["status"] == "right-only"
    assert by_label["Office phone"]["status"] == "right-only"
    assert by_label["Instructor availability note"]["status"] == "left-only"


def test_rejects_stale_updates() -> None:
    store = make_store()
    syllabus = store.create(course_title="Chemistry", course_code="SCEN-120", academic_year="2025-2026")
    store.update(syllabus["id"], expected_revision=syllabus["revision"], content={"course": {"ects": "6"}})

    with pytest.raises(RevisionConflict):
        store.update(syllabus["id"], expected_revision=syllabus["revision"], content={"course": {"ects": "3"}})


def test_organizes_syllabi_in_folders_and_deletes_them() -> None:
    store = make_store()
    first = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    second = store.create(course_title="Environmental Law", course_code="SCEN-240", academic_year="2025-2026")

    folder = store.create_folder(f"Climate courses {first['id']}")
    moved = store.move_to_folder(first["id"], folder["id"])

    assert moved["folderId"] == folder["id"]
    assert store.list()[0]["folderId"] in {None, folder["id"]}
    assert folder in store.list_folders()

    store.delete(first["id"])

    with pytest.raises(SyllabusNotFound):
        store.get(first["id"])
    remaining_ids = {item["id"] for item in store.list()}
    assert second["id"] in remaining_ids
    assert first["id"] not in remaining_ids


def test_deletes_empty_folders_but_protects_folders_that_contain_syllabi() -> None:
    store = make_store()
    empty_folder = store.create_folder(f"Empty folder {os.urandom(4).hex()}")
    parent_folder = store.create_folder(f"Programme {os.urandom(4).hex()}")
    populated_folder = store.create_folder(f"Populated folder {os.urandom(4).hex()}", parent_id=parent_folder["id"])
    syllabus = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    store.move_to_folder(syllabus["id"], populated_folder["id"])

    store.delete_folder(empty_folder["id"])

    assert empty_folder not in store.list_folders()
    assert populated_folder["parentId"] == parent_folder["id"]
    assert store.list_folders()[-1]["parentId"] in {None, parent_folder["id"]}
    with pytest.raises(FolderNotEmpty):
        store.delete_folder(populated_folder["id"])
    with pytest.raises(FolderNotEmpty):
        store.delete_folder(parent_folder["id"])
    assert populated_folder in store.list_folders()


def test_coalesces_rapid_changes_to_the_same_field() -> None:
    store = make_store()
    syllabus = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    first_edit = store.update(
        syllabus["id"],
        expected_revision=syllabus["revision"],
        content={"description": {"overview": "An introductory course."}},
    )
    store.update(
        syllabus["id"],
        expected_revision=first_edit["revision"],
        content={"description": {"overview": "An applied introductory course."}},
    )

    history = store.field_history(syllabus["id"], "description.overview")

    assert [item["newValue"] for item in history] == ["An applied introductory course."]
    assert history[0]["previousValue"] == ""
    assert history[0]["revision"] == first_edit["revision"] + 1
    assert {operation["type"] for operation in history[0]["operations"]} == {"insert"}


def test_exposes_legacy_plo_conversion_in_the_row_field_history(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sorbonne.services.syllabus_store.FIELD_HISTORY_COALESCE_SECONDS", 0)
    store = make_store()
    syllabus = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    original_outcome = "PLO 1: Explain climate policy."
    legacy = store.update(
        syllabus["id"],
        expected_revision=syllabus["revision"],
        content={"learningOutcomes": {"plos": [original_outcome]}},
    )
    store.update(
        syllabus["id"],
        expected_revision=legacy["revision"],
        content={"learningOutcomes": {"plos": [{"id": "legacy-plo-0", "legacyText": "Explain climate policy."}]}},
    )

    history = store.field_history(syllabus["id"], "learningOutcomes.plos[legacy-plo-0].legacyText")

    assert history[0]["previousValue"] == original_outcome
    assert history[0]["newValue"] == "Explain climate policy."


def test_compares_repeatable_rows_by_their_stable_ids() -> None:
    store = make_store()
    first = store.create(course_title="Ecology", course_code="SCEN-210", academic_year="2025-2026")
    first = store.update(
        first["id"],
        expected_revision=first["revision"],
        content={"schedule": [{"id": "session-1", "topic": "Ecosystems"}]},
    )
    second = store.create(
        course_title="Ecology", course_code="SCEN-210", academic_year="2026-2027", source_syllabus_id=first["id"]
    )
    second = store.update(
        second["id"],
        expected_revision=second["revision"],
        content={"schedule": [{"id": "session-1", "topic": "Applied ecosystems"}]},
    )

    assert store.compare(first["id"], second["id"])["changes"][0]["path"] == "schedule[session-1].topic"


def test_compares_text_with_word_level_insert_delete_and_substitute_operations() -> None:
    store = make_store()
    first = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    first = store.update(
        first["id"],
        expected_revision=first["revision"],
        content={"description": {"overview": "Climate law follows rules removed"}},
    )
    second = store.create(
        course_title="Climate Policy", course_code="SCEN-220", academic_year="2026-2027", source_syllabus_id=first["id"]
    )
    second = store.update(
        second["id"],
        expected_revision=second["revision"],
        content={"description": {"overview": "Climate policy follows modern rules"}},
    )

    change = store.compare(first["id"], second["id"])["changes"][0]

    assert {operation["type"] for operation in change["operations"]} >= {"insert", "delete", "substitute"}
