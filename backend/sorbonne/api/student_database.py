"""Student records, the cohorts they belong to, and the CRNs a cohort assigns.

Everything here sits behind the staff gate, like the rest of the API. No route accepts a
student's name: a cohort member is an id, and that is all this application keeps.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from sorbonne.config import config
from sorbonne.services.group_assignment_import import AssignmentImportError, parse_group_assignments
from sorbonne.services.workbook_diff import (
    diff_assignments,
    diff_reference,
    summarize_assignments,
    summarize_reference,
)
from sorbonne.services.group_reference_import import ReferenceImportError, parse_group_reference
from sorbonne.services.student_database import (
    CohortNotFound,
    DuplicateFilterName,
    DuplicateLabel,
    FilterNotFound,
    GroupNotFound,
    InvalidFilter,
    SavedSearch,
    ScopeNotFound,
    StudentDatabase,
)

router = APIRouter(prefix="/student-database", tags=["student-database"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def get_database() -> StudentDatabase:
    return StudentDatabase(config.database_url)


class CohortInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    term: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=2000)


class SyncInput(BaseModel):
    """What the portal returned for this view's population, as ids."""

    model_config = ConfigDict(populate_by_name=True)

    student_ids: list[str] = Field(default_factory=list, max_length=20_000, alias="studentIds")


class ViewInput(BaseModel):
    """A new view: a name, and the filter that fixes what it asks for ever after."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=400)
    filter: dict[str, list[str]] = Field(default_factory=dict)


class CohortAssignment(BaseModel):
    """Move students into a cohort, or out of one when cohortId is null."""

    model_config = ConfigDict(populate_by_name=True)

    student_ids: list[str] = Field(default_factory=list, max_length=20_000, alias="studentIds")
    cohort_id: str | None = Field(default=None, alias="cohortId")


class FilterInput(BaseModel):
    """A named registrar search: portal codes only, never anything about a student."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=400)
    filter: dict[str, list[str]] = Field(default_factory=dict)
    expected_count: int = Field(default=0, ge=0, le=100_000, alias="expectedCount")


class ScopeInput(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=400)
    # Which semester the block belongs to. Blank means "not said yet", which is what the
    # rows migrated from before blocks had semesters carry.
    term_id: str = Field(default="", alias="termId", max_length=80)


class CourseInput(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=160)
    component: str = Field(default="", max_length=40)


class GroupInput(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    capacity: int = Field(default=0, ge=0, le=10_000)
    note: str = Field(default="", max_length=400)


class CellInput(BaseModel):
    """An empty CRN clears the cell, which is how a group drops a course."""

    crn: str = Field(default="", max_length=20)
    teacher: str = Field(default="", max_length=160)


def _missing(exc: Exception, what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"That {what} no longer exists.")


def _duplicate(exc: DuplicateLabel, what: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail=f"There is already a {what} called {exc}."
    )


# ----------------------------------------------------------------- cohorts


@router.get("/cohorts")
async def list_cohorts(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return {"cohorts": database.list_cohorts()}


@router.post("/cohorts", status_code=status.HTTP_201_CREATED)
async def create_cohort(
    body: CohortInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    return database.create_cohort(name=body.name, term=body.term, notes=body.notes)


@router.patch("/cohorts/{cohort_id}")
async def update_cohort(
    cohort_id: str, body: CohortInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return database.update_cohort(cohort_id, name=body.name, term=body.term, notes=body.notes)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.delete("/cohorts/{cohort_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cohort(cohort_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    try:
        database.delete_cohort(cohort_id)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


# ---------------------------------------------------------------- students


@router.get("/students")
async def list_students(
    view: str = "", database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    """One view's students, or everyone we hold when no view is named."""
    return {"students": database.list_students(view)}


# -------------------------------------------------------------------- views


def _may_define_views(request: Request) -> None:
    """A view's filter is fixed at creation, so creating one is what decides a population.

    That is the moment worth guarding, and an administrator is who may decide it: deleting
    one throws away the record of who it returned. Re-syncing an existing view asks the
    same question it has always asked, and is open to any coordinator.
    """
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can create or delete a view.",
        )


@router.get("/views")
async def list_views(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return {"views": database.list_views()}


@router.post("/views", status_code=status.HTTP_201_CREATED)
async def create_view(
    body: ViewInput, request: Request, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    _may_define_views(request)
    staff = getattr(request.state, "staff_user", None)
    search = SavedSearch(name=body.name, description=body.description, criteria=body.filter)
    try:
        return database.save_filter(search, filter_id=None, actor=getattr(staff, "email", "") or "")
    except InvalidFilter as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DuplicateFilterName as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"There is already a view called {exc}."
        ) from exc


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_view(
    view_id: str, request: Request, database: StudentDatabase = Depends(get_database)
) -> None:
    _may_define_views(request)
    try:
        database.delete_filter(view_id)
    except FilterNotFound as exc:
        raise _missing(exc, "view") from exc


@router.post("/views/{view_id}/sync")
async def sync_view(
    view_id: str, body: SyncInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return database.sync_view(view_id, body.student_ids)
    except FilterNotFound as exc:
        raise _missing(exc, "view") from exc


@router.post("/students/cohort")
async def set_cohort(
    body: CohortAssignment, database: StudentDatabase = Depends(get_database)
) -> dict[str, int]:
    try:
        return {"moved": database.set_cohort(body.student_ids, body.cohort_id)}
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.get("/cohorts/{cohort_id}/members")
async def list_members(cohort_id: str, database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    try:
        return {"members": database.list_members(cohort_id)}
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


# --------------------------------------------------------------- catalogue


@router.get("/cohorts/{cohort_id}/catalogue")
async def read_catalogue(
    cohort_id: str, term_id: str | None = None, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    """One cohort's blocks, for one semester when asked — they differ between them."""
    try:
        return database.read_catalogue(cohort_id, term_id)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


class WorkbookApplyInput(BaseModel):
    term_id: str = Field(default="", alias="termId", max_length=80)
    operations: list[dict[str, Any]] = Field(default_factory=list)


async def _read_workbook(workbook: UploadFile) -> bytes:
    content = await workbook.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is larger than 20 MB.")
    return content


@router.post("/cohorts/{cohort_id}/workbook/preview")
async def preview_workbook(
    cohort_id: str,
    term_id: str = Form(default=""),
    workbook: UploadFile = File(...),
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    """What one workbook would change, in both halves, without writing any of it.

    One file carries both: the Reference sheet says what the blocks are, the student tabs
    say who is in them. They were two uploads and are one, because they were always one
    document and asking for it twice only invited the two halves to disagree.
    """
    content = await _read_workbook(workbook)
    try:
        reference = parse_group_reference(content, workbook.filename or "")
    except ReferenceImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Placements are optional: an unfilled template is a perfectly good source of blocks.
    try:
        placements = parse_group_assignments(content, workbook.filename or "").students
        placement_note = ""
    except AssignmentImportError as exc:
        placements, placement_note = {}, str(exc)

    try:
        held = database.catalogue_for_diff(cohort_id, term_id)
        groups = database.group_ids_by_label(cohort_id, term_id)
        assigned = database.assignments_of(cohort_id)
        known_students = database.student_ids_of(cohort_id)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc

    # Placements are compared by block code, which is how the workbook names them.
    scope_code_of = {
        group_id: code for code, labels in groups.items() for group_id in labels.values()
    }
    held_placements: dict[str, dict[str, str]] = {}
    for student, by_scope in assigned.items():
        for _, group_id in by_scope.items():
            code = scope_code_of.get(group_id)
            if code:
                held_placements.setdefault(student, {})[code] = _label_of(groups, code, group_id)

    blocks = diff_reference(held=held, incoming=reference)
    placement_diff = diff_assignments(
        held=held_placements, incoming=placements, groups=groups, known_students=known_students
    )
    return {
        "filename": workbook.filename or "",
        "sheet": reference.sheet,
        "style": reference.style,
        "reference": {"blocks": blocks, "summary": summarize_reference(blocks)},
        "placements": {
            **placement_diff,
            "summary": summarize_assignments(placement_diff),
            "note": placement_note,
        },
    }


def _label_of(groups: dict[str, dict[str, str]], scope_code: str, group_id: str) -> str:
    for label, identifier in groups.get(scope_code, {}).items():
        if identifier == group_id:
            return label
    return ""


@router.post("/cohorts/{cohort_id}/workbook/apply")
async def apply_workbook(
    cohort_id: str,
    body: WorkbookApplyInput,
    request: Request,
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    """Carry out only the rows the coordinator ticked."""
    if not body.operations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing was approved, so nothing was applied.",
        )
    staff = getattr(request.state, "staff_user", None)
    try:
        return database.apply_workbook_changes(
            cohort_id, body.term_id, body.operations, actor=getattr(staff, "email", "") or ""
        )
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc


@router.post("/cohorts/{cohort_id}/scopes", status_code=status.HTTP_201_CREATED)
async def add_scope(
    cohort_id: str, body: ScopeInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, str]:
    try:
        return {
            "id": database.add_scope(
                cohort_id, code=body.code, name=body.name, note=body.note, term_id=body.term_id
            )
        }
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc
    except DuplicateLabel as exc:
        raise _duplicate(exc, "block") from exc


@router.patch("/scopes/{scope_id}")
async def update_scope(
    scope_id: str, body: ScopeInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    try:
        database.update_scope(scope_id, code=body.code, name=body.name, note=body.note)
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc
    return {"saved": True}


@router.delete("/scopes/{scope_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scope(scope_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    try:
        database.delete_scope(scope_id)
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc


@router.post("/scopes/{scope_id}/courses", status_code=status.HTTP_201_CREATED)
async def add_course(
    scope_id: str, body: CourseInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, str]:
    try:
        return {"id": database.add_course(scope_id, code=body.code, name=body.name, component=body.component)}
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(course_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    database.delete_course(course_id)


class AssignmentInput(BaseModel):
    """`groupId: null` means "not decided yet", which readiness keeps reporting."""

    student_ids: list[str] = Field(default_factory=list, max_length=20_000, alias="studentIds")
    group_id: str | None = Field(default=None, alias="groupId")


@router.put("/scopes/{scope_id}/assignments")
async def assign_students(
    scope_id: str,
    body: AssignmentInput,
    request: Request,
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    """Put students in a group of this scope, or take them out of it.

    One group per student per scope: their enrolment is the union of the groups they hold,
    so assigning replaces whatever they had for this scope rather than adding to it. An id
    the block's cohort does not hold comes back under `skipped` rather than being placed.
    """
    staff = getattr(request.state, "staff_user", None)
    actor = getattr(staff, "email", "") or ""
    try:
        return database.assign_many(
            scope_id=scope_id,
            student_ids=body.student_ids,
            group_id=body.group_id,
            actor=actor,
        )
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc


@router.get("/cohorts/{cohort_id}/assignments")
async def read_assignments(
    cohort_id: str, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return {"assignments": database.assignments_of(cohort_id)}
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.post("/scopes/{scope_id}/groups", status_code=status.HTTP_201_CREATED)
async def add_group(
    scope_id: str, body: GroupInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, str]:
    try:
        return {"id": database.add_group(scope_id, label=body.label, capacity=body.capacity, note=body.note)}
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc
    except DuplicateLabel as exc:
        raise _duplicate(exc, "group") from exc


@router.patch("/groups/{group_id}")
async def update_group(
    group_id: str, body: GroupInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    try:
        database.update_group(group_id, label=body.label, capacity=body.capacity, note=body.note)
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc
    return {"saved": True}


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    database.delete_group(group_id)


@router.put("/groups/{group_id}/courses/{course_id}")
async def set_cell(
    group_id: str, course_id: str, body: CellInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    database.set_cell(group_id=group_id, course_id=course_id, crn=body.crn, teacher=body.teacher)
    return {"saved": True}
