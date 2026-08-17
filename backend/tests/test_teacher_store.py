import os
from uuid import uuid4

import pytest

from sorbonne.services.teacher_store import FolderNotEmpty, TeacherStore


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
