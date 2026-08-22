"""Upload SCEN timetables into the student platform from inside Coordinator Tools."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.student_timetables import (
    StudentPlatformClient,
    StudentPlatformError,
    StudentPlatformNotConfigured,
)

router = APIRouter(prefix="/timetables", tags=["timetables"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def get_client() -> StudentPlatformClient:
    if not config.scen_student_platform_url or not config.scen_student_platform_token:
        raise StudentPlatformNotConfigured
    return StudentPlatformClient(config.scen_student_platform_url, config.scen_student_platform_token)


def require_client() -> StudentPlatformClient:
    try:
        return get_client()
    except StudentPlatformNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Timetable uploads are disabled because SCEN_STUDENT_PLATFORM_URL and "
            "SCEN_STUDENT_PLATFORM_TOKEN are not configured for this deployment.",
        ) from exc


class PublishInput(BaseModel):
    published: bool


class AnnouncementInput(BaseModel):
    icon: str = Field(min_length=1, max_length=40)
    message: str = Field(min_length=1, max_length=160)


class AnnouncementsInput(BaseModel):
    announcements: list[AnnouncementInput]


class AssignmentInput(BaseModel):
    """The CRNs this student should hold, and the version the screen was showing."""

    crns: list[str] = Field(default_factory=list, max_length=40)
    version: int = Field(ge=0)


async def _read_upload(file: UploadFile, label: str) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The {label} file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The {label} file is larger than 20 MB.")
    return content


def _forward(error: StudentPlatformError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail or str(error))


@router.get("/status")
async def integration_status() -> dict[str, Any]:
    """Lets the tool explain itself instead of failing on the first click."""
    try:
        client = get_client()
    except StudentPlatformNotConfigured:
        return {"configured": False, "host": None}
    return {"configured": True, "host": client.host}


@router.get("/terms")
async def list_terms(client: StudentPlatformClient = Depends(require_client)) -> dict[str, Any]:
    try:
        return {"terms": await client.list_terms()}
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.post("/terms", status_code=status.HTTP_201_CREATED)
async def import_term(
    name: str = Form(min_length=1, max_length=160),
    timezone: str = Form(default="Asia/Dubai", max_length=60),
    timetable: UploadFile = File(...),
    enrolments: list[UploadFile] = File(...),
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    timetable_bytes = await _read_upload(timetable, "timetable")
    student_files = [
        (upload.filename or "students.xlsx", await _read_upload(upload, "student list"))
        for upload in enrolments
    ]
    try:
        return await client.import_term(
            name=name,
            timezone=timezone,
            timetable=(timetable.filename or "timetable.xls", timetable_bytes),
            enrolments=student_files,
        )
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.post("/terms/{term_id}/publish")
async def publish_term(
    term_id: str, body: PublishInput, client: StudentPlatformClient = Depends(require_client)
) -> dict[str, Any]:
    try:
        return await client.set_published(term_id, body.published)
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.delete("/terms/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_term(term_id: str, client: StudentPlatformClient = Depends(require_client)) -> None:
    try:
        await client.delete_term(term_id)
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.get("/terms/{term_id}/roster")
async def read_roster(
    term_id: str, client: StudentPlatformClient = Depends(require_client)
) -> dict[str, Any]:
    """Student ids and their CRNs. Names never pass through here — see the roster screen."""
    try:
        return await client.read_roster(term_id)
    except StudentPlatformError as error:
        raise _forward(error) from error


@router.put("/terms/{term_id}/roster/{student_id}")
async def set_student_assignment(
    term_id: str,
    student_id: str,
    body: AssignmentInput,
    request: Request,
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    """Place, move, or drop one student. The signed-in coordinator is recorded as the editor."""
    staff = getattr(request.state, "staff_user", None)
    try:
        return await client.set_student_assignment(
            term_id=term_id,
            student_id=student_id,
            crns=body.crns,
            version=body.version,
            actor=getattr(staff, "email", "") or "",
        )
    except StudentPlatformError as error:
        raise _forward(error) from error


@router.get("/announcements")
async def list_announcements(client: StudentPlatformClient = Depends(require_client)) -> dict[str, Any]:
    try:
        return await client.list_announcements()
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.put("/announcements")
async def replace_announcements(
    body: AnnouncementsInput, client: StudentPlatformClient = Depends(require_client)
) -> dict[str, Any]:
    try:
        return await client.replace_announcements([item.model_dump() for item in body.announcements])
    except StudentPlatformError as exc:
        raise _forward(exc) from exc
