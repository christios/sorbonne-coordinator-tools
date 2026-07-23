from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from sorbonne.config import config
from sorbonne.services.syllabus_export import build_syllabus_docx
from sorbonne.services.syllabus_store import (
    ComparisonNotAllowed,
    FolderNameConflict,
    FolderNotEmpty,
    FolderNotFound,
    RevisionConflict,
    SyllabusNotFound,
    SyllabusStore,
    TemplateComparisonNotMapped,
)
from sorbonne.services.syllabus_templates import TemplateNotFound, get_template, list_templates

router = APIRouter(prefix="/syllabi", tags=["syllabi"])


class CreateSyllabusRequest(BaseModel):
    courseTitle: str = Field(min_length=1, max_length=200)
    courseCode: str = Field(default="", max_length=80)
    academicYear: str = Field(min_length=1, max_length=20)
    sourceSyllabusId: str | None = None
    templateId: str | None = Field(default=None, min_length=1, max_length=80)


class UpdateSyllabusRequest(BaseModel):
    expectedRevision: int = Field(ge=1)
    content: dict[str, Any]
    courseTitle: str | None = Field(default=None, min_length=1, max_length=200)
    courseCode: str | None = Field(default=None, max_length=80)
    academicYear: str | None = Field(default=None, min_length=1, max_length=20)


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MoveSyllabusRequest(BaseModel):
    folderId: str | None = None


def get_store() -> SyllabusStore:
    return SyllabusStore(config.database_url)


@router.get("")
def list_syllabi(store: SyllabusStore = Depends(get_store)) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list()}


@router.get("/templates")
def list_syllabus_templates() -> dict[str, list[dict[str, Any]]]:
    return {
        "items": [
            {
                "id": template.id,
                "name": template.name,
                "description": template.description,
                "documentPath": f"/syllabi/templates/{template.id}/document",
                "sections": [{"id": section.id, "label": section.label} for section in template.sections],
            }
            for template in list_templates()
        ]
    }


@router.get("/templates/{template_id}/document")
def download_syllabus_template(template_id: str) -> FileResponse:
    try:
        template = get_template(template_id)
    except TemplateNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus template not found.") from exc
    return FileResponse(
        template.document_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{template.id}.docx",
    )


@router.get("/folders")
def list_folders(store: SyllabusStore = Depends(get_store)) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_folders()}


@router.post("/folders", status_code=201)
def create_folder(request: CreateFolderRequest, store: SyllabusStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.create_folder(request.name)
    except FolderNameConflict as exc:
        raise HTTPException(status_code=409, detail="A folder with that name already exists.") from exc


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, store: SyllabusStore = Depends(get_store)) -> Response:
    try:
        store.delete_folder(folder_id)
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc
    except FolderNotEmpty as exc:
        raise HTTPException(status_code=409, detail="Move all syllabi out of this folder before deleting it.") from exc
    return Response(status_code=204)


@router.post("", status_code=201)
def create_syllabus(request: CreateSyllabusRequest, store: SyllabusStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.create(
            course_title=request.courseTitle.strip(),
            course_code=request.courseCode.strip(),
            academic_year=request.academicYear.strip(),
            source_syllabus_id=request.sourceSyllabusId,
            template_id=request.templateId,
        )
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="The source syllabus was not found.") from exc
    except TemplateNotFound as exc:
        raise HTTPException(status_code=422, detail="The selected syllabus template is not available.") from exc
    except TemplateComparisonNotMapped as exc:
        raise HTTPException(
            status_code=422,
            detail="A duplicate must use the same template until a template mapping is approved.",
        ) from exc


@router.patch("/{syllabus_id}/folder")
def move_syllabus_to_folder(
    syllabus_id: str, request: MoveSyllabusRequest, store: SyllabusStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.move_to_folder(syllabus_id, request.folderId)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc


@router.delete("/{syllabus_id}", status_code=204)
def delete_syllabus(syllabus_id: str, store: SyllabusStore = Depends(get_store)) -> Response:
    try:
        store.delete(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    return Response(status_code=204)


@router.get("/{syllabus_id}")
def get_syllabus(syllabus_id: str, store: SyllabusStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.get(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc


@router.get("/{syllabus_id}/export")
def export_syllabus(
    syllabus_id: str,
    background_tasks: BackgroundTasks,
    store: SyllabusStore = Depends(get_store),
) -> FileResponse:
    try:
        syllabus = store.get(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc

    with NamedTemporaryFile(prefix="scen-syllabus-", suffix=".docx", delete=False) as file:
        output_path = Path(file.name)
    build_syllabus_docx(syllabus, output_path)
    background_tasks.add_task(output_path.unlink, missing_ok=True)
    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=_export_filename(syllabus),
        background=background_tasks,
    )


@router.get("/{syllabus_id}/history")
def get_field_history(
    syllabus_id: str,
    field_path: str = Query(alias="fieldPath", min_length=1, max_length=600),
    store: SyllabusStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    try:
        return {"items": store.field_history(syllabus_id, field_path)}
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc


@router.patch("/{syllabus_id}")
def update_syllabus(
    syllabus_id: str, request: UpdateSyllabusRequest, store: SyllabusStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.update(
            syllabus_id,
            expected_revision=request.expectedRevision,
            content=request.content,
            course_title=request.courseTitle.strip() if request.courseTitle is not None else None,
            course_code=request.courseCode.strip() if request.courseCode is not None else None,
            academic_year=request.academicYear.strip() if request.academicYear is not None else None,
        )
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    except RevisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail="This syllabus changed elsewhere. Reload it before saving again.",
        ) from exc


@router.get("/{syllabus_id}/comparison/{other_syllabus_id}")
def compare_syllabi(
    syllabus_id: str, other_syllabus_id: str, store: SyllabusStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.compare(syllabus_id, other_syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    except ComparisonNotAllowed as exc:
        raise HTTPException(
            status_code=422,
            detail="Only academic-year versions of the same syllabus can be compared.",
        ) from exc
    except TemplateComparisonNotMapped as exc:
        raise HTTPException(
            status_code=422,
            detail="These templates do not yet have an approved comparison mapping.",
        ) from exc


def _export_filename(syllabus: dict[str, Any]) -> str:
    title = "".join(character if character.isalnum() else "-" for character in syllabus["courseTitle"]).strip("-")
    year = "".join(character if character.isalnum() else "-" for character in syllabus["academicYear"]).strip("-")
    return f"{title or 'syllabus'}-{year or 'export'}.docx"
