"""Cohorts, and the catalogue of groups and CRNs they assign students into.

Everything here sits behind the staff gate, like the rest of the API. No route accepts a
student's name: a cohort member is an id, and that is all this application keeps.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from sorbonne.config import config
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


class MembersInput(BaseModel):
    """Student ids and nothing else — this API has no field for a name."""

    model_config = ConfigDict(populate_by_name=True)

    student_ids: list[str] = Field(default_factory=list, max_length=2000, alias="studentIds")


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


# ---------------------------------------------------------- saved searches


@router.get("/filters")
async def list_filters(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return {"filters": database.list_filters()}


@router.post("/filters", status_code=status.HTTP_201_CREATED)
async def create_filter(
    body: FilterInput, request: Request, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    return _save(database, body, None, request)


@router.put("/filters/{filter_id}")
async def update_filter(
    filter_id: str,
    body: FilterInput,
    request: Request,
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    return _save(database, body, filter_id, request)


@router.delete("/filters/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_filter(filter_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    try:
        database.delete_filter(filter_id)
    except FilterNotFound as exc:
        raise _missing(exc, "saved search") from exc


def _save(
    database: StudentDatabase, body: FilterInput, filter_id: str | None, request: Request
) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    search = SavedSearch(
        name=body.name,
        description=body.description,
        criteria=body.filter,
        expected_count=body.expected_count,
    )
    try:
        return database.save_filter(
            search, filter_id=filter_id, actor=getattr(staff, "email", "") or ""
        )
    except InvalidFilter as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DuplicateFilterName as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"There is already a saved search called {exc}.",
        ) from exc
    except FilterNotFound as exc:
        raise _missing(exc, "saved search") from exc


# ----------------------------------------------------------------- members


@router.get("/cohorts/{cohort_id}/members")
async def list_members(cohort_id: str, database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    try:
        return {"members": database.list_members(cohort_id)}
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.post("/cohorts/{cohort_id}/members")
async def add_members(
    cohort_id: str,
    body: MembersInput,
    request: Request,
    database: StudentDatabase = Depends(get_database),
) -> dict[str, int]:
    staff = getattr(request.state, "staff_user", None)
    try:
        added = database.add_members(cohort_id, body.student_ids, actor=getattr(staff, "email", "") or "")
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc
    return {"added": added}


# A body of ids, so this is a POST rather than a DELETE.
@router.post("/cohorts/{cohort_id}/members/remove")
async def remove_members(
    cohort_id: str, body: MembersInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, int]:
    return {"removed": database.remove_members(cohort_id, body.student_ids)}


# --------------------------------------------------------------- catalogue


@router.get("/cohorts/{cohort_id}/catalogue")
async def read_catalogue(
    cohort_id: str, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return database.read_catalogue(cohort_id)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.post("/cohorts/{cohort_id}/catalogue/import")
async def import_reference(
    cohort_id: str,
    workbook: UploadFile = File(...),
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    """Seed the catalogue from a group-assignment workbook's Reference sheet."""
    content = await workbook.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is larger than 20 MB.")
    try:
        report = parse_group_reference(content, workbook.filename or "")
    except ReferenceImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    try:
        added = database.import_reference(cohort_id, report)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc
    return {
        "filename": workbook.filename or "",
        "sheet": report.sheet,
        "style": report.style,
        "read": {"scopes": len(report.scopes), "groups": report.group_count, "crns": report.crn_count},
        "added": added,
    }


@router.post("/cohorts/{cohort_id}/scopes", status_code=status.HTTP_201_CREATED)
async def add_scope(
    cohort_id: str, body: ScopeInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, str]:
    try:
        return {"id": database.add_scope(cohort_id, code=body.code, name=body.name, note=body.note)}
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
