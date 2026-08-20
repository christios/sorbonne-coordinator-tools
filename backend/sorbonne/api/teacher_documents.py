from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from starlette.responses import FileResponse

from sorbonne.config import config
from sorbonne.services.document_access import document_access_emails, require_document_access
from sorbonne.services.teacher_document_intake import (
    DocumentIntegrationUnavailable,
    DocumentAuthorizationError,
    GoogleDocumentDriveGateway,
    TeacherDocumentIntake,
)
from sorbonne.services.teacher_document_store import TeacherDocumentStore
from sorbonne.services.teacher_store import TeacherNotFound, TeacherStore

router = APIRouter(prefix="/teacher-documents", tags=["teacher documents"])
_MAX_DRIVE_ACCESS_TOKEN_LENGTH = 8_192


def get_teacher_store() -> TeacherStore:
    return TeacherStore(config.database_url)


def get_document_store() -> TeacherDocumentStore:
    return TeacherDocumentStore(config.database_url)


def _gateway(*, access_token: str | None = None, expected_email: str | None = None) -> GoogleDocumentDriveGateway:
    try:
        return GoogleDocumentDriveGateway(config, access_token=access_token, expected_email=expected_email)
    except DocumentIntegrationUnavailable as exc:
        raise HTTPException(status_code=503, detail="Document workflow is not configured.") from exc
    except DocumentAuthorizationError as exc:
        raise HTTPException(status_code=401, detail="Google Drive permission is required.") from exc


@router.get("/issues")
def list_document_issues(
    _: str = Depends(require_document_access), document_store: TeacherDocumentStore = Depends(get_document_store)
) -> dict[str, list[dict[str, object]]]:
    return {"items": document_store.list_open_issues()}


@router.post("/sync")
def sync_document_responses(
    staff_email: str = Depends(require_document_access),
    google_drive_access_token: str | None = Header(default=None, alias="X-Google-Drive-Access-Token"),
    teacher_store: TeacherStore = Depends(get_teacher_store),
    document_store: TeacherDocumentStore = Depends(get_document_store),
) -> dict[str, int]:
    if not google_drive_access_token or len(google_drive_access_token) > _MAX_DRIVE_ACCESS_TOKEN_LENGTH:
        raise HTTPException(status_code=401, detail="Google Drive permission is required.")
    try:
        result = TeacherDocumentIntake(
            teacher_store=teacher_store,
            document_store=document_store,
            gateway=_gateway(access_token=google_drive_access_token, expected_email=staff_email),
            email_header=config.google_documents_response_email_header,
            timestamp_header=config.google_documents_response_timestamp_header,
            allowed_reader_emails=tuple(document_access_emails()),
        ).sync()
    except DocumentIntegrationUnavailable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"updated": result.updated, "skipped": result.skipped, "needsReview": result.needs_review}


@router.get("/teachers/{teacher_id}")
def get_teacher_documents(
    teacher_id: str,
    _: str = Depends(require_document_access),
    teacher_store: TeacherStore = Depends(get_teacher_store),
    document_store: TeacherDocumentStore = Depends(get_document_store),
) -> dict[str, object]:
    try:
        teacher_store.get_teacher(teacher_id)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc
    return {"folder": document_store.get_folder(teacher_id)}


@router.get("/teachers/{teacher_id}/download")
def download_teacher_documents(
    teacher_id: str,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_document_access),
    teacher_store: TeacherStore = Depends(get_teacher_store),
    document_store: TeacherDocumentStore = Depends(get_document_store),
) -> FileResponse:
    try:
        teacher = teacher_store.get_teacher(teacher_id)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc
    folder = document_store.get_folder(teacher_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="No managed document folder has been created for this teacher.")
    with NamedTemporaryFile(prefix="teacher-documents-", suffix=".zip", delete=False) as file:
        output_path = Path(file.name)
    try:
        _gateway().write_folder_zip(folder["driveFolderId"], output_path, config.google_documents_max_zip_bytes)
    except ValueError as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail="The managed document folder could not be downloaded.") from exc
    background_tasks.add_task(output_path.unlink, missing_ok=True)
    return FileResponse(
        output_path,
        media_type="application/zip",
        filename=f"{_safe_filename(teacher['fullName'])}-documents.zip",
        background=background_tasks,
    )


def _safe_filename(value: object) -> str:
    text = "".join(character if str(character).isalnum() else "-" for character in str(value)).strip("-")
    return text or "teacher"
