from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from difflib import SequenceMatcher
import json
import re
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from sorbonne.services.syllabus_templates import (
    DEFAULT_TEMPLATE_ID,
    comparison_mapping,
    get_template,
)


FIELD_HISTORY_COALESCE_SECONDS = 120


class SyllabusNotFound(Exception):
    pass


class RevisionConflict(Exception):
    pass


class ComparisonNotAllowed(Exception):
    pass


class TemplateComparisonNotMapped(Exception):
    pass


class FolderNotFound(Exception):
    pass


class FolderNameConflict(Exception):
    pass


class FolderNotEmpty(Exception):
    pass


class SyllabusStore:
    """PostgreSQL-backed syllabus persistence. Schema changes are managed by Alembic."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def create(
        self,
        *,
        course_title: str,
        course_code: str | None,
        academic_year: str,
        source_syllabus_id: str | None = None,
        template_id: str | None = None,
    ) -> dict[str, Any]:
        source = self.get(source_syllabus_id) if source_syllabus_id else None
        selected_template_id = template_id or (source["templateId"] if source else DEFAULT_TEMPLATE_ID)
        get_template(selected_template_id)
        if source and selected_template_id != source["templateId"]:
            raise TemplateComparisonNotMapped
        now = _timestamp()
        record = {
            "id": str(uuid4()),
            "seriesId": source["seriesId"] if source else str(uuid4()),
            "folderId": source["folderId"] if source else None,
            "courseTitle": course_title,
            "courseCode": course_code or "",
            "academicYear": academic_year,
            "templateId": selected_template_id,
            "content": deepcopy(source["content"]) if source else default_content(),
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO syllabi (
                        id, series_id, folder_id, course_title, course_code, academic_year, template_id, content_json,
                        revision, created_at, updated_at
                    ) VALUES (
                        :id, :series_id, :folder_id, :course_title, :course_code, :academic_year, :template_id,
                        CAST(:content_json AS JSONB), :revision, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": record["id"],
                    "series_id": record["seriesId"],
                    "folder_id": record["folderId"],
                    "course_title": record["courseTitle"],
                    "course_code": record["courseCode"],
                    "academic_year": record["academicYear"],
                    "template_id": record["templateId"],
                    "content_json": json.dumps(record["content"]),
                    "revision": record["revision"],
                    "created_at": record["createdAt"],
                    "updated_at": record["updatedAt"],
                },
            )
        return record

    def list(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                    SELECT id, series_id, folder_id, course_title, course_code, academic_year, template_id,
                           revision, created_at, updated_at
                    FROM syllabi
                    ORDER BY academic_year DESC, course_title ASC, updated_at DESC
                    """
                    )
                )
                .mappings()
                .all()
            )
        return [_summary_from_row(row) for row in rows]

    def list_folders(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                        SELECT id, name, created_at, updated_at
                        FROM syllabus_folders
                        ORDER BY name ASC
                        """
                    )
                )
                .mappings()
                .all()
            )
        return [_folder_from_row(row) for row in rows]

    def create_folder(self, name: str) -> dict[str, Any]:
        now = _timestamp()
        folder = {"id": str(uuid4()), "name": name.strip(), "createdAt": now, "updatedAt": now}
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO syllabus_folders (id, name, created_at, updated_at)
                        VALUES (:id, :name, :created_at, :updated_at)
                        """
                    ),
                    {
                        "id": folder["id"],
                        "name": folder["name"],
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
            has_syllabi = connection.execute(
                text("SELECT 1 FROM syllabi WHERE folder_id = :folder_id LIMIT 1"),
                {"folder_id": folder_id},
            ).first()
            if has_syllabi is not None:
                raise FolderNotEmpty
            connection.execute(text("DELETE FROM syllabus_folders WHERE id = :id"), {"id": folder_id})

    def move_to_folder(self, syllabus_id: str, folder_id: str | None) -> dict[str, Any]:
        current = self.get(syllabus_id)
        if folder_id and not self._folder_exists(folder_id):
            raise FolderNotFound
        updated_at = _timestamp()
        with self.engine.begin() as connection:
            connection.execute(
                text("UPDATE syllabi SET folder_id = :folder_id, updated_at = :updated_at WHERE id = :id"),
                {"folder_id": folder_id, "updated_at": updated_at, "id": syllabus_id},
            )
        return {**current, "folderId": folder_id, "updatedAt": updated_at}

    def delete(self, syllabus_id: str) -> None:
        self.get(syllabus_id)
        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM syllabus_field_history WHERE syllabus_id = :syllabus_id"),
                {"syllabus_id": syllabus_id},
            )
            connection.execute(text("DELETE FROM syllabi WHERE id = :id"), {"id": syllabus_id})

    def get(self, syllabus_id: str | None) -> dict[str, Any]:
        if not syllabus_id:
            raise SyllabusNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("SELECT *, content_json::text AS content_json_text FROM syllabi WHERE id = :id"),
                    {"id": syllabus_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise SyllabusNotFound
        return _record_from_row(row)

    def _folder_exists(self, folder_id: str) -> bool:
        with self.engine.connect() as connection:
            return connection.execute(
                text("SELECT 1 FROM syllabus_folders WHERE id = :id"), {"id": folder_id}
            ).first() is not None

    def update(  # noqa: PLR0913
        self,
        syllabus_id: str,
        *,
        expected_revision: int,
        content: dict[str, Any],
        course_title: str | None = None,
        course_code: str | None = None,
        academic_year: str | None = None,
    ) -> dict[str, Any]:
        current = self.get(syllabus_id)
        if current["revision"] != expected_revision:
            raise RevisionConflict
        updated = {
            **current,
            "courseTitle": course_title if course_title is not None else current["courseTitle"],
            "courseCode": course_code if course_code is not None else current["courseCode"],
            "academicYear": academic_year if academic_year is not None else current["academicYear"],
            "content": content,
            "revision": current["revision"] + 1,
            "updatedAt": _timestamp(),
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE syllabi
                    SET course_title = :course_title, course_code = :course_code, academic_year = :academic_year,
                        content_json = CAST(:content_json AS JSONB), revision = :revision, updated_at = :updated_at
                    WHERE id = :id AND revision = :expected_revision
                    """
                ),
                {
                    "id": syllabus_id,
                    "expected_revision": expected_revision,
                    "course_title": updated["courseTitle"],
                    "course_code": updated["courseCode"],
                    "academic_year": updated["academicYear"],
                    "content_json": json.dumps(updated["content"]),
                    "revision": updated["revision"],
                    "updated_at": updated["updatedAt"],
                },
            )
            if result.rowcount != 1:
                raise RevisionConflict
            for change in _update_changes(current, updated):
                _record_field_history(connection, syllabus_id, change, updated["revision"], updated["updatedAt"])
        return updated

    def field_history(self, syllabus_id: str, field_path: str) -> list[dict[str, Any]]:
        self.get(syllabus_id)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                    SELECT previous_value_json::text AS previous_value_json, new_value_json::text AS new_value_json,
                           revision, changed_at
                    FROM syllabus_field_history
                    WHERE syllabus_id = :syllabus_id AND field_path = :field_path
                    ORDER BY changed_at DESC, id DESC
                    LIMIT 100
                    """
                    ),
                    {"syllabus_id": syllabus_id, "field_path": field_path},
                )
                .mappings()
                .all()
            )
        history = [
            {
                "previousValue": json.loads(row["previous_value_json"]),
                "newValue": json.loads(row["new_value_json"]),
                "revision": row["revision"],
                "changedAt": row["changed_at"],
            }
            for row in rows
        ]
        history = _coalesce_history_entries(history)
        for entry in history:
            if isinstance(entry["previousValue"], str) and isinstance(entry["newValue"], str):
                entry["operations"] = _word_operations(entry["previousValue"], entry["newValue"])
        return history

    def compare(self, left_id: str, right_id: str) -> dict[str, Any]:
        left = self.get(left_id)
        right = self.get(right_id)
        if left["seriesId"] != right["seriesId"]:
            raise ComparisonNotAllowed
        if left["templateId"] != right["templateId"] and comparison_mapping(
            left["templateId"], right["templateId"]
        ) is None:
            raise TemplateComparisonNotMapped
        changes = _diff(left["content"], right["content"])
        for change in changes:
            change["label"] = _display_label(change["path"], left["content"], right["content"])
            if isinstance(change["left"], str) and isinstance(change["right"], str):
                change["operations"] = _word_operations(change["left"], change["right"])
        return {"left": left, "right": right, "changes": changes}


def default_content() -> dict[str, Any]:
    return {
        "identification": {
            "ects": "",
            "degreeLevelAndSemester": "",
            "programmeTitle": "",
            "contactHours": {},
            "prerequisites": "",
            "equipment": "",
        },
        "contacts": {"instructor": {}, "administrativeContact": {"name": "", "contactDetails": ""}},
        "description": {"overview": ""},
        "delivery": {"mode": "", "faceToFacePercent": "", "onlinePercent": ""},
        "learningOutcomes": {"plos": [], "clos": []},
        "schedule": [],
        "bibliography": {"books": [], "websites": [], "journalArticles": []},
        "teachingApproach": {"methods": "", "engagement": "", "feedback": ""},
        "assessment": {
            "items": [],
            "aiPolicy": "AI Prohibited",
            "aiInstructions": "",
            "methodologies": "",
            "rubrics": [],
            "lateSubmissionPolicy": "",
        },
        "documentControl": {
            "creationDate": "",
            "departmentName": "SCEN",
            "approvalDate": "",
            "versionNumber": "",
            "approver": "",
        },
    }


def _summary_from_row(row: RowMapping) -> dict[str, Any]:
    return {
        "id": row["id"],
        "seriesId": row["series_id"],
        "folderId": row["folder_id"],
        "courseTitle": row["course_title"],
        "courseCode": row["course_code"],
        "academicYear": row["academic_year"],
        "templateId": row["template_id"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _record_from_row(row: RowMapping) -> dict[str, Any]:
    return {**_summary_from_row(row), "content": json.loads(row["content_json_text"])}


def _folder_from_row(row: RowMapping) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]}


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _diff(left: Any, right: Any, path: str = "") -> list[dict[str, Any]]:
    if isinstance(left, dict) and isinstance(right, dict):
        return [
            change
            for key in sorted(set(left) | set(right))
            for change in _diff(left.get(key), right.get(key), f"{path}.{key}" if path else key)
        ]
    if isinstance(left, list) and isinstance(right, list) and _rows_have_ids(left) and _rows_have_ids(right):
        left_rows, right_rows = ({row["id"]: row for row in left}, {row["id"]: row for row in right})
        return [
            change
            for row_id in sorted(set(left_rows) | set(right_rows))
            for change in _diff(left_rows.get(row_id), right_rows.get(row_id), f"{path}[{row_id}]")
        ]
    if left == right:
        return []
    return [
        {
            "path": path,
            "left": left,
            "right": right,
            "kind": "added" if left is None else "removed" if right is None else "changed",
        }
    ]


def _rows_have_ids(value: list[Any]) -> bool:
    return all(isinstance(item, dict) and isinstance(item.get("id"), str) for item in value)


def _update_changes(current: dict[str, Any], updated: dict[str, Any]) -> list[dict[str, Any]]:
    changes = _value_changes(current["content"], updated["content"])
    for field in ("courseTitle", "courseCode", "academicYear"):
        if current[field] != updated[field]:
            changes.append({"path": f"metadata.{field}", "previousValue": current[field], "newValue": updated[field]})
    return changes


def _record_field_history(
    connection: Connection, syllabus_id: str, change: dict[str, Any], revision: int, changed_at: str
) -> None:
    latest = (
        connection.execute(
            text(
                """
            SELECT id, previous_value_json::text AS previous_value_json, changed_at
            FROM syllabus_field_history
            WHERE syllabus_id = :syllabus_id AND field_path = :field_path
            ORDER BY changed_at DESC, id DESC LIMIT 1
            """
            ),
            {"syllabus_id": syllabus_id, "field_path": change["path"]},
        )
        .mappings()
        .first()
    )
    if latest and _is_recent_change(latest["changed_at"], changed_at):
        previous_value = json.loads(latest["previous_value_json"])
        if previous_value == change["newValue"]:
            connection.execute(text("DELETE FROM syllabus_field_history WHERE id = :id"), {"id": latest["id"]})
        else:
            connection.execute(
                text(
                    "UPDATE syllabus_field_history "
                    "SET new_value_json = CAST(:value AS JSONB), revision = :revision, "
                    "changed_at = :changed_at WHERE id = :id"
                ),
                {
                    "value": json.dumps(change["newValue"]),
                    "revision": revision,
                    "changed_at": changed_at,
                    "id": latest["id"],
                },
            )
        return
    connection.execute(
        text(
            """
            INSERT INTO syllabus_field_history (
                syllabus_id, field_path, previous_value_json, new_value_json, revision, changed_at
            ) VALUES (
                :syllabus_id, :field_path, CAST(:previous_value AS JSONB),
                CAST(:new_value AS JSONB), :revision, :changed_at
            )
            """
        ),
        {
            "syllabus_id": syllabus_id,
            "field_path": change["path"],
            "previous_value": json.dumps(change["previousValue"]),
            "new_value": json.dumps(change["newValue"]),
            "revision": revision,
            "changed_at": changed_at,
        },
    )


def _coalesce_history_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    coalesced: list[dict[str, Any]] = []
    for entry in reversed(entries):
        if coalesced and _is_recent_change(coalesced[-1]["changedAt"], entry["changedAt"]):
            coalesced[-1].update(newValue=entry["newValue"], revision=entry["revision"], changedAt=entry["changedAt"])
            if coalesced[-1]["previousValue"] == coalesced[-1]["newValue"]:
                coalesced.pop()
        else:
            coalesced.append(entry)
    return list(reversed(coalesced))


def _is_recent_change(previous_changed_at: str, changed_at: str) -> bool:
    return (
        datetime.fromisoformat(changed_at) - datetime.fromisoformat(previous_changed_at)
    ).total_seconds() <= FIELD_HISTORY_COALESCE_SECONDS


def _value_changes(left: Any, right: Any, path: str = "") -> list[dict[str, Any]]:
    if isinstance(left, dict) and isinstance(right, dict):
        return [
            change
            for key in sorted(set(left) | set(right))
            for change in _value_changes(left.get(key), right.get(key), f"{path}.{key}" if path else key)
        ]
    if isinstance(left, list) and isinstance(right, list) and _rows_have_ids(left) and _rows_have_ids(right):
        left_rows, right_rows = ({row["id"]: row for row in left}, {row["id"]: row for row in right})
        return [
            change
            for row_id in sorted(set(left_rows) | set(right_rows))
            for change in _value_changes(left_rows.get(row_id), right_rows.get(row_id), f"{path}[{row_id}]")
        ]
    return [] if left == right else [{"path": path, "previousValue": left, "newValue": right}]


DISPLAY_LABELS = {
    "identification": "Course identification",
    "contacts": "Academic contacts",
    "description": "Course description",
    "delivery": "Course delivery",
    "learningOutcomes": "Learning outcomes",
    "schedule": "Course schedule",
    "bibliography": "Supplemental bibliographical resources",
    "teachingApproach": "Teaching and learning approach",
    "assessment": "Course assessment",
    "documentControl": "Document control",
    "contactHours": "Course contact hours",
    "instructor": "Instructor",
    "administrativeContact": "Academic coordinator",
    "contactDetails": "Contact details",
    "overview": "Course description",
    "mode": "Delivery mode",
    "faceToFacePercent": "Face-to-face (%)",
    "onlinePercent": "Online (%)",
    "plos": "Programme learning outcomes",
    "clos": "Course learning outcomes and alignment",
    "books": "Books",
    "websites": "Websites",
    "journalArticles": "Journal articles",
    "methods": "Teaching methods and learning activities",
    "engagement": "Student engagement",
    "feedback": "Feedback and academic progress",
    "items": "Summary of graded learning activities",
    "date": "Date",
    "type": "Assessment type",
    "weight": "Weight (%)",
    "ai": "AI policy",
    "aiPolicy": "AI policy",
    "aiInstructions": "Additional instructions regarding AI",
    "methodologies": "Assessment methodologies",
    "rubrics": "Grading rubrics",
    "lateSubmissionPolicy": "Late submission policy",
    "creationDate": "Document creation date",
    "departmentName": "Department name",
    "approvalDate": "Syllabus approval date",
    "versionNumber": "Version number",
    "approver": "Name and status of approver",
    "session": "Session",
    "topic": "Topic",
    "activities": "Pre-class learning / assessments",
    "preClass": "Pre-class learning activities",
    "assessments": "Assessments",
    "clo": "Course learning outcome",
    "plo": "Aligned PLO",
    "skills": "Graduate skills",
    "assignment": "Assessment type",
    "criteria": "Criteria",
    "criterion": "Criterion",
    "inadequate": "Inadequate (0–9)",
    "meets": "Meets expectations",
    "exceeds": "Exceeds expectations",
    "cloIds": "CLOs assessed",
    "aiAllowedUses": "Permitted AI uses",
    "aiOtherUse": "Other permitted AI use",
    "aiVerificationMechanism": "AI verification mechanism",
    "aiCustomPolicy": "Custom AI policy",
    "authors": "Author(s)",
    "title": "Title",
    "year": "Year",
    "edition": "Edition",
    "publisher": "Publisher",
    "isbn": "ISBN or URL",
    "organisation": "Name or organisation",
    "url": "URL",
    "accessedDate": "Accessed date",
    "journal": "Journal",
    "volume": "Volume",
    "issue": "Issue",
    "pages": "Pages",
    "doi": "DOI or URL",
    "code": "PLO code",
    "outcome": "Outcome",
    "ects": "Number of ECTS",
    "degreeLevelAndSemester": "Degree level and semester",
    "programmeTitle": "Programme title",
    "prerequisites": "Prerequisites and co-requisites",
    "equipment": "Equipment",
}


def _display_label(path: str, left: dict[str, Any], right: dict[str, Any]) -> str:
    labels: list[str] = []
    current_left: Any = left
    current_right: Any = right
    for segment in path.split("."):
        match = re.fullmatch(r"(.+)\[([^]]+)\]", segment)
        if match:
            key, row_id = match.groups()
            current_left, current_right = (
                _row_with_id(current_left.get(key, []) if isinstance(current_left, dict) else [], row_id),
                _row_with_id(current_right.get(key, []) if isinstance(current_right, dict) else [], row_id),
            )
            labels.append(_row_label(current_left) or _row_label(current_right) or _humanize_key(key))
        else:
            labels.append(_humanize_key(segment))
            current_left = current_left.get(segment) if isinstance(current_left, dict) else None
            current_right = current_right.get(segment) if isinstance(current_right, dict) else None
    return " · ".join(label for index, label in enumerate(labels) if index == 0 or label != labels[index - 1])


def _row_with_id(rows: Any, row_id: str) -> dict[str, Any] | None:
    return (
        next((row for row in rows if isinstance(row, dict) and row.get("id") == row_id), None)
        if isinstance(rows, list)
        else None
    )


def _row_label(row: dict[str, Any] | None) -> str:
    for key in ("type", "assignment", "clo", "session"):
        value = row.get(key) if row else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _humanize_key(key: str) -> str:
    return DISPLAY_LABELS.get(key, re.sub(r"(?<!^)([A-Z])", r" \1", key).replace("_", " ").title())


def _word_operations(left: str, right: str) -> list[dict[str, str]]:
    left_tokens, right_tokens = re.findall(r"\S+|\s+", left), re.findall(r"\S+|\s+", right)
    operations: list[dict[str, str]] = []
    for tag, left_start, left_end, right_start, right_end in SequenceMatcher(
        a=left_tokens, b=right_tokens, autojunk=False
    ).get_opcodes():
        left_text, right_text = "".join(left_tokens[left_start:left_end]), "".join(right_tokens[right_start:right_end])
        if tag == "equal":
            operations.append({"type": "equal", "text": left_text})
        elif tag == "insert":
            operations.append({"type": "insert", "text": right_text})
        elif tag == "delete":
            operations.append({"type": "delete", "text": left_text})
        else:
            operations.append({"type": "substitute", "left": left_text, "right": right_text})
    return operations
