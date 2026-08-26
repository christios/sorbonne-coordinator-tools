import os
from uuid import uuid4

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.api.workflow import get_store
from sorbonne.main import app
from sorbonne.services.workflow_store import WorkflowStore


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


@pytest.fixture
def client() -> TestClient:
    app.dependency_overrides[get_store] = lambda: WorkflowStore(TEST_DATABASE_URL)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_store, None)


def create_task(client: TestClient, resource_id: str, **overrides) -> dict:
    body = {"resourceType": "teacher", "resourceId": resource_id, "title": "API task", **overrides}
    response = client.post("/api/v1/tasks", json=body)
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


def test_creates_a_task_with_a_description(client: TestClient) -> None:
    task = create_task(client, str(uuid4()), description="  Ask HR for the signed copy.  ")

    assert task["description"] == "Ask HR for the signed copy."
    assert task["status"] == "NOT_STARTED"


def test_blank_descriptions_are_stored_as_null(client: TestClient) -> None:
    task = create_task(client, str(uuid4()), description="   ")
    assert task["description"] is None


def test_an_older_client_sending_in_progress_still_saves(client: TestClient) -> None:
    task = create_task(client, str(uuid4()))

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={
            "expectedRevision": task["revision"],
            "title": task["title"],
            "dueDate": None,
            "status": "IN_PROGRESS",
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["status"] == "NOT_STARTED"


def test_an_unknown_status_is_rejected(client: TestClient) -> None:
    task = create_task(client, str(uuid4()))

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"expectedRevision": task["revision"], "title": task["title"], "dueDate": None, "status": "BLOCKED"},
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_stale_revision_is_reported_as_a_conflict(client: TestClient) -> None:
    task = create_task(client, str(uuid4()))
    payload = {
        "expectedRevision": task["revision"],
        "title": task["title"],
        "dueDate": None,
        "status": "COMPLETED",
    }
    assert client.patch(f"/api/v1/tasks/{task['id']}", json=payload).status_code == status.HTTP_200_OK

    conflicted = client.patch(f"/api/v1/tasks/{task['id']}", json=payload)

    assert conflicted.status_code == status.HTTP_409_CONFLICT
    assert "changed elsewhere" in conflicted.json()["detail"]


def test_activity_history_is_exposed_per_task(client: TestClient) -> None:
    task = create_task(client, str(uuid4()))
    client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={
            "expectedRevision": task["revision"],
            "title": task["title"],
            "dueDate": None,
            "status": "COMPLETED",
        },
    )

    response = client.get(f"/api/v1/tasks/{task['id']}/activity")

    assert response.status_code == status.HTTP_200_OK
    assert [entry["kind"] for entry in response.json()["items"]] == ["CREATED", "COMPLETED"]


def test_activity_for_a_missing_task_is_not_found(client: TestClient) -> None:
    assert client.get(f"/api/v1/tasks/{uuid4()}/activity").status_code == status.HTTP_404_NOT_FOUND


def test_tasks_list_record_scoped_and_resource_wide(client: TestClient) -> None:
    first_teacher = str(uuid4())
    second_teacher = str(uuid4())
    first = create_task(client, first_teacher, title="First")
    second = create_task(client, second_teacher, title="Second")

    scoped = client.get("/api/v1/tasks", params={"resourceType": "teacher", "resourceId": first_teacher})
    wide = client.get("/api/v1/tasks", params={"resourceType": "teacher"})

    assert [task["id"] for task in scoped.json()["items"]] == [first["id"]]
    wide_ids = {task["id"] for task in wide.json()["items"]}
    assert {first["id"], second["id"]} <= wide_ids


def test_quick_templates_support_full_crud(client: TestClient) -> None:
    title = f"Chase CID {uuid4()}"
    created = client.post(
        "/api/v1/task-quick-templates",
        json={"resourceType": "teacher", "title": title, "description": "Email the CID office."},
    )
    assert created.status_code == status.HTTP_201_CREATED
    template = created.json()

    listed = client.get("/api/v1/task-quick-templates", params={"resourceType": "teacher"})
    assert any(item["id"] == template["id"] for item in listed.json()["items"])

    renamed = client.patch(
        f"/api/v1/task-quick-templates/{template['id']}",
        json={"title": "Chase CID clearance", "description": None},
    )
    assert renamed.json()["title"] == "Chase CID clearance"
    assert renamed.json()["description"] is None

    assert client.delete(f"/api/v1/task-quick-templates/{template['id']}").status_code == status.HTTP_204_NO_CONTENT
    assert client.delete(f"/api/v1/task-quick-templates/{template['id']}").status_code == status.HTTP_404_NOT_FOUND


def test_the_onboarding_bundle_endpoint_still_applies_its_three_tasks(client: TestClient) -> None:
    resource_id = str(uuid4())

    response = client.post(
        "/api/v1/tasks/from-template",
        json={"resourceType": "teacher", "resourceId": resource_id, "templateId": "teacher-onboarding"},
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert [task["title"] for task in response.json()["items"]] == [
        "CID Clearance",
        "Requisition signature",
        "ID Issuance (for newcomers)",
    ]
