import os
from uuid import uuid4

import pytest

from sorbonne.services.teacher_store import (
    FolderNotEmpty,
    InvalidTimeSheetLink,
    TeacherStore,
    TimeSheetNotFound,
)


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def test_creates_archives_and_organizes_teachers_with_labelled_requisitions() -> None:
    store = TeacherStore(TEST_DATABASE_URL)
    folder = store.create_folder(f"Physics {uuid4()}")
    teacher = store.create_teacher(
        full_name="Dr Amira Example", email="amira@example.edu", phone="+971", notes="Returning lecturer"
    )

    moved = store.move_teacher_to_folder(teacher["id"], folder["id"])
    first = store.create_requisition(teacher["id"], label="Physics TD contract", academic_year="2026-2027")
    second = store.create_requisition(
        teacher["id"], label="Spring extension", academic_year="2026-2027", source_requisition_id=first["id"]
    )

    assert teacher["id"]
    assert moved["folderId"] == folder["id"]
    assert [item["label"] for item in store.list_requisitions(teacher["id"])] == [
        "Spring extension",
        "Physics TD contract",
    ]
    assert second["content"] == first["content"]
    with pytest.raises(FolderNotEmpty):
        store.delete_folder(folder["id"])

    archived = store.archive_teacher(teacher["id"])
    assert archived["archivedAt"] is not None
    assert teacher["id"] not in {item["id"] for item in store.list_teachers(include_archived=False)}
    assert teacher["id"] in {item["id"] for item in store.list_teachers(include_archived=True)}
    assert store.restore_teacher(teacher["id"])["archivedAt"] is None


def test_a_teacher_keeps_labelled_links_to_their_time_sheets() -> None:
    """The workbook lives in OneDrive; the profile keeps the label and the address.

    Ordered newest academic year first, the way the requisitions beside them are, so the
    sheet somebody wants is the one at the top.
    """
    store = TeacherStore(TEST_DATABASE_URL)
    teacher = store.create_teacher(full_name=f"Dr Time Sheet {uuid4()}")

    first = store.create_time_sheet(
        teacher["id"],
        label="Semester 1",
        academic_year="2025-2026",
        url="https://sorbonne-my.sharepoint.com/:x:/g/personal/a/EabcOld",
    )
    store.create_time_sheet(
        teacher["id"],
        label="Semester 2",
        academic_year="2026-2027",
        url="  https://sorbonne-my.sharepoint.com/:x:/g/personal/a/Eabc?e=1  ",
    )

    held = store.list_time_sheets(teacher["id"])
    assert [(sheet["label"], sheet["academicYear"]) for sheet in held] == [
        ("Semester 2", "2026-2027"),
        ("Semester 1", "2025-2026"),
    ]
    # Surrounding whitespace from a paste is not part of the address.
    assert held[0]["url"] == "https://sorbonne-my.sharepoint.com/:x:/g/personal/a/Eabc?e=1"

    corrected = store.update_time_sheet(
        first["id"], label="Semester 1 (final)", academic_year="2025-2026", url="https://example.org/new"
    )
    assert corrected["url"] == "https://example.org/new"
    assert store.get_time_sheet(first["id"])["label"] == "Semester 1 (final)"

    store.delete_time_sheet(first["id"])
    assert [sheet["label"] for sheet in store.list_time_sheets(teacher["id"])] == ["Semester 2"]
    with pytest.raises(TimeSheetNotFound):
        store.get_time_sheet(first["id"])


def test_a_time_sheet_link_must_be_a_web_address() -> None:
    """Not tidiness: a stored `javascript:` address would run as script the moment a
    coordinator clicked the teacher's name for it."""
    store = TeacherStore(TEST_DATABASE_URL)
    teacher = store.create_teacher(full_name=f"Dr Bad Link {uuid4()}")

    for bad in ("javascript:alert(1)", r"C:\\Users\\me\\time sheet.xlsx", "sorbonne-my.sharepoint.com/x", ""):
        with pytest.raises(InvalidTimeSheetLink):
            store.create_time_sheet(teacher["id"], label="Semester 1", academic_year="2026-2027", url=bad)

    with pytest.raises(ValueError, match="label"):
        store.create_time_sheet(
            teacher["id"], label="   ", academic_year="2026-2027", url="https://example.org/sheet"
        )
    assert store.list_time_sheets(teacher["id"]) == []
