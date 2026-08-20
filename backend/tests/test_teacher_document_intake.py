import logging
from uuid import uuid4

import pytest

from sorbonne.services import teacher_document_intake as intake
from sorbonne.services.teacher_document_intake import (
    DocumentAuthorizationError,
    FormResponse,
    GoogleDocumentDriveGateway,
    TeacherDocumentIntake,
    parse_form_responses,
)
from sorbonne.services.teacher_document_store import TeacherDocumentStore
from sorbonne.services.teacher_store import TeacherStore


TEST_DATABASE_URL = "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test"


class FakeDriveGateway:
    def __init__(self, rows: list[list[object]]) -> None:
        self.rows = rows
        self.copies: list[tuple[str, str]] = []
        self.shared: list[tuple[str, tuple[str, ...]]] = []
        self.trashed: list[str] = []

    def response_sheet_rows(self) -> list[list[object]]:
        return self.rows

    def create_folder(self, name: str) -> tuple[str, str]:
        return "new-folder", "https://drive.google.com/drive/folders/new-folder"

    def copy_file(self, source_file_id: str, destination_folder_id: str) -> None:
        self.copies.append((source_file_id, destination_folder_id))

    def share_folder_with_readers(self, folder_id: str, emails: tuple[str, ...]) -> None:
        self.shared.append((folder_id, emails))

    def trash_folder(self, folder_id: str) -> None:
        self.trashed.append(folder_id)


def test_keeps_only_the_newest_response_for_each_email_and_extracts_drive_files() -> None:
    responses = parse_form_responses(
        [
            ["Timestamp", "Email Address", "CV"],
            ["2026-08-19T09:00:00+00:00", "MARIE@example.edu", "https://drive.google.com/file/d/old-file-12345/view"],
            ["2026-08-19T10:00:00+00:00", "marie@example.edu", "https://drive.google.com/open?id=new-file-67890"],
        ],
        email_header="Email Address",
        timestamp_header="Timestamp",
    )

    assert responses == [
        FormResponse(
            email="marie@example.edu",
            timestamp="2026-08-19T10:00:00+00:00",
            file_ids=("new-file-67890",),
            fingerprint=responses[0].fingerprint,
        )
    ]


def test_extracts_all_comma_separated_google_form_uploads() -> None:
    value = ", ".join(
        f"https://drive.google.com/open?id=upload-{number}-12345" for number in range(1, 6)
    )

    assert intake._extract_drive_file_ids(value) == (
        "upload-1-12345",
        "upload-2-12345",
        "upload-3-12345",
        "upload-4-12345",
        "upload-5-12345",
    )


def test_sync_replaces_a_matched_teachers_managed_folder() -> None:
    email = f"teacher-documents-{uuid4()}@example.edu"
    teacher = TeacherStore(TEST_DATABASE_URL).create_teacher(full_name="Marie Document", email=email)
    document_store = TeacherDocumentStore(TEST_DATABASE_URL)
    document_store.save_folder(
        teacher_id=teacher["id"],
        drive_folder_id="old-folder",
        drive_folder_url="https://drive.google.com/drive/folders/old-folder",
        response_fingerprint="old-response",
        response_timestamp="2026-08-18T10:00:00+00:00",
    )
    gateway = FakeDriveGateway(
        [
            ["Timestamp", "Email Address", "CV"],
            ["2026-08-19T10:00:00+00:00", email, "https://drive.google.com/file/d/new-file-67890/view"],
        ]
    )

    result = TeacherDocumentIntake(
        teacher_store=TeacherStore(TEST_DATABASE_URL),
        document_store=document_store,
        gateway=gateway,
        email_header="Email Address",
        timestamp_header="Timestamp",
        allowed_reader_emails=("staff@example.edu",),
    ).sync()

    assert result.updated == 1
    assert gateway.copies == [("new-file-67890", "new-folder")]
    assert gateway.shared == [("new-folder", ("staff@example.edu",))]
    assert gateway.trashed == ["old-folder"]
    assert document_store.get_folder(teacher["id"])["driveFolderId"] == "new-folder"


def test_sync_queues_ambiguous_email_without_copying_documents() -> None:
    email = f"ambiguous-documents-{uuid4()}@example.edu"
    teacher_store = TeacherStore(TEST_DATABASE_URL)
    teacher_store.create_teacher(full_name="First Match", email=email)
    teacher_store.create_teacher(full_name="Second Match", email=email.upper())
    document_store = TeacherDocumentStore(TEST_DATABASE_URL)
    gateway = FakeDriveGateway(
        [
            ["Timestamp", "Email Address", "CV"],
            ["2026-08-19T10:00:00+00:00", email, "https://drive.google.com/file/d/new-file-67890/view"],
        ]
    )

    result = TeacherDocumentIntake(
        teacher_store=teacher_store,
        document_store=document_store,
        gateway=gateway,
        email_header="Email Address",
        timestamp_header="Timestamp",
        allowed_reader_emails=("staff@example.edu",),
    ).sync()

    assert result.needs_review == 1
    assert gateway.copies == []
    assert document_store.list_open_issues()[0]["reason"] == "AMBIGUOUS_EMAIL"


def test_sync_logs_the_failed_stage_without_document_or_email_details(caplog: pytest.LogCaptureFixture) -> None:
    email = f"copy-failure-{uuid4()}@example.edu"
    teacher_store = TeacherStore(TEST_DATABASE_URL)
    teacher_store.create_teacher(full_name="Copy Failure", email=email)

    class FailingGateway(FakeDriveGateway):
        def copy_file(self, source_file_id: str, destination_folder_id: str) -> None:
            raise RuntimeError("Google Drive copy failed")

    gateway = FailingGateway(
        [["Timestamp", "Email Address", "CV"], ["2026-08-19T10:00:00+00:00", email, "https://drive.google.com/file/d/new-file-67890/view"]]
    )

    with caplog.at_level(logging.ERROR, logger="sorbonne.services.teacher_document_intake"):
        result = TeacherDocumentIntake(
            teacher_store=teacher_store,
            document_store=TeacherDocumentStore(TEST_DATABASE_URL),
            gateway=gateway,
            email_header="Email Address",
            timestamp_header="Timestamp",
            allowed_reader_emails=("staff@example.edu",),
        ).sync()

    assert result.needs_review == 1
    assert '"event": "teacher_document_sync_copy_failed"' in caplog.text
    assert '"stage": "copy_file"' in caplog.text
    assert email not in caplog.text


def test_rejects_a_drive_token_owned_by_a_different_account(monkeypatch: pytest.MonkeyPatch) -> None:
    class Settings:
        google_documents_service_account_json = None
        google_documents_response_sheet_id = "response-sheet"
        google_documents_response_sheet_range = "Form Responses 1!A:ZZ"
        google_documents_drive_root_folder_id = "managed-root"

    class OAuthUserInfo:
        def get(self) -> "OAuthUserInfo":
            return self

        def execute(self) -> dict[str, str]:
            return {"email": "different-account@example.edu"}

    monkeypatch.setattr(intake, "Credentials", lambda token: object())
    monkeypatch.setattr(
        intake,
        "build",
        lambda service, *_args, **_kwargs: OAuthUserInfo() if service == "oauth2" else object(),
    )

    with pytest.raises(DocumentAuthorizationError):
        GoogleDocumentDriveGateway(Settings(), access_token="temporary-token", expected_email="staff@example.edu")
