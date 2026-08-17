from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

class TeacherNotFound(Exception):
    pass


class RequisitionNotFound(Exception):
    pass


class RevisionConflict(Exception):
    pass


class FolderNotFound(Exception):
    pass


class FolderNameConflict(Exception):
    pass


class FolderNotEmpty(Exception):
    pass


class TeacherStore:
    """PostgreSQL persistence for part-time teacher profiles and their requisitions."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def create_teacher(
        self, *, full_name: str, email: str | None = None, phone: str | None = None, notes: str = ""
    ) -> dict[str, Any]:
        now = _timestamp()
        teacher = {
            "id": str(uuid4()),
            "folderId": None,
            "fullName": full_name,
            "email": email or "",
            "phone": phone or "",
            "notes": notes,
            "archivedAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO part_time_teachers (
                        id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                    ) VALUES (
                        :id, :folder_id, :full_name, :email, :phone, :notes, :archived_at, :created_at, :updated_at
                    )
                    """
                ),
                _teacher_params(teacher),
            )
        return teacher

    def list_teachers(self, *, include_archived: bool = False) -> list[dict[str, Any]]:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                        SELECT id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                        FROM part_time_teachers {where}
                        ORDER BY full_name ASC, updated_at DESC
                        """
                    )
                )
                .mappings()
                .all()
            )  # noqa: S608
        return [_teacher_from_row(row) for row in rows]

    def get_teacher(self, teacher_id: str | None) -> dict[str, Any]:
        if not teacher_id:
            raise TeacherNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        """
                        SELECT id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                        FROM part_time_teachers WHERE id = :id
                        """
                    ),
                    {"id": teacher_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise TeacherNotFound
        return _teacher_from_row(row)

    def update_teacher(self, teacher_id: str, *, full_name: str, email: str, phone: str, notes: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {
            **current,
            "fullName": full_name,
            "email": email,
            "phone": phone,
            "notes": notes,
            "updatedAt": _timestamp(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE part_time_teachers
                    SET full_name = :full_name, email = :email, phone = :phone, notes = :notes, updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                _teacher_params(updated),
            )
        return updated

    def archive_teacher(self, teacher_id: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {**current, "archivedAt": _timestamp(), "updatedAt": _timestamp()}
        self._save_archive_state(updated)
        return updated

    def restore_teacher(self, teacher_id: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {**current, "archivedAt": None, "updatedAt": _timestamp()}
        self._save_archive_state(updated)
        return updated

    def _save_archive_state(self, teacher: dict[str, Any]) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE part_time_teachers SET archived_at = :archived_at, updated_at = :updated_at WHERE id = :id"
                ),
                _teacher_params(teacher),
            )

    def list_folders(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("SELECT id, name, parent_id, created_at, updated_at FROM teacher_folders ORDER BY name ASC")
                )
                .mappings()
                .all()
            )
        return [_folder_from_row(row) for row in rows]

    def create_folder(self, name: str, parent_id: str | None = None) -> dict[str, Any]:
        if parent_id and not self._folder_exists(parent_id):
            raise FolderNotFound
        now = _timestamp()
        folder = {"id": str(uuid4()), "name": name.strip(), "parentId": parent_id, "createdAt": now, "updatedAt": now}
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO teacher_folders (id, name, parent_id, created_at, updated_at)
                        VALUES (:id, :name, :parent_id, :created_at, :updated_at)
                        """
                    ),
                    {
                        "id": folder["id"],
                        "name": folder["name"],
                        "parent_id": folder["parentId"],
                        "created_at": folder["createdAt"],
                        "updated_at": folder["updatedAt"],
                    },
                )
        except IntegrityError as exc:
            raise FolderNameConflict from exc
        return folder

    def delete_folder(self, folder_id: str) -> None:
        if not self._folder_exists(folder_id):
            raise FolderNotFound
        with self.engine.begin() as connection:
            has_teachers = connection.execute(
                text("SELECT 1 FROM part_time_teachers WHERE folder_id = :folder_id LIMIT 1"), {"folder_id": folder_id}
            ).first()
            has_children = connection.execute(
                text("SELECT 1 FROM teacher_folders WHERE parent_id = :folder_id LIMIT 1"), {"folder_id": folder_id}
            ).first()
            if has_teachers is not None or has_children is not None:
                raise FolderNotEmpty
            connection.execute(text("DELETE FROM teacher_folders WHERE id = :id"), {"id": folder_id})

    def move_teacher_to_folder(self, teacher_id: str, folder_id: str | None) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        if folder_id and not self._folder_exists(folder_id):
            raise FolderNotFound
        updated = {**current, "folderId": folder_id, "updatedAt": _timestamp()}
        with self.engine.begin() as connection:
            connection.execute(
                text("UPDATE part_time_teachers SET folder_id = :folder_id, updated_at = :updated_at WHERE id = :id"),
                _teacher_params(updated),
            )
        return updated

    def list_requisitions(self, teacher_id: str) -> list[dict[str, Any]]:
        self.get_teacher(teacher_id)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                        SELECT id, teacher_id, label, academic_year, revision, created_at, updated_at
                        FROM teacher_requisitions WHERE teacher_id = :teacher_id
                        ORDER BY academic_year DESC, updated_at DESC
                        """
                    ),
                    {"teacher_id": teacher_id},
                )
                .mappings()
                .all()
            )
        return [_requisition_summary_from_row(row) for row in rows]

    def create_requisition(
        self, teacher_id: str, *, label: str, academic_year: str, source_requisition_id: str | None = None
    ) -> dict[str, Any]:
        self.get_teacher(teacher_id)
        source = self.get_requisition(source_requisition_id) if source_requisition_id else None
        if source and source["teacherId"] != teacher_id:
            raise RequisitionNotFound
        now = _timestamp()
        record = {
            "id": str(uuid4()),
            "teacherId": teacher_id,
            "label": label,
            "academicYear": academic_year,
            "content": deepcopy(source["content"]) if source else default_content(),
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO teacher_requisitions (
                        id, teacher_id, label, academic_year, content_json, revision, created_at, updated_at
                    ) VALUES (
                        :id, :teacher_id, :label, :academic_year, CAST(:content_json AS JSONB), :revision,
                        :created_at, :updated_at
                    )
                    """
                ),
                _requisition_params(record),
            )
        return record

    def get_requisition(self, requisition_id: str | None) -> dict[str, Any]:
        if not requisition_id:
            raise RequisitionNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("SELECT *, content_json::text AS content_json_text FROM teacher_requisitions WHERE id = :id"),
                    {"id": requisition_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise RequisitionNotFound
        return {**_requisition_summary_from_row(row), "content": json.loads(row["content_json_text"])}

    def update_requisition(
        self, requisition_id: str, *, expected_revision: int, label: str, academic_year: str, content: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.get_requisition(requisition_id)
        if current["revision"] != expected_revision:
            raise RevisionConflict
        updated = {
            **current,
            "label": label,
            "academicYear": academic_year,
            "content": content,
            "revision": current["revision"] + 1,
            "updatedAt": _timestamp(),
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE teacher_requisitions
                    SET label = :label, academic_year = :academic_year, content_json = CAST(:content_json AS JSONB),
                        revision = :revision, updated_at = :updated_at
                    WHERE id = :id AND revision = :expected_revision
                    """
                ),
                {**_requisition_params(updated), "expected_revision": expected_revision},
            )
        if result.rowcount != 1:
            raise RevisionConflict
        return updated

    def delete_requisition(self, requisition_id: str) -> None:
        self.get_requisition(requisition_id)
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM teacher_requisitions WHERE id = :id"), {"id": requisition_id})

    def import_course_catalogue(self, rows: list[dict[str, str]]) -> dict[str, int]:
        """Replace the active catalogue snapshot while retaining prior course versions.

        CRN is the source-system identity. A changed record with the same CRN is
        retained as an obsolete version, rather than updated in place, so older
        requisitions can continue to describe the course they originally used.
        """
        catalogue_rows = [_catalogue_row(row) for row in rows]
        crns = [row["crn"] for row in catalogue_rows]
        if not catalogue_rows:
            raise ValueError("The workbook does not contain any courses with a CRN, course code, and course title.")
        if len(set(crns)) != len(crns):
            raise ValueError("The workbook contains more than one row with the same CRN.")

        now = _timestamp()
        imported = retained = obsoleted = 0
        with self.engine.begin() as connection:
            active_rows = connection.execute(
                text(
                    """
                    SELECT id, crn, term, course_code, course_title, sequence, credit,
                           department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                    FROM course_catalogue_entries
                    WHERE is_obsolete = FALSE
                    """
                )
            ).mappings().all()
            active_by_crn = {row["crn"]: row for row in active_rows}

            for record in catalogue_rows:
                current = active_by_crn.get(record["crn"])
                if current is not None and _catalogue_matches(current, record):
                    retained += 1
                    connection.execute(
                        text("UPDATE course_catalogue_entries SET imported_at = :imported_at WHERE id = :id"),
                        {"id": current["id"], "imported_at": now},
                    )
                    continue

                if current is not None:
                    connection.execute(
                        text(
                            """
                            UPDATE course_catalogue_entries
                            SET is_obsolete = TRUE, obsolete_at = :obsolete_at
                            WHERE id = :id
                            """
                        ),
                        {"id": current["id"], "obsolete_at": now},
                    )
                    obsoleted += 1

                entry = {"id": str(uuid4()), **record, "importedAt": now, "obsoleteAt": None}
                connection.execute(
                    text(
                        """
                        INSERT INTO course_catalogue_entries (
                            id, crn, term, course_code, course_title, sequence, credit,
                            department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                        ) VALUES (
                            :id, :crn, :term, :course_code, :course_title, :sequence, :credit,
                            :department, :level, :college, :contact_hours, FALSE, :imported_at, :obsolete_at
                        )
                        """
                    ),
                    _catalogue_params(entry),
                )
                imported += 1

            for current in active_rows:
                if current["crn"] in crns:
                    continue
                connection.execute(
                    text(
                        """
                        UPDATE course_catalogue_entries
                        SET is_obsolete = TRUE, obsolete_at = :obsolete_at
                        WHERE id = :id
                        """
                    ),
                    {"id": current["id"], "obsolete_at": now},
                )
                obsoleted += 1

            total_active = connection.execute(
                text("SELECT COUNT(*) FROM course_catalogue_entries WHERE is_obsolete = FALSE")
            ).scalar_one()
        return {"imported": imported, "retained": retained, "obsoleted": obsoleted, "totalActive": total_active}

    def list_course_catalogue(self, *, query: str = "", include_obsolete: bool = False) -> list[dict[str, Any]]:
        filters = [] if include_obsolete else ["is_obsolete = FALSE"]
        params: dict[str, str] = {}
        if query.strip():
            filters.append("(crn ILIKE :query OR course_code ILIKE :query OR course_title ILIKE :query)")
            params["query"] = f"%{query.strip()}%"
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    f"""
                    SELECT id, crn, term, course_code, course_title, sequence, credit,
                           department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                    FROM course_catalogue_entries
                    {where}
                    ORDER BY is_obsolete ASC, course_title ASC, course_code ASC, crn ASC
                    """
                ),
                params,
            ).mappings().all()  # noqa: S608
        return [_catalogue_from_row(row) for row in rows]

    def _folder_exists(self, folder_id: str) -> bool:
        with self.engine.connect() as connection:
            return (
                connection.execute(text("SELECT 1 FROM teacher_folders WHERE id = :id"), {"id": folder_id}).first()
                is not None
            )


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def default_content() -> dict[str, Any]:
    return {
        "department": "Department of Sciences and Engineering",
        "program": "",
        "jobTitle": "Part Time Lecturer",
        "classType": "TD",
        "employeeType": "PT",
        "contractFrom": "",
        "contractTo": "",
        "courses": [],
    }


def _teacher_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "folderId": row["folder_id"],
        "fullName": row["full_name"],
        "email": row["email"],
        "phone": row["phone"],
        "notes": row["notes"],
        "archivedAt": row["archived_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _teacher_params(teacher: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": teacher["id"],
        "folder_id": teacher["folderId"],
        "full_name": teacher["fullName"],
        "email": teacher["email"],
        "phone": teacher["phone"],
        "notes": teacher["notes"],
        "archived_at": teacher["archivedAt"],
        "created_at": teacher["createdAt"],
        "updated_at": teacher["updatedAt"],
    }


def _folder_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "parentId": row["parent_id"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _requisition_summary_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "teacherId": row["teacher_id"],
        "label": row["label"],
        "academicYear": row["academic_year"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _requisition_params(requisition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": requisition["id"],
        "teacher_id": requisition["teacherId"],
        "label": requisition["label"],
        "academic_year": requisition["academicYear"],
        "content_json": json.dumps(requisition["content"]),
        "revision": requisition["revision"],
        "created_at": requisition["createdAt"],
        "updated_at": requisition["updatedAt"],
    }


_CATALOGUE_FIELDS = (
    "crn",
    "term",
    "courseCode",
    "courseTitle",
    "sequence",
    "credit",
    "department",
    "level",
    "college",
    "contactHours",
)


def _catalogue_row(row: dict[str, str]) -> dict[str, str]:
    normalized = {field: str(row.get(field, "") or "").strip() for field in _CATALOGUE_FIELDS}
    if not normalized["crn"] or not normalized["courseCode"] or not normalized["courseTitle"]:
        raise ValueError("Every imported course must have a CRN, course code, and course title.")
    return normalized


def _catalogue_matches(current: Any, candidate: dict[str, str]) -> bool:
    return all(current[_snake_case(field)] == candidate[field] for field in _CATALOGUE_FIELDS)


def _catalogue_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "crn": row["crn"],
        "term": row["term"],
        "courseCode": row["course_code"],
        "courseTitle": row["course_title"],
        "sequence": row["sequence"],
        "credit": row["credit"],
        "department": row["department"],
        "level": row["level"],
        "college": row["college"],
        "contactHours": row["contact_hours"],
        "isObsolete": row["is_obsolete"],
        "importedAt": row["imported_at"],
        "obsoleteAt": row["obsolete_at"],
    }


def _catalogue_params(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry["id"],
        "crn": entry["crn"],
        "term": entry["term"],
        "course_code": entry["courseCode"],
        "course_title": entry["courseTitle"],
        "sequence": entry["sequence"],
        "credit": entry["credit"],
        "department": entry["department"],
        "level": entry["level"],
        "college": entry["college"],
        "contact_hours": entry["contactHours"],
        "imported_at": entry["importedAt"],
        "obsolete_at": entry["obsoleteAt"],
    }


def _snake_case(field: str) -> str:
    return {
        "courseCode": "course_code",
        "courseTitle": "course_title",
        "contactHours": "contact_hours",
    }.get(field, field)
