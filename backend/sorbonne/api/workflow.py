"""Generic API resources for field information and scoped tasks."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.account_access import AccountAccess, account_access
from sorbonne.services.field_guidance import may_write
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.workflow_store import (
    QuickTemplateNotFound,
    TaskNotFound,
    TaskRevisionConflict,
    TaskTemplateNotFound,
    WorkflowStore,
)


router = APIRouter(tags=["workflow"])


class FieldNoteInput(BaseModel):
    resourceType: str = Field(min_length=1, max_length=80)
    resourceId: str = Field(min_length=1, max_length=100)
    fieldKey: str = Field(min_length=1, max_length=240)
    content: str = Field(default="", max_length=5000)


class CreateTaskInput(BaseModel):
    resourceType: str = Field(min_length=1, max_length=80)
    resourceId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)
    dueDate: str | None = Field(default=None, max_length=30)


class UpdateTaskInput(BaseModel):
    expectedRevision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)
    dueDate: str | None = Field(default=None, max_length=30)
    # IN_PROGRESS was retired in migration 0020. It is still accepted for one release so a
    # browser holding an older bundle cannot fail its save; the store folds it into NOT_STARTED.
    status: str = Field(pattern="^(NOT_STARTED|IN_PROGRESS|COMPLETED)$")


class QuickTemplateInput(BaseModel):
    resourceType: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)


class UpdateQuickTemplateInput(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)


class ApplyTaskTemplateInput(BaseModel):
    resourceType: str = Field(min_length=1, max_length=80)
    resourceId: str = Field(min_length=1, max_length=100)
    templateId: str = Field(min_length=1, max_length=100)


def get_store() -> WorkflowStore:
    return WorkflowStore(config.database_url)


def get_account_access() -> AccountAccess:
    return account_access()


def current_user(request: Request) -> StaffUser:
    user = getattr(request.state, "staff_user", None)
    if user is None:  # pragma: no cover - the gate rejects these before they arrive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    return user


@router.get("/field-notes")
def list_field_notes(
    resourceType: str = Query(min_length=1),
    resourceId: str = Query(min_length=1),
    store: WorkflowStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_field_notes(resourceType, resourceId)}


@router.put("/field-notes")
def upsert_field_note(
    note: FieldNoteInput,
    request: Request,
    store: WorkflowStore = Depends(get_store),
    access: AccountAccess = Depends(get_account_access),
) -> dict[str, Any]:
    """Guidance on a field is written by whoever administers its app, and read by everyone."""
    user = current_user(request)
    if not may_write(note.resourceType, access.apps_for(user.email), platform_admin=user.is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator of this application can change the guidance on a field.",
        )
    return store.upsert_field_note(
        resource_type=note.resourceType,
        resource_id=note.resourceId,
        field_key=note.fieldKey,
        content=note.content,
    )


@router.get("/task-templates")
def list_task_templates(
    resourceType: str = Query(min_length=1), store: WorkflowStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_task_templates(resourceType)}


@router.get("/task-quick-templates")
def list_quick_templates(
    resourceType: str = Query(min_length=1), store: WorkflowStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_quick_templates(resourceType)}


@router.post("/task-quick-templates", status_code=201)
def create_quick_template(
    request: QuickTemplateInput, store: WorkflowStore = Depends(get_store)
) -> dict[str, Any]:
    return store.create_quick_template(
        resource_type=request.resourceType,
        title=request.title.strip(),
        description=_clean(request.description),
    )


@router.patch("/task-quick-templates/{template_id}")
def update_quick_template(
    template_id: str, request: UpdateQuickTemplateInput, store: WorkflowStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.update_quick_template(
            template_id, title=request.title.strip(), description=_clean(request.description)
        )
    except QuickTemplateNotFound as exc:
        raise HTTPException(status_code=404, detail="Task template not found.") from exc


@router.delete("/task-quick-templates/{template_id}", status_code=204)
def delete_quick_template(template_id: str, store: WorkflowStore = Depends(get_store)) -> Response:
    try:
        store.delete_quick_template(template_id)
    except QuickTemplateNotFound as exc:
        raise HTTPException(status_code=404, detail="Task template not found.") from exc
    return Response(status_code=204)


@router.get("/tasks")
def list_tasks(
    resourceType: str = Query(min_length=1),
    resourceId: str | None = Query(default=None, min_length=1),
    store: WorkflowStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_tasks(resourceType, resourceId)}


@router.post("/tasks", status_code=201)
def create_task(request: CreateTaskInput, store: WorkflowStore = Depends(get_store)) -> dict[str, Any]:
    return store.create_task(
        resource_type=request.resourceType,
        resource_id=request.resourceId,
        title=request.title.strip(),
        description=_clean(request.description),
        due_date=request.dueDate,
    )


@router.post("/tasks/from-template", status_code=201)
def apply_task_template(
    request: ApplyTaskTemplateInput, store: WorkflowStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    try:
        return {
            "items": store.apply_task_template(
                resource_type=request.resourceType,
                resource_id=request.resourceId,
                template_id=request.templateId,
            )
        }
    except TaskTemplateNotFound as exc:
        raise HTTPException(status_code=404, detail="Task template not found for this record.") from exc


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, request: UpdateTaskInput, store: WorkflowStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.update_task(
            task_id,
            expected_revision=request.expectedRevision,
            title=request.title.strip(),
            description=_clean(request.description),
            due_date=request.dueDate,
            status=request.status,
        )
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="Task not found.") from exc
    except TaskRevisionConflict as exc:
        raise HTTPException(
            status_code=409, detail="This task changed elsewhere. Reload it before saving again."
        ) from exc


@router.get("/tasks/{task_id}/activity")
def list_task_activity(
    task_id: str, store: WorkflowStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    try:
        return {"items": store.list_task_activity(task_id)}
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="Task not found.") from exc


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, store: WorkflowStore = Depends(get_store)) -> Response:
    try:
        store.delete_task(task_id)
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="Task not found.") from exc
    return Response(status_code=204)


def _clean(value: str | None) -> str | None:
    return (value or "").strip() or None
