from pathlib import Path
from io import BytesIO
from tempfile import NamedTemporaryFile
from typing import Any
from zipfile import BadZipFile

import openpyxl
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from sorbonne.config import config
from sorbonne.services.requisition_export import build_requisition_docx
from sorbonne.services.teacher_store import (
    FolderNameConflict,
    FolderNotEmpty,
    FolderNotFound,
    RequisitionNotFound,
    RevisionConflict,
    TeacherNotFound,
    TeacherStore,
)

router = APIRouter(prefix="/teachers", tags=["teachers"])
requisition_router = APIRouter(prefix="/teacher-requisitions", tags=["teacher requisitions"])


class TeacherInput(BaseModel):
    fullName: str = Field(min_length=1, max_length=200)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=5000)


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parentId: str | None = None


class MoveTeacherRequest(BaseModel):
    folderId: str | None = None


class CreateTeacherRequisitionRequest(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    academicYear: str = Field(min_length=1, max_length=20)
    sourceRequisitionId: str | None = None


class UpdateTeacherRequisitionRequest(BaseModel):
    expectedRevision: int = Field(ge=1)
    label: str = Field(min_length=1, max_length=160)
    academicYear: str = Field(min_length=1, max_length=20)
    content: dict[str, Any]


def get_store() -> TeacherStore:
    return TeacherStore(config.database_url)


@router.get("")
def list_teachers(
    includeArchived: bool = Query(default=False), store: TeacherStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_teachers(include_archived=includeArchived)}


@router.post("", status_code=201)
def create_teacher(request: TeacherInput, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    return store.create_teacher(
        full_name=request.fullName.strip(),
        email=request.email.strip(),
        phone=request.phone.strip(),
        notes=request.notes.strip(),
    )


@router.get("/folders")
def list_folders(store: TeacherStore = Depends(get_store)) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_folders()}


@router.post("/folders", status_code=201)
def create_folder(request: CreateFolderRequest, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.create_folder(request.name, parent_id=request.parentId)
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="The parent folder was not found.") from exc
    except FolderNameConflict as exc:
        raise HTTPException(status_code=409, detail="A folder with that name already exists.") from exc


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, store: TeacherStore = Depends(get_store)) -> Response:
    try:
        store.delete_folder(folder_id)
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc
    except FolderNotEmpty as exc:
        raise HTTPException(
            status_code=409, detail="Move all teachers and subfolders before deleting this folder."
        ) from exc
    return Response(status_code=204)


@router.get("/courses")
def list_course_catalogue(
    query: str = Query(default="", max_length=200),
    includeObsolete: bool = Query(default=False),
    store: TeacherStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_course_catalogue(query=query, include_obsolete=includeObsolete)}


@router.post("/courses/import")
async def import_course_catalogue(
    file: UploadFile = File(...), store: TeacherStore = Depends(get_store)
) -> dict[str, int]:
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=422, detail="Upload an Excel .xlsx course list.")
    try:
        rows = _read_course_catalogue(await file.read())
        return store.import_course_catalogue(rows)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, openpyxl.utils.exceptions.InvalidFileException) as exc:
        raise HTTPException(status_code=422, detail="The uploaded file is not a readable Excel workbook.") from exc


def _read_course_catalogue(contents: bytes) -> list[dict[str, str]]:
    if not contents:
        raise ValueError("The uploaded workbook is empty.")
    try:
        workbook = openpyxl.load_workbook(BytesIO(contents), read_only=True, data_only=True)
    except (BadZipFile, OSError, ValueError, openpyxl.utils.exceptions.InvalidFileException) as exc:
        raise ValueError("The uploaded file is not a readable Excel workbook.") from exc
    try:
        sheet = workbook.active
        rows = sheet.iter_rows(values_only=True)
        headers = next(rows, None)
        if headers is None:
            raise ValueError("The workbook does not have a header row.")
        column_by_header = {_cell_text(value): index for index, value in enumerate(headers) if _cell_text(value)}
        required = {"CRN": "crn", "Course Code": "courseCode", "Course Title": "courseTitle"}
        missing = [header for header in required if header not in column_by_header]
        if missing:
            raise ValueError(f"The workbook is missing required column(s): {', '.join(missing)}.")
        fields = {
            "Term": "term",
            "CRN": "crn",
            "Course Code": "courseCode",
            "Course Title": "courseTitle",
            "Seq.": "sequence",
            "Credit": "credit",
            "Dept.": "department",
            "Level": "level",
            "College": "college",
            "Contact HRS": "contactHours",
        }
        result: list[dict[str, str]] = []
        for index, source_row in enumerate(rows, start=2):
            record = {
                target: _cell_text(source_row[column_by_header[source]]) if source in column_by_header else ""
                for source, target in fields.items()
            }
            if not any(record.values()):
                continue
            if not record["crn"] or not record["courseCode"] or not record["courseTitle"]:
                raise ValueError(f"Row {index} must include CRN, Course Code, and Course Title.")
            result.append(record)
        if not result:
            raise ValueError("The workbook does not contain any course rows.")
        return result
    finally:
        workbook.close()


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


@router.get("/{teacher_id}")
def get_teacher(teacher_id: str, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.get_teacher(teacher_id)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.patch("/{teacher_id}")
def update_teacher(teacher_id: str, request: TeacherInput, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.update_teacher(
            teacher_id,
            full_name=request.fullName.strip(),
            email=request.email.strip(),
            phone=request.phone.strip(),
            notes=request.notes.strip(),
        )
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.post("/{teacher_id}/archive")
def archive_teacher(teacher_id: str, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.archive_teacher(teacher_id)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.post("/{teacher_id}/restore")
def restore_teacher(teacher_id: str, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.restore_teacher(teacher_id)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.patch("/{teacher_id}/folder")
def move_teacher_to_folder(
    teacher_id: str, request: MoveTeacherRequest, store: TeacherStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.move_teacher_to_folder(teacher_id, request.folderId)
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc


@router.get("/{teacher_id}/requisitions")
def list_teacher_requisitions(
    teacher_id: str, store: TeacherStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    try:
        return {"items": store.list_requisitions(teacher_id)}
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.post("/{teacher_id}/requisitions", status_code=201)
def create_teacher_requisition(
    teacher_id: str, request: CreateTeacherRequisitionRequest, store: TeacherStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.create_requisition(
            teacher_id,
            label=request.label.strip(),
            academic_year=request.academicYear.strip(),
            source_requisition_id=request.sourceRequisitionId,
        )
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc
    except RequisitionNotFound as exc:
        raise HTTPException(
            status_code=404, detail="The source requisition was not found on this teacher profile."
        ) from exc


@requisition_router.get("/{requisition_id}")
def get_requisition(requisition_id: str, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.get_requisition(requisition_id)
    except RequisitionNotFound as exc:
        raise HTTPException(status_code=404, detail="Requisition not found.") from exc


@requisition_router.patch("/{requisition_id}")
def update_requisition(
    requisition_id: str, request: UpdateTeacherRequisitionRequest, store: TeacherStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.update_requisition(
            requisition_id,
            expected_revision=request.expectedRevision,
            label=request.label.strip(),
            academic_year=request.academicYear.strip(),
            content=request.content,
        )
    except RequisitionNotFound as exc:
        raise HTTPException(status_code=404, detail="Requisition not found.") from exc
    except RevisionConflict as exc:
        raise HTTPException(
            status_code=409, detail="This requisition changed elsewhere. Reload it before saving again."
        ) from exc


@requisition_router.delete("/{requisition_id}", status_code=204)
def delete_requisition(requisition_id: str, store: TeacherStore = Depends(get_store)) -> Response:
    try:
        store.delete_requisition(requisition_id)
    except RequisitionNotFound as exc:
        raise HTTPException(status_code=404, detail="Requisition not found.") from exc
    return Response(status_code=204)


@requisition_router.get("/{requisition_id}/export")
def export_requisition(
    requisition_id: str, background_tasks: BackgroundTasks, store: TeacherStore = Depends(get_store)
) -> FileResponse:
    try:
        requisition = store.get_requisition(requisition_id)
        teacher = store.get_teacher(requisition["teacherId"])
    except (RequisitionNotFound, TeacherNotFound) as exc:
        raise HTTPException(status_code=404, detail="Requisition not found.") from exc
    with NamedTemporaryFile(prefix="scen-requisition-", suffix=".docx", delete=False) as file:
        output_path = Path(file.name)
    build_requisition_docx({**requisition, "employeeName": teacher["fullName"]}, output_path)
    background_tasks.add_task(output_path.unlink, missing_ok=True)
    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=_export_filename(teacher["fullName"], requisition["academicYear"]),
        background=background_tasks,
    )


def _export_filename(name: str, academic_year: str) -> str:
    safe_name = "".join(character if character.isalnum() else "-" for character in name).strip("-")
    safe_year = "".join(character if character.isalnum() else "-" for character in academic_year).strip("-")
    return f"Recruitment-Request-{safe_name or 'teacher'}-{safe_year or 'export'}.docx"
