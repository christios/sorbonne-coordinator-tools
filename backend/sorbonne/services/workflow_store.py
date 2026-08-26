"""Shared persistence for record-specific field notes and scoped tasks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, Engine, create_engine, text


class TaskNotFound(Exception):
    pass


class TaskRevisionConflict(Exception):
    pass


class TaskTemplateNotFound(Exception):
    pass


class QuickTemplateNotFound(Exception):
    pass


VALID_TASK_STATUSES = frozenset({"NOT_STARTED", "COMPLETED"})

# The IN_PROGRESS stage was removed in migration 0020. Accept it for one release so a
# browser holding an older bundle cannot fail its save, and fold it into NOT_STARTED.
RETIRED_TASK_STATUSES = {"IN_PROGRESS": "NOT_STARTED"}

TASK_COLUMNS = """id, resource_type, resource_id, template_item_id, title, description, due_date,
                  status, completed_at, revision, created_at, updated_at"""


def normalize_task_status(status: str) -> str:
    return RETIRED_TASK_STATUSES.get(status, status)


class WorkflowStore:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def list_field_notes(self, resource_type: str, resource_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, resource_type, resource_id, field_key, content, created_at, updated_at
                         FROM field_notes WHERE resource_type = :resource_type AND resource_id = :resource_id
                         ORDER BY field_key"""),
                    {"resource_type": resource_type, "resource_id": resource_id},
                )
                .mappings()
                .all()
            )
        return [_field_note(row) for row in rows]

    def upsert_field_note(
        self, *, resource_type: str, resource_id: str, field_key: str, content: str
    ) -> dict[str, Any]:
        now = _timestamp()
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("""INSERT INTO field_notes (
                             id, resource_type, resource_id, field_key, content, created_at, updated_at
                         ) VALUES (
                             :id, :resource_type, :resource_id, :field_key, :content, :created_at, :updated_at
                         )
                         ON CONFLICT (resource_type, resource_id, field_key) DO UPDATE
                         SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at
                         RETURNING id, resource_type, resource_id, field_key, content, created_at, updated_at"""),
                    {
                        "id": str(uuid4()),
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "field_key": field_key,
                        "content": content,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                .mappings()
                .one()
            )
        return _field_note(row)

    def list_task_templates(self, resource_type: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            templates = (
                connection.execute(
                    text("""SELECT id, resource_type, title, created_at, updated_at FROM task_templates
                         WHERE resource_type = :resource_type ORDER BY title"""),
                    {"resource_type": resource_type},
                )
                .mappings()
                .all()
            )
            items = (
                connection.execute(
                    text("""SELECT id, template_id, title, position FROM task_template_items
                         WHERE template_id IN (SELECT id FROM task_templates WHERE resource_type = :resource_type)
                         ORDER BY position, title"""),
                    {"resource_type": resource_type},
                )
                .mappings()
                .all()
            )
        items_by_template: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            items_by_template.setdefault(item["template_id"], []).append(
                {"id": item["id"], "title": item["title"], "position": item["position"]}
            )
        return [
            {
                "id": row["id"],
                "resourceType": row["resource_type"],
                "title": row["title"],
                "items": items_by_template.get(row["id"], []),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in templates
        ]

    def list_quick_templates(self, resource_type: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, resource_type, title, description, created_at, updated_at
                         FROM task_quick_templates WHERE resource_type = :resource_type ORDER BY title"""),
                    {"resource_type": resource_type},
                )
                .mappings()
                .all()
            )
        return [_quick_template(row) for row in rows]

    def create_quick_template(
        self, *, resource_type: str, title: str, description: str | None = None
    ) -> dict[str, Any]:
        now = _timestamp()
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("""INSERT INTO task_quick_templates (
                             id, resource_type, title, description, created_at, updated_at
                         ) VALUES (:id, :resource_type, :title, :description, :created_at, :updated_at)
                         RETURNING id, resource_type, title, description, created_at, updated_at"""),
                    {
                        "id": str(uuid4()),
                        "resource_type": resource_type,
                        "title": title,
                        "description": description or None,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                .mappings()
                .one()
            )
        return _quick_template(row)

    def update_quick_template(
        self, template_id: str, *, title: str, description: str | None
    ) -> dict[str, Any]:
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("""UPDATE task_quick_templates
                         SET title = :title, description = :description, updated_at = :updated_at
                         WHERE id = :id
                         RETURNING id, resource_type, title, description, created_at, updated_at"""),
                    {
                        "id": template_id,
                        "title": title,
                        "description": description or None,
                        "updated_at": _timestamp(),
                    },
                )
                .mappings()
                .first()
            )
        if row is None:
            raise QuickTemplateNotFound
        return _quick_template(row)

    def delete_quick_template(self, template_id: str) -> None:
        with self.engine.begin() as connection:
            result = connection.execute(
                text("DELETE FROM task_quick_templates WHERE id = :id"), {"id": template_id}
            )
        if result.rowcount != 1:
            raise QuickTemplateNotFound

    def list_tasks(self, resource_type: str, resource_id: str | None = None) -> list[dict[str, Any]]:
        where = "resource_type = :resource_type"
        params: dict[str, str] = {"resource_type": resource_type}
        if resource_id is not None:
            where += " AND resource_id = :resource_id"
            params["resource_id"] = resource_id
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""SELECT {TASK_COLUMNS} FROM tasks WHERE {where}
                         ORDER BY CASE status WHEN 'COMPLETED' THEN 1 ELSE 0 END, due_date NULLS LAST, created_at"""
                    ),
                    params,
                )
                .mappings()
                .all()
            )
        return [_task(row) for row in rows]

    def list_task_activity(self, task_id: str) -> list[dict[str, Any]]:
        """Creation is derived from the task row; only later events are stored."""
        task = self.get_task(task_id)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, task_id, kind, occurred_at FROM task_activity
                         WHERE task_id = :task_id ORDER BY occurred_at, id"""),
                    {"task_id": task_id},
                )
                .mappings()
                .all()
            )
        created = {
            "id": f"{task_id}-created",
            "taskId": task_id,
            "kind": "CREATED",
            "occurredAt": task["createdAt"],
        }
        return [created] + [
            {"id": row["id"], "taskId": row["task_id"], "kind": row["kind"], "occurredAt": row["occurred_at"]}
            for row in rows
        ]

    def create_task(
        self,
        *,
        resource_type: str,
        resource_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
    ) -> dict[str, Any]:
        now = _timestamp()
        task = {
            "id": str(uuid4()),
            "resourceType": resource_type,
            "resourceId": resource_id,
            "templateItemId": None,
            "title": title,
            "description": description or None,
            "dueDate": due_date or None,
            "status": "NOT_STARTED",
            "completedAt": None,
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(text(_INSERT_TASK), _task_params(task))
        return task

    def apply_task_template(
        self, *, resource_type: str, resource_id: str, template_id: str
    ) -> list[dict[str, Any]]:
        now = _timestamp()
        with self.engine.begin() as connection:
            template_exists = connection.execute(
                text(
                    """SELECT 1 FROM task_templates
                       WHERE id = :template_id AND resource_type = :resource_type"""
                ),
                {"template_id": template_id, "resource_type": resource_type},
            ).first()
            if template_exists is None:
                raise TaskTemplateNotFound
            rows = (
                connection.execute(
                    text(
                        """SELECT id, title FROM task_template_items
                           WHERE template_id = :template_id ORDER BY position, title"""
                    ),
                    {"template_id": template_id},
                )
                .mappings()
                .all()
            )
            existing_item_ids = {
                row["template_item_id"]
                for row in connection.execute(
                    text(
                        """SELECT template_item_id FROM tasks
                           WHERE resource_type = :resource_type
                             AND resource_id = :resource_id
                             AND template_item_id IS NOT NULL"""
                    ),
                    {"resource_type": resource_type, "resource_id": resource_id},
                ).mappings()
            }
            created = []
            for item in rows:
                if item["id"] in existing_item_ids:
                    continue
                task = {
                    "id": str(uuid4()),
                    "resourceType": resource_type,
                    "resourceId": resource_id,
                    "templateItemId": item["id"],
                    "title": item["title"],
                    "description": None,
                    "dueDate": None,
                    "status": "NOT_STARTED",
                    "completedAt": None,
                    "revision": 1,
                    "createdAt": now,
                    "updatedAt": now,
                }
                connection.execute(text(_INSERT_TASK), _task_params(task))
                created.append(task)
        return created

    def update_task(  # noqa: PLR0913
        self,
        task_id: str,
        *,
        expected_revision: int,
        title: str,
        due_date: str | None,
        status: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        status = normalize_task_status(status)
        if status not in VALID_TASK_STATUSES:
            raise ValueError("Invalid task status.")
        current = self.get_task(task_id)
        if current["revision"] != expected_revision:
            raise TaskRevisionConflict
        now = _timestamp()
        completing = status == "COMPLETED" and current["status"] != "COMPLETED"
        reopening = status != "COMPLETED" and current["status"] == "COMPLETED"
        updated = {
            **current,
            "title": title,
            "description": description or None,
            "dueDate": due_date or None,
            "status": status,
            "completedAt": now if completing else (current["completedAt"] if status == "COMPLETED" else None),
            "revision": current["revision"] + 1,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                text("""UPDATE tasks SET
                             title = :title, description = :description, due_date = :due_date, status = :status,
                             completed_at = :completed_at, revision = :revision, updated_at = :updated_at
                         WHERE id = :id AND revision = :expected_revision"""),
                {**_task_params(updated), "expected_revision": expected_revision},
            )
            if result.rowcount != 1:
                raise TaskRevisionConflict
            if completing:
                _record_activity(connection, task_id, "COMPLETED", now)
            elif reopening:
                _record_activity(connection, task_id, "REOPENED", now)
        return updated

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = :id"),
                    {"id": task_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise TaskNotFound
        return _task(row)

    def delete_task(self, task_id: str) -> None:
        with self.engine.begin() as connection:
            result = connection.execute(text("DELETE FROM tasks WHERE id = :id"), {"id": task_id})
        if result.rowcount != 1:
            raise TaskNotFound


_INSERT_TASK = """INSERT INTO tasks (
        id, resource_type, resource_id, template_item_id, title, description, due_date,
        status, completed_at, revision, created_at, updated_at
    ) VALUES (
        :id, :resource_type, :resource_id, :template_item_id, :title, :description, :due_date,
        :status, :completed_at, :revision, :created_at, :updated_at
    )"""


def _record_activity(connection: Connection, task_id: str, kind: str, occurred_at: str) -> None:
    connection.execute(
        text("""INSERT INTO task_activity (id, task_id, kind, occurred_at)
             VALUES (:id, :task_id, :kind, :occurred_at)"""),
        {"id": str(uuid4()), "task_id": task_id, "kind": kind, "occurred_at": occurred_at},
    )


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _field_note(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "resourceType": row["resource_type"],
        "resourceId": row["resource_id"],
        "fieldKey": row["field_key"],
        "content": row["content"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _quick_template(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "resourceType": row["resource_type"],
        "title": row["title"],
        "description": row["description"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _task(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "resourceType": row["resource_type"],
        "resourceId": row["resource_id"],
        "templateItemId": row["template_item_id"],
        "title": row["title"],
        "description": row["description"],
        "dueDate": row["due_date"],
        "status": row["status"],
        "completedAt": row["completed_at"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _task_params(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "resource_type": task["resourceType"],
        "resource_id": task["resourceId"],
        "template_item_id": task["templateItemId"],
        "title": task["title"],
        "description": task["description"],
        "due_date": task["dueDate"],
        "status": task["status"],
        "completed_at": task["completedAt"],
        "revision": task["revision"],
        "created_at": task["createdAt"],
        "updated_at": task["updatedAt"],
    }
