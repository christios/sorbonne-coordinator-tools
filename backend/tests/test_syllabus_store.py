import os

import pytest

from sorbonne.services.syllabus_store import FolderNotEmpty, RevisionConflict, SyllabusNotFound, SyllabusStore


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
    assert store.list()[0]["templateId"] == "scen-en-v1"


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
    populated_folder = store.create_folder(f"Populated folder {os.urandom(4).hex()}")
    syllabus = store.create(course_title="Climate Policy", course_code="SCEN-220", academic_year="2025-2026")
    store.move_to_folder(syllabus["id"], populated_folder["id"])

    store.delete_folder(empty_folder["id"])

    assert empty_folder not in store.list_folders()
    with pytest.raises(FolderNotEmpty):
        store.delete_folder(populated_folder["id"])
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
