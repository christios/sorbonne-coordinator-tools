from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, create_engine, text


class TeacherDocumentStore:
    """Persistence for managed teacher document folders and sync exceptions."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def get_folder(self, teacher_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                text(
                    """
                    SELECT teacher_id, drive_folder_id, drive_folder_url, response_fingerprint,
                           response_timestamp, synced_at, created_at, updated_at
                    FROM teacher_document_folders WHERE teacher_id = :teacher_id
                    """
                ),
                {"teacher_id": teacher_id},
            ).mappings().first()
        return _folder_from_row(row) if row else None

    def save_folder(
        self,
        *,
        teacher_id: str,
        drive_folder_id: str,
        drive_folder_url: str,
        response_fingerprint: str,
        response_timestamp: str,
    ) -> dict[str, Any]:
        now = _timestamp()
        folder = {
            "teacherId": teacher_id,
            "driveFolderId": drive_folder_id,
            "driveFolderUrl": drive_folder_url,
            "responseFingerprint": response_fingerprint,
            "responseTimestamp": response_timestamp,
            "syncedAt": now,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO teacher_document_folders (
                        teacher_id, drive_folder_id, drive_folder_url, response_fingerprint,
                        response_timestamp, synced_at, created_at, updated_at
                    ) VALUES (
                        :teacher_id, :drive_folder_id, :drive_folder_url, :response_fingerprint,
                        :response_timestamp, :synced_at, :created_at, :updated_at
                    )
                    ON CONFLICT (teacher_id) DO UPDATE SET
                        drive_folder_id = EXCLUDED.drive_folder_id,
                        drive_folder_url = EXCLUDED.drive_folder_url,
                        response_fingerprint = EXCLUDED.response_fingerprint,
                        response_timestamp = EXCLUDED.response_timestamp,
                        synced_at = EXCLUDED.synced_at,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                _folder_params(folder),
            )
        return self.get_folder(teacher_id) or folder

    def list_open_issues(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT id, source_email, source_timestamp, source_fingerprint, reason, message,
                           status, created_at, updated_at
                    FROM teacher_document_intake_issues
                    WHERE status = 'OPEN'
                    ORDER BY updated_at DESC
                    """
                )
            ).mappings().all()
        return [_issue_from_row(row) for row in rows]

    def upsert_issue(
        self,
        *,
        source_email: str,
        source_timestamp: str,
        source_fingerprint: str,
        reason: str,
        message: str,
    ) -> dict[str, Any]:
        now = _timestamp()
        issue = {
            "id": str(uuid4()),
            "sourceEmail": source_email,
            "sourceTimestamp": source_timestamp,
            "sourceFingerprint": source_fingerprint,
            "reason": reason,
            "message": message,
            "status": "OPEN",
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO teacher_document_intake_issues (
                        id, source_email, source_timestamp, source_fingerprint, reason, message,
                        status, created_at, updated_at
                    ) VALUES (
                        :id, :source_email, :source_timestamp, :source_fingerprint, :reason, :message,
                        :status, :created_at, :updated_at
                    )
                    ON CONFLICT (source_fingerprint, reason) DO UPDATE SET
                        message = EXCLUDED.message, status = 'OPEN', updated_at = EXCLUDED.updated_at
                    """
                ),
                _issue_params(issue),
            )
            row = connection.execute(
                text(
                    """
                    SELECT id, source_email, source_timestamp, source_fingerprint, reason, message,
                           status, created_at, updated_at
                    FROM teacher_document_intake_issues
                    WHERE source_fingerprint = :source_fingerprint AND reason = :reason
                    """
                ),
                {"source_fingerprint": source_fingerprint, "reason": reason},
            ).mappings().one()
        return _issue_from_row(row)

    def resolve_issues_for_email(self, source_email: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE teacher_document_intake_issues
                    SET status = 'RESOLVED', updated_at = :updated_at
                    WHERE source_email = :source_email AND status = 'OPEN'
                    """
                ),
                {"source_email": source_email, "updated_at": _timestamp()},
            )


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _folder_from_row(row: Any) -> dict[str, Any]:
    return {
        "teacherId": row["teacher_id"],
        "driveFolderId": row["drive_folder_id"],
        "driveFolderUrl": row["drive_folder_url"],
        "responseFingerprint": row["response_fingerprint"],
        "responseTimestamp": row["response_timestamp"],
        "syncedAt": row["synced_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _folder_params(folder: dict[str, Any]) -> dict[str, Any]:
    return {
        "teacher_id": folder["teacherId"],
        "drive_folder_id": folder["driveFolderId"],
        "drive_folder_url": folder["driveFolderUrl"],
        "response_fingerprint": folder["responseFingerprint"],
        "response_timestamp": folder["responseTimestamp"],
        "synced_at": folder["syncedAt"],
        "created_at": folder["createdAt"],
        "updated_at": folder["updatedAt"],
    }


def _issue_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sourceEmail": row["source_email"],
        "sourceTimestamp": row["source_timestamp"],
        "sourceFingerprint": row["source_fingerprint"],
        "reason": row["reason"],
        "message": row["message"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _issue_params(issue: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": issue["id"],
        "source_email": issue["sourceEmail"],
        "source_timestamp": issue["sourceTimestamp"],
        "source_fingerprint": issue["sourceFingerprint"],
        "reason": issue["reason"],
        "message": issue["message"],
        "status": issue["status"],
        "created_at": issue["createdAt"],
        "updated_at": issue["updatedAt"],
    }
