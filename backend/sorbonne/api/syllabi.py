from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from sorbonne.config import config
from sorbonne.services.account_access import AccountAccess, administers
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_export import build_syllabus_docx, template_sections
from sorbonne.services.syllabus_visibility import VISIBILITIES, can_edit, can_view
from sorbonne.services.syllabus_templates import DEFAULT_TEMPLATE_ID
from sorbonne.services.syllabus_catalogue_store import SyllabusCatalogueStore
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
    parentId: str | None = None


class MoveSyllabusRequest(BaseModel):
    folderId: str | None = None


def get_store() -> SyllabusStore:
    return SyllabusStore(config.database_url)


def get_catalogue_store() -> SyllabusCatalogueStore:
    return SyllabusCatalogueStore(config.database_url)


def current_user(request: Request) -> StaffUser:
    """Whoever the sign-in gate admitted. Nothing here answers an anonymous caller."""
    user = getattr(request.state, "staff_user", None)
    if user is None:  # pragma: no cover - the gate rejects these before they arrive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    return user


def get_account_access() -> AccountAccess:
    return AccountAccess(config.database_url)


def administers_syllabi(
    request: Request, access: AccountAccess = Depends(get_account_access)
) -> bool:
    """Whether this caller maintains the syllabus app — not whether they administer accounts."""
    user = getattr(request.state, "staff_user", None)
    if user is None:  # pragma: no cover - the gate rejects these before they arrive
        return False
    return administers(access.apps_for(user.email), "syllabus", platform_admin=user.is_admin)


def _readable(store: SyllabusStore, syllabus_id: str, user: StaffUser, *, curator: bool = False) -> dict[str, Any]:
    """The syllabus, if this person may read it.

    A syllabus they may not read is reported as missing rather than forbidden: which
    syllabi exist is itself something a private one does not tell anybody.
    """
    try:
        syllabus = store.get(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    if not can_view(syllabus, user, administers=curator):
        raise HTTPException(status_code=404, detail="Syllabus not found.")
    return syllabus


def _writable(store: SyllabusStore, syllabus_id: str, user: StaffUser, *, curator: bool = False) -> dict[str, Any]:
    syllabus = _readable(store, syllabus_id, user, curator=curator)
    if not can_edit(syllabus, user, administers=curator):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This syllabus belongs to somebody else.",
        )
    return syllabus


@router.get("")
def list_syllabi(
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list(user, administers=curator)}


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
        return store.create_folder(request.name, parent_id=request.parentId)
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="The parent folder was not found.") from exc
    except FolderNameConflict as exc:
        raise HTTPException(status_code=409, detail="A folder with that name already exists.") from exc


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, store: SyllabusStore = Depends(get_store)) -> Response:
    try:
        store.delete_folder(folder_id)
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc
    except FolderNotEmpty as exc:
        raise HTTPException(
            status_code=409, detail="Move all syllabi and subfolders out of this folder before deleting it."
        ) from exc
    return Response(status_code=204)


@router.post("", status_code=201)
def create_syllabus(
    request: CreateSyllabusRequest,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    if request.sourceSyllabusId:
        _readable(store, request.sourceSyllabusId, user, curator=curator)
    try:
        return store.create(
            owner_email=user.email,
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
    syllabus_id: str,
    request: MoveSyllabusRequest,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    _writable(store, syllabus_id, user, curator=curator)
    try:
        return store.move_to_folder(syllabus_id, request.folderId)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    except FolderNotFound as exc:
        raise HTTPException(status_code=404, detail="Folder not found.") from exc


@router.delete("/{syllabus_id}", status_code=204)
def delete_syllabus(
    syllabus_id: str,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> Response:
    _writable(store, syllabus_id, user, curator=curator)
    try:
        store.delete(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    return Response(status_code=204)


@router.get("/{syllabus_id}")
def get_syllabus(
    syllabus_id: str,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    return _readable(store, syllabus_id, user, curator=curator)


@router.get("/{syllabus_id}/export")
def export_syllabus(  # noqa: PLR0913 - the id, the cleanup, two stores, and who is asking
    syllabus_id: str,
    background_tasks: BackgroundTasks,
    store: SyllabusStore = Depends(get_store),
    catalogue_store: SyllabusCatalogueStore = Depends(get_catalogue_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> FileResponse:
    syllabus = _readable(store, syllabus_id, user, curator=curator)

    with NamedTemporaryFile(prefix="scen-syllabus-", suffix=".docx", delete=False) as file:
        output_path = Path(file.name)
    build_syllabus_docx({**syllabus, "content": _resolved_content(catalogue_store, syllabus)}, output_path)
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
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, list[dict[str, Any]]]:
    _readable(store, syllabus_id, user, curator=curator)
    return {"items": store.field_history(syllabus_id, field_path)}


@router.patch("/{syllabus_id}")
def update_syllabus(
    syllabus_id: str,
    request: UpdateSyllabusRequest,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    _writable(store, syllabus_id, user, curator=curator)
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
    syllabus_id: str,
    other_syllabus_id: str,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    # Both sides, because a comparison shows as much of one as of the other.
    _readable(store, syllabus_id, user, curator=curator)
    _readable(store, other_syllabus_id, user, curator=curator)
    try:
        comparison = store.compare(syllabus_id, other_syllabus_id)
        # Stable catalogue references are implementation details. The associated human
        # text remains in the syllabus content (or is resolved live for People).
        internal_paths = (
            ".personId",
            ".catalogueProgrammeId",
            ".cataloguePloProgrammeId",
            ".teachingPresetIds",
            ".assessmentTypeId",
            ".ploIds",
        )
        comparison["changes"] = [
            change for change in comparison["changes"] if not change["path"].endswith(internal_paths)
        ]
        comparison["rows"] = [row for row in comparison["rows"] if not row["id"].endswith(internal_paths)]
        return comparison
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


@router.get("/{syllabus_id}/export-preview")
def export_preview(
    syllabus_id: str,
    store: SyllabusStore = Depends(get_store),
    catalogue_store: SyllabusCatalogueStore = Depends(get_catalogue_store),
) -> dict[str, Any]:
    """What the exported document will say, before it is a document."""
    try:
        syllabus = store.get(syllabus_id)
    except SyllabusNotFound as exc:
        raise HTTPException(status_code=404, detail="Syllabus not found.") from exc
    return {
        **syllabus,
        "content": _resolved_content(catalogue_store, syllabus),
        "sections": template_sections(str(syllabus.get("templateId") or DEFAULT_TEMPLATE_ID)),
    }


def _resolved_content(catalogue_store: SyllabusCatalogueStore, syllabus: dict[str, Any]) -> dict[str, Any]:
    """Everything the catalogue owns, applied to a copy of the syllabus's content.

    The document builder and the export preview are both handed this, so what a
    professor is shown cannot drift from what the Provost receives.
    """
    content = syllabus["content"]
    for resolve in (
        catalogue_store.resolve_people,
        catalogue_store.resolve_plos,
        catalogue_store.resolve_competencies,
        catalogue_store.resolve_teaching_approach,
        catalogue_store.resolve_rubrics,
    ):
        content = resolve(content)
    return content


def _export_filename(syllabus: dict[str, Any]) -> str:
    """Name the file so the course can be told from the filename alone."""
    code = _filename_part(syllabus.get("courseCode"))
    title = _filename_part(syllabus.get("courseTitle"))
    year = _filename_part(syllabus.get("academicYear"))
    parts = [part for part in (code, title or "syllabus", year or "export") if part]
    return f"{'-'.join(parts)}.docx"


def _filename_part(value: Any) -> str:
    return "".join(character if character.isalnum() else "-" for character in str(value or "")).strip("-")


class VisibilityRequest(BaseModel):
    visibility: str = Field(min_length=1, max_length=20)


class ReviewRequest(BaseModel):
    submitted: bool


@router.patch("/{syllabus_id}/visibility")
def set_syllabus_visibility(
    syllabus_id: str,
    request: VisibilityRequest,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    """Publishing a syllabus, or taking it back."""
    if request.visibility.strip().lower() not in VISIBILITIES:
        raise HTTPException(status_code=422, detail="A syllabus is either private or public.")
    _writable(store, syllabus_id, user, curator=curator)
    updated = store.set_visibility(syllabus_id, request.visibility)
    # Taking it back out of public also takes back any request to review it.
    return store.set_submitted(syllabus_id, False) if updated["visibility"] == "private" else updated


@router.patch("/{syllabus_id}/review")
def set_syllabus_review(
    syllabus_id: str,
    request: ReviewRequest,
    store: SyllabusStore = Depends(get_store),
    user: StaffUser = Depends(current_user),
    curator: bool = Depends(administers_syllabi),
) -> dict[str, Any]:
    """Asking a coordinator to look at it, or taking the request back.

    Only its author asks: submitting is what opens a private syllabus to somebody else, and
    that is not a decision anybody but its author gets to make.
    """
    syllabus = _readable(store, syllabus_id, user, curator=curator)
    if syllabus.get("ownerEmail") != user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the person writing a syllabus can put it up for review.",
        )
    return store.set_submitted(syllabus_id, request.submitted)
