"""Persistent shared catalogue records for template-aware syllabi."""
# ruff: noqa: PLR0913

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import RowMapping


CATALOGUE_CATEGORIES = frozenset(
    {
        "people",
        "programmes",
        "plos",
        "competencies",
        "teaching-presets",
        "assessment-types",
        "rubric-presets",
        "bibliography-types",
    }
)


class CatalogueNotFound(Exception):
    pass


class CatalogueRevisionConflict(Exception):
    pass


class SyllabusCatalogueStore:
    """PostgreSQL-backed catalogue records. Retiring is deliberately non-destructive."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def list(
        self,
        category: str,
        *,
        query: str = "",
        include_retired: bool = False,
        parent_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:  # noqa: PLR0913
        self._category(category)
        clauses = ["category = :category"]
        params: dict[str, Any] = {"category": category, "limit": min(max(limit, 1), 200), "offset": max(offset, 0)}
        if not include_retired:
            clauses.append("is_retired = FALSE")
        if parent_id is not None:
            clauses.append("parent_id = :parent_id")
            params["parent_id"] = parent_id
        if query.strip():
            clauses.append("label ILIKE :query")
            params["query"] = f"%{query.strip()}%"
        where = " AND ".join(clauses)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""SELECT *, payload::text AS payload_json
                        FROM syllabus_catalogue_items
                        WHERE {where}
                        ORDER BY sort_order, label, id
                        LIMIT :limit OFFSET :offset"""
                    ),
                    params,
                )
                .mappings()
                .all()
            )
        return [_item(row) for row in rows]

    def get(self, category: str, item_id: str) -> dict[str, Any]:
        self._category(category)
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        """SELECT *, payload::text AS payload_json
                        FROM syllabus_catalogue_items
                        WHERE category = :category AND id = :id"""
                    ),
                    {"category": category, "id": item_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise CatalogueNotFound
        return _item(row)

    def create(
        self, category: str, *, label: str, payload: dict[str, Any], parent_id: str | None = None, sort_order: int = 0
    ) -> dict[str, Any]:
        self._category(category)
        now = _timestamp()
        item = {
            "id": str(uuid4()),
            "category": category,
            "parentId": parent_id,
            "label": label.strip(),
            "payload": payload,
            "sortOrder": sort_order,
            "isRetired": False,
            "retiredAt": None,
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """INSERT INTO syllabus_catalogue_items (
                        id, category, parent_id, label, payload, sort_order,
                        is_retired, retired_at, revision, created_at, updated_at
                    ) VALUES (
                        :id, :category, :parent_id, :label, CAST(:payload AS JSONB), :sort_order,
                        FALSE, NULL, :revision, :created_at, :updated_at
                    )"""
                ),
                {
                    "id": item["id"],
                    "category": category,
                    "parent_id": parent_id,
                    "label": item["label"],
                    "payload": json.dumps(payload),
                    "sort_order": sort_order,
                    "revision": 1,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        return item

    def update(
        self,
        category: str,
        item_id: str,
        *,
        expected_revision: int,
        label: str,
        payload: dict[str, Any],
        parent_id: str | None = None,
        sort_order: int = 0,
    ) -> dict[str, Any]:  # noqa: PLR0913
        current = self.get(category, item_id)
        if current["revision"] != expected_revision:
            raise CatalogueRevisionConflict
        updated_at = _timestamp()
        revision = expected_revision + 1
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """UPDATE syllabus_catalogue_items
                    SET label = :label, payload = CAST(:payload AS JSONB), parent_id = :parent_id,
                        sort_order = :sort_order, revision = :revision, updated_at = :updated_at
                    WHERE id = :id AND category = :category AND revision = :expected_revision"""
                ),
                {
                    "id": item_id,
                    "category": category,
                    "expected_revision": expected_revision,
                    "label": label.strip(),
                    "payload": json.dumps(payload),
                    "parent_id": parent_id,
                    "sort_order": sort_order,
                    "revision": revision,
                    "updated_at": updated_at,
                },
            )
        if result.rowcount != 1:
            raise CatalogueRevisionConflict
        return {
            **current,
            "label": label.strip(),
            "payload": payload,
            "parentId": parent_id,
            "sortOrder": sort_order,
            "revision": revision,
            "updatedAt": updated_at,
        }

    def retire(self, category: str, item_id: str, *, expected_revision: int) -> dict[str, Any]:
        current = self.get(category, item_id)
        if current["revision"] != expected_revision:
            raise CatalogueRevisionConflict
        now = _timestamp()
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """UPDATE syllabus_catalogue_items
                    SET is_retired = TRUE, retired_at = :retired_at, revision = :revision,
                        updated_at = :updated_at
                    WHERE id = :id AND category = :category AND revision = :expected_revision"""
                ),
                {
                    "id": item_id,
                    "category": category,
                    "expected_revision": expected_revision,
                    "retired_at": now,
                    "revision": expected_revision + 1,
                    "updated_at": now,
                },
            )
        if result.rowcount != 1:
            raise CatalogueRevisionConflict
        return {**current, "isRetired": True, "retiredAt": now, "revision": expected_revision + 1, "updatedAt": now}

    def resolve_people(self, content: dict[str, Any]) -> dict[str, Any]:
        """Return a display/export copy with linked People data applied, never mutating stored JSON."""
        resolved = deepcopy(content)
        contacts = _record(resolved.get("contacts"))
        instructor = _record(contacts.get("instructor"))
        instructor_id = _text(instructor.get("personId"))
        if instructor_id:
            contacts["instructor"] = {**instructor, **_scen_instructor(self._person(instructor_id))}
            resolved["contacts"] = contacts
        coordinator = _record(contacts.get("administrativeContact"))
        coordinator_id = _text(coordinator.get("personId"))
        if coordinator_id:
            person = self._person(coordinator_id)
            contacts["administrativeContact"] = {
                **coordinator,
                "name": person["label"],
                "contactDetails": _contact_details(person),
            }
            resolved["contacts"] = contacts
        faculty = _record(resolved.get("facultyDetails"))
        faculty_id = _text(faculty.get("personId"))
        if faculty_id:
            person = self._person(faculty_id)
            payload = person["payload"]
            rank = _text(payload.get("academicRank"))
            affiliations = _affiliations(payload)
            faculty.update(
                {
                    "staffText": " · ".join(part for part in (person["label"], rank) if part),
                    "staff": [
                        {
                            "nameAndStatus": " · ".join(part for part in (person["label"], rank) if part),
                            "email": _text(payload.get("email")),
                        }
                    ],
                    "institution": affiliations,
                    "officeHours": _office_hours(payload),
                    "email": _text(payload.get("email")),
                }
            )
            resolved["facultyDetails"] = faculty
        return resolved

    def _person(self, item_id: str) -> dict[str, Any]:
        try:
            return self.get("people", item_id)
        except CatalogueNotFound:
            return {"id": item_id, "label": "Retired contact", "payload": {}}

    @staticmethod
    def _category(category: str) -> None:
        if category not in CATALOGUE_CATEGORIES:
            raise CatalogueNotFound


def _item(row: RowMapping) -> dict[str, Any]:
    return {
        "id": row["id"],
        "category": row["category"],
        "parentId": row["parent_id"],
        "label": row["label"],
        "payload": json.loads(row["payload_json"]),
        "sortOrder": row["sort_order"],
        "isRetired": row["is_retired"],
        "retiredAt": row["retired_at"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _scen_instructor(person: dict[str, Any]) -> dict[str, Any]:
    payload = person["payload"]
    affiliations = _affiliations(payload)
    return {
        "Name": person["label"],
        "Academic rank / status": _text(payload.get("academicRank")),
        "Affiliation(s)": affiliations,
        "affiliations": [
            {"id": f"linked-{index}", "name": value}
            for index, value in enumerate(affiliations.split("\n"), start=1)
            if value
        ],
        "Office hours and location": _office_hours(payload),
        "Email": _text(payload.get("email")),
    }


def _contact_details(person: dict[str, Any]) -> str:
    payload = person["payload"]
    return " · ".join(
        part for part in (_text(payload.get("email")), _text(payload.get("phone")), _office_hours(payload)) if part
    )


def _affiliations(payload: dict[str, Any]) -> str:
    values = payload.get("affiliations", [])
    if isinstance(values, list):
        return "\n".join(str(value).strip() for value in values if str(value).strip())
    return _text(values)


def _office_hours(payload: dict[str, Any]) -> str:
    values = payload.get("officeHours", [])
    if isinstance(values, list):
        return "\n".join(str(value).strip() for value in values if str(value).strip())
    return _text(values)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()
