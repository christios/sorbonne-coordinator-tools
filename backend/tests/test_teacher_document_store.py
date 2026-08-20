from uuid import uuid4

from sorbonne.services.teacher_document_store import TeacherDocumentStore
from sorbonne.services.teacher_store import TeacherStore


TEST_DATABASE_URL = "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test"


def test_remembers_the_current_drive_folder_and_deduplicates_review_issues() -> None:
    issue_key = str(uuid4())
    teacher = TeacherStore(TEST_DATABASE_URL).create_teacher(
        full_name="Dr Document Example", email=f"documents-{uuid4()}@example.edu"
    )
    store = TeacherDocumentStore(TEST_DATABASE_URL)

    saved = store.save_folder(
        teacher_id=teacher["id"],
        drive_folder_id="drive-folder-1",
        drive_folder_url="https://drive.google.com/drive/folders/drive-folder-1",
        response_fingerprint="first-response",
        response_timestamp="2026-08-19T10:00:00+00:00",
    )
    issue = store.upsert_issue(
        source_email=f"missing-{issue_key}@example.edu",
        source_timestamp="2026-08-19T10:00:00+00:00",
        source_fingerprint=f"unmatched-response-{issue_key}",
        reason="UNMATCHED_EMAIL",
        message="No active teacher profile has this email address.",
    )
    same_issue = store.upsert_issue(
        source_email=f"missing-{issue_key}@example.edu",
        source_timestamp="2026-08-19T10:00:00+00:00",
        source_fingerprint=f"unmatched-response-{issue_key}",
        reason="UNMATCHED_EMAIL",
        message="No active teacher profile has this email address.",
    )

    assert saved["teacherId"] == teacher["id"]
    assert store.get_folder(teacher["id"])["driveFolderId"] == "drive-folder-1"
    assert issue["id"] == same_issue["id"]
    assert any(item["id"] == issue["id"] and item["reason"] == "UNMATCHED_EMAIL" for item in store.list_open_issues())
