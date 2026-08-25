import os
from uuid import uuid4

import pytest
from sqlalchemy import text

from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.workflow_store import (
    QuickTemplateNotFound,
    TaskNotFound,
    TaskRevisionConflict,
    WorkflowStore,
)


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def test_field_notes_are_isolated_by_resource_and_field() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    first = store.upsert_field_note(
        resource_type="teacher", resource_id=str(uuid4()), field_key="email", content="Use university address."
    )
    second = store.upsert_field_note(
        resource_type="teacher", resource_id=str(uuid4()), field_key="email", content="Different teacher."
    )
    updated = store.upsert_field_note(
        resource_type="teacher", resource_id=first["resourceId"], field_key="email", content="Confirmed with HR."
    )

    assert updated["id"] == first["id"]
    assert [note["content"] for note in store.list_field_notes("teacher", first["resourceId"])] == [
        "Confirmed with HR."
    ]
    assert [note["content"] for note in store.list_field_notes("teacher", second["resourceId"])] == [
        "Different teacher."
    ]


def test_teacher_onboarding_template_creates_tasks_and_tasks_survive_archiving() -> None:
    teachers = TeacherStore(TEST_DATABASE_URL)
    workflow = WorkflowStore(TEST_DATABASE_URL)
    teacher = teachers.create_teacher(full_name=f"Task teacher {uuid4()}", task_template_ids=["teacher-onboarding"])

    tasks = workflow.list_tasks("teacher", teacher["id"])
    assert [task["title"] for task in tasks] == [
        "CID Clearance",
        "Requisition signature",
        "ID Issuance (for newcomers)",
    ]

    completed = workflow.update_task(
        tasks[0]["id"], expected_revision=1, title=tasks[0]["title"], due_date="2026-09-01", status="COMPLETED"
    )
    assert completed["completedAt"] is not None
    reopened = workflow.update_task(
        completed["id"],
        expected_revision=completed["revision"],
        title=completed["title"],
        due_date=completed["dueDate"],
        status="NOT_STARTED",
    )
    assert reopened["completedAt"] is None
    assert reopened["status"] == "NOT_STARTED"
    with pytest.raises(TaskRevisionConflict):
        workflow.update_task(
            completed["id"], expected_revision=1, title=completed["title"], due_date=None, status="COMPLETED"
        )

    teachers.archive_teacher(teacher["id"])
    assert len(workflow.list_tasks("teacher", teacher["id"])) == len(tasks)


def test_onboarding_template_can_be_applied_to_an_existing_teacher_once() -> None:
    teachers = TeacherStore(TEST_DATABASE_URL)
    workflow = WorkflowStore(TEST_DATABASE_URL)
    teacher = teachers.create_teacher(full_name=f"Existing teacher {uuid4()}")

    created = workflow.apply_task_template(
        resource_type="teacher",
        resource_id=teacher["id"],
        template_id="teacher-onboarding",
    )
    repeated = workflow.apply_task_template(
        resource_type="teacher",
        resource_id=teacher["id"],
        template_id="teacher-onboarding",
    )

    assert [task["title"] for task in created] == [
        "CID Clearance",
        "Requisition signature",
        "ID Issuance (for newcomers)",
    ]
    assert repeated == []
    assert len(workflow.list_tasks("teacher", teacher["id"])) == len(created)


def test_custom_tasks_can_be_created() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    task = store.create_task(resource_type="teacher", resource_id=str(uuid4()), title="Collect bank details")
    assert task["status"] == "NOT_STARTED"
    assert task["templateItemId"] is None


def test_tasks_can_be_listed_for_an_entire_resource_type() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    first_teacher = str(uuid4())
    second_teacher = str(uuid4())
    first = store.create_task(resource_type="teacher", resource_id=first_teacher, title="First task")
    second = store.create_task(resource_type="teacher", resource_id=second_teacher, title="Second task")

    assert {task["id"] for task in store.list_tasks("teacher")} >= {first["id"], second["id"]}
    assert [task["id"] for task in store.list_tasks("teacher", first_teacher)] == [first["id"]]


def test_retired_in_progress_status_is_accepted_and_folded_into_not_started() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    task = store.create_task(resource_type="teacher", resource_id=str(uuid4()), title="Legacy client save")

    updated = store.update_task(
        task["id"], expected_revision=task["revision"], title=task["title"], due_date=None, status="IN_PROGRESS"
    )

    assert updated["status"] == "NOT_STARTED"
    assert store.get_task(task["id"])["status"] == "NOT_STARTED"


def test_rejects_an_unknown_task_status() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    task = store.create_task(resource_type="teacher", resource_id=str(uuid4()), title="Status guard")

    with pytest.raises(ValueError, match="Invalid task status."):
        store.update_task(
            task["id"], expected_revision=task["revision"], title=task["title"], due_date=None, status="BLOCKED"
        )


def test_tasks_carry_an_optional_description() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    resource_id = str(uuid4())
    described = store.create_task(
        resource_type="teacher",
        resource_id=resource_id,
        title="Collect signed contract",
        description="Scan and file the countersigned copy.",
    )
    plain = store.create_task(resource_type="teacher", resource_id=resource_id, title="No description")

    assert described["description"] == "Scan and file the countersigned copy."
    assert plain["description"] is None

    edited = store.update_task(
        described["id"],
        expected_revision=described["revision"],
        title=described["title"],
        description="Filed with HR.",
        due_date=None,
        status="NOT_STARTED",
    )
    assert edited["description"] == "Filed with HR."
    assert store.list_tasks("teacher", resource_id)[0]["description"] is not None


def test_activity_records_creation_completion_and_reopening() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    task = store.create_task(resource_type="teacher", resource_id=str(uuid4()), title="Activity trail")

    assert [entry["kind"] for entry in store.list_task_activity(task["id"])] == ["CREATED"]

    completed = store.update_task(
        task["id"], expected_revision=task["revision"], title=task["title"], due_date=None, status="COMPLETED"
    )
    reopened = store.update_task(
        completed["id"],
        expected_revision=completed["revision"],
        title=completed["title"],
        due_date=None,
        status="NOT_STARTED",
    )
    store.update_task(
        reopened["id"],
        expected_revision=reopened["revision"],
        title="Renamed without a status change",
        due_date=None,
        status="NOT_STARTED",
    )

    entries = store.list_task_activity(task["id"])
    assert [entry["kind"] for entry in entries] == ["CREATED", "COMPLETED", "REOPENED"]
    assert all(entry["occurredAt"] for entry in entries)
    # No actor is recorded: actor attribution is deliberately deferred.
    assert set(entries[0]) == {"id", "taskId", "kind", "occurredAt"}


def test_creation_activity_is_derived_for_every_creation_path() -> None:
    """Onboarding bundles are written by TeacherStore, which records no activity row."""
    teachers = TeacherStore(TEST_DATABASE_URL)
    workflow = WorkflowStore(TEST_DATABASE_URL)
    teacher = teachers.create_teacher(full_name=f"Derived history {uuid4()}", task_template_ids=["teacher-onboarding"])

    bundled = workflow.list_tasks("teacher", teacher["id"])[0]
    entries = workflow.list_task_activity(bundled["id"])

    assert [entry["kind"] for entry in entries] == ["CREATED"]
    assert entries[0]["occurredAt"] == bundled["createdAt"]


def test_deleting_a_task_removes_its_activity() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    task = store.create_task(resource_type="teacher", resource_id=str(uuid4()), title="Doomed")

    store.delete_task(task["id"])

    with pytest.raises(TaskNotFound):
        store.list_task_activity(task["id"])


def test_quick_templates_are_shared_per_resource_type_and_editable() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    created = store.create_quick_template(
        resource_type="teacher", title=f"Chase CID {uuid4()}", description="Email the CID office."
    )

    listed = store.list_quick_templates("teacher")
    assert any(item["id"] == created["id"] for item in listed)
    assert all(item["id"] != created["id"] for item in store.list_quick_templates("syllabus"))

    renamed = store.update_quick_template(created["id"], title="Chase CID clearance", description=None)
    assert renamed["title"] == "Chase CID clearance"
    assert renamed["description"] is None

    store.delete_quick_template(created["id"])
    assert all(item["id"] != created["id"] for item in store.list_quick_templates("teacher"))
    with pytest.raises(QuickTemplateNotFound):
        store.delete_quick_template(created["id"])


def test_updating_a_missing_quick_template_is_reported() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    with pytest.raises(QuickTemplateNotFound):
        store.update_quick_template(str(uuid4()), title="Nothing here", description=None)


def test_migration_0020_left_no_tasks_in_the_retired_stage() -> None:
    store = WorkflowStore(TEST_DATABASE_URL)
    with store.engine.connect() as connection:
        stranded = connection.execute(
            text("SELECT count(*) FROM tasks WHERE status NOT IN ('NOT_STARTED', 'COMPLETED')")
        ).scalar_one()
        columns = {
            row[0]
            for row in connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'")
            )
        }

    assert stranded == 0
    assert "description" in columns
