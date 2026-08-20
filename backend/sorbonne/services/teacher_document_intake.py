from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
import json
import logging
import re
from pathlib import Path
from typing import Protocol, Sequence
from zipfile import ZIP_DEFLATED, ZipFile

from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from sorbonne.config import Config
from sorbonne.services.teacher_document_store import TeacherDocumentStore
from sorbonne.services.teacher_store import TeacherStore


DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
_DRIVE_FILE_URL_PATTERNS = (
    re.compile(r"https?://drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})(?:[/?#]|$)"),
    re.compile(r"https?://drive\.google\.com/open\?[^\s]*\bid=([A-Za-z0-9_-]{10,})(?:[&#,\s]|$)"),
)
_MAX_ARCHIVE_FILES = 100
logger = logging.getLogger(__name__)


class DocumentIntegrationUnavailable(Exception):
    pass


class DocumentAuthorizationError(Exception):
    pass


@dataclass(frozen=True)
class FormResponse:
    email: str
    timestamp: str
    file_ids: tuple[str, ...]
    fingerprint: str


@dataclass(frozen=True)
class DocumentSyncResult:
    updated: int = 0
    skipped: int = 0
    needs_review: int = 0


class DocumentDriveGateway(Protocol):
    def response_sheet_rows(self) -> list[list[object]]: ...

    def create_folder(self, name: str) -> tuple[str, str]: ...

    def copy_file(self, source_file_id: str, destination_folder_id: str) -> None: ...

    def share_folder_with_readers(self, folder_id: str, emails: Sequence[str]) -> None: ...

    def trash_folder(self, folder_id: str) -> None: ...


class GoogleDocumentDriveGateway:
    """Google API adapter for either an admin's temporary token or the service account."""

    def __init__(self, settings: Config, *, access_token: str | None = None, expected_email: str | None = None) -> None:
        if not settings.google_documents_response_sheet_id or not settings.google_documents_drive_root_folder_id:
            raise DocumentIntegrationUnavailable("Document integration is not configured.")
        if access_token:
            credentials = Credentials(token=access_token)
            try:
                profile = (
                    build("oauth2", "v2", credentials=credentials, cache_discovery=False).userinfo().get().execute()
                )
            except Exception as exc:
                raise DocumentAuthorizationError("Google Drive permission is required.") from exc
            token_email = _normalize_email(str(profile.get("email") or ""))
            if not expected_email or token_email != _normalize_email(expected_email):
                raise DocumentAuthorizationError("Google Drive permission is required.")
        else:
            if not settings.google_documents_service_account_json:
                raise DocumentIntegrationUnavailable("Document integration is not configured.")
            try:
                service_account_info = json.loads(settings.google_documents_service_account_json)
                credentials = service_account.Credentials.from_service_account_info(
                    service_account_info, scopes=[DRIVE_SCOPE, SHEETS_SCOPE]
                )
            except (TypeError, ValueError) as exc:
                raise DocumentIntegrationUnavailable("Document integration is not configured.") from exc
        self.sheet_id = settings.google_documents_response_sheet_id
        self.sheet_range = settings.google_documents_response_sheet_range
        self.root_folder_id = settings.google_documents_drive_root_folder_id
        self.sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False)
        self.drive = build("drive", "v3", credentials=credentials, cache_discovery=False)

    def response_sheet_rows(self) -> list[list[object]]:
        response = self.sheets.spreadsheets().values().get(
            spreadsheetId=self.sheet_id,
            range=self.sheet_range,
            majorDimension="ROWS",
        ).execute()
        values = response.get("values", [])
        return values if isinstance(values, list) else []

    def create_folder(self, name: str) -> tuple[str, str]:
        response = self.drive.files().create(
            body={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [self.root_folder_id]},
            fields="id,webViewLink",
            supportsAllDrives=True,
        ).execute()
        folder_id = str(response["id"])
        return folder_id, str(response.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}")

    def copy_file(self, source_file_id: str, destination_folder_id: str) -> None:
        self.drive.files().copy(
            fileId=source_file_id,
            body={"parents": [destination_folder_id]},
            fields="id",
            supportsAllDrives=True,
        ).execute()

    def share_folder_with_readers(self, folder_id: str, emails: Sequence[str]) -> None:
        for email in emails:
            self.drive.permissions().create(
                fileId=folder_id,
                body={"type": "user", "role": "reader", "emailAddress": email},
                sendNotificationEmail=False,
                supportsAllDrives=True,
            ).execute()

    def trash_folder(self, folder_id: str) -> None:
        self.drive.files().update(
            fileId=folder_id, body={"trashed": True}, fields="id", supportsAllDrives=True
        ).execute()

    def write_folder_zip(self, folder_id: str, output_path: Path, max_bytes: int) -> None:
        files: list[dict[str, object]] = []
        page_token: str | None = None
        while True:
            response = self.drive.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken,files(id,name,mimeType,size)",
                pageToken=page_token,
                pageSize=100,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
            files.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        if len(files) > _MAX_ARCHIVE_FILES:
            raise ValueError("The managed document folder has too many files to download at once.")
        total_size = 0
        with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as archive:
            for file in files:
                size = int(file.get("size") or 0)
                total_size += size
                if total_size > max_bytes:
                    raise ValueError("The managed document folder is too large to download as one ZIP file.")
                mime_type = str(file.get("mimeType") or "")
                if mime_type.startswith("application/vnd.google-apps"):
                    raise ValueError("Google Workspace files must be downloaded from Google Drive individually.")
                contents = self.drive.files().get_media(
                    fileId=str(file["id"]), supportsAllDrives=True
                ).execute()
                archive.writestr(_safe_archive_name(str(file.get("name") or "document")), contents)


class TeacherDocumentIntake:
    # Reader access is deployment configuration, deliberately separate from the
    # identity token of the staff member who initiated a sync.
    # ruff: noqa: PLR0913
    def __init__(
        self,
        *,
        teacher_store: TeacherStore,
        document_store: TeacherDocumentStore,
        gateway: DocumentDriveGateway,
        email_header: str,
        timestamp_header: str,
        allowed_reader_emails: Sequence[str],
    ) -> None:
        self.teacher_store = teacher_store
        self.document_store = document_store
        self.gateway = gateway
        self.email_header = email_header
        self.timestamp_header = timestamp_header
        self.allowed_reader_emails = tuple(
            normalized for item in allowed_reader_emails if (normalized := _normalize_email(item))
        )

    def sync(self) -> DocumentSyncResult:
        responses = parse_form_responses(
            self.gateway.response_sheet_rows(), email_header=self.email_header, timestamp_header=self.timestamp_header
        )
        result = DocumentSyncResult()
        for response in responses:
            matches = self.teacher_store.find_active_teachers_by_email(response.email)
            if len(matches) != 1:
                message = (
                    "No active teacher profile has this email address."
                    if not matches
                    else "More than one active teacher profile has this email address."
                )
                self.document_store.upsert_issue(
                    source_email=response.email,
                    source_timestamp=response.timestamp,
                    source_fingerprint=response.fingerprint,
                    reason="UNMATCHED_EMAIL" if not matches else "AMBIGUOUS_EMAIL",
                    message=message,
                )
                result = _add_result(result, needs_review=1)
                continue

            teacher = matches[0]
            current = self.document_store.get_folder(teacher["id"])
            if current and current["responseFingerprint"] == response.fingerprint:
                result = _add_result(result, skipped=1)
                continue
            try:
                self._replace_teacher_documents(teacher=teacher, response=response, current=current)
            except Exception:  # Google API errors are intentionally not exposed to staff clients.
                self.document_store.upsert_issue(
                    source_email=response.email,
                    source_timestamp=response.timestamp,
                    source_fingerprint=response.fingerprint,
                    reason="COPY_FAILED",
                    message="The latest response could not be copied to the managed document folder.",
                )
                result = _add_result(result, needs_review=1)
                continue
            self.document_store.resolve_issues_for_email(response.email)
            result = _add_result(result, updated=1)
        return result

    def _replace_teacher_documents(
        self, *, teacher: dict[str, object], response: FormResponse, current: dict[str, object] | None
    ) -> None:
        folder_name = _folder_name(str(teacher["fullName"]), str(teacher["id"]))
        new_folder_id: str | None = None
        stage = "create_folder"
        try:
            new_folder_id, new_folder_url = self.gateway.create_folder(folder_name)
            stage = "copy_file"
            for file_id in response.file_ids:
                self.gateway.copy_file(file_id, new_folder_id)
            stage = "share_folder"
            self.gateway.share_folder_with_readers(new_folder_id, self.allowed_reader_emails)
            stage = "save_folder"
            self.document_store.save_folder(
                teacher_id=str(teacher["id"]),
                drive_folder_id=new_folder_id,
                drive_folder_url=new_folder_url,
                response_fingerprint=response.fingerprint,
                response_timestamp=response.timestamp,
            )
        except Exception as exc:
            logger.exception(
                json.dumps(
                    {
                        "event": "teacher_document_sync_copy_failed",
                        "stage": stage,
                        "attachment_count": len(response.file_ids),
                        "error_type": type(exc).__name__,
                    },
                    sort_keys=True,
                )
            )
            if new_folder_id:
                try:
                    self.gateway.trash_folder(new_folder_id)
                except Exception:
                    pass
            raise
        if current:
            try:
                self.gateway.trash_folder(str(current["driveFolderId"]))
            except Exception:
                # The new folder is already the source of truth. A stale, trashed-later
                # folder is a recoverable operational cleanup, not a sync failure.
                pass


def parse_form_responses(
    rows: list[list[object]], *, email_header: str, timestamp_header: str
) -> list[FormResponse]:
    if not rows:
        return []
    headers = [str(cell).strip() for cell in rows[0]]
    try:
        email_index = headers.index(email_header)
        timestamp_index = headers.index(timestamp_header)
    except ValueError as exc:
        raise DocumentIntegrationUnavailable("The configured response-sheet headers were not found.") from exc

    latest_by_email: dict[str, tuple[datetime, FormResponse]] = {}
    for row in rows[1:]:
        email = _normalize_email(_cell(row, email_index))
        timestamp = _cell(row, timestamp_index)
        if not email or not timestamp:
            continue
        parsed_timestamp = _parse_timestamp(timestamp)
        if parsed_timestamp is None:
            continue
        file_ids = tuple(
            dict.fromkeys(file_id for cell in row for file_id in _extract_drive_file_ids(_cell_text(cell)))
        )
        fingerprint = sha256(
            json.dumps({"email": email, "timestamp": timestamp, "fileIds": file_ids}, sort_keys=True).encode()
        ).hexdigest()
        candidate = FormResponse(email=email, timestamp=timestamp, file_ids=file_ids, fingerprint=fingerprint)
        current = latest_by_email.get(email)
        if current is None or parsed_timestamp > current[0]:
            latest_by_email[email] = (parsed_timestamp, candidate)
    return [candidate for _, candidate in sorted(latest_by_email.values(), key=lambda item: item[0], reverse=True)]


def _add_result(result: DocumentSyncResult, **increments: int) -> DocumentSyncResult:
    return DocumentSyncResult(
        updated=result.updated + increments.get("updated", 0),
        skipped=result.skipped + increments.get("skipped", 0),
        needs_review=result.needs_review + increments.get("needs_review", 0),
    )


def _cell(row: list[object], index: int) -> str:
    return _cell_text(row[index]) if index < len(row) else ""


def _cell_text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _normalize_email(value: str) -> str:
    return value.strip().casefold()


def _extract_drive_file_ids(value: str) -> tuple[str, ...]:
    return tuple(match.group(1) for pattern in _DRIVE_FILE_URL_PATTERNS for match in pattern.finditer(value))


def _parse_timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        for pattern in ("%m/%d/%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M"):
            try:
                parsed = datetime.strptime(value, pattern).replace(tzinfo=UTC)
                break
            except ValueError:
                continue
        else:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _folder_name(full_name: str, teacher_id: str) -> str:
    safe_name = " ".join(full_name.split())[:100] or "Teacher"
    return f"{safe_name} — {teacher_id[:8]}"


def _safe_archive_name(name: str) -> str:
    return Path(name).name.replace("\\", "_") or "document"
