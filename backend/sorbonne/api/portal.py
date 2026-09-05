"""The portal's courses, teachers and registrations — pulled by filter, kept, compared.

Every list here is fed the way Students is: the browser asks the registrar portal through
the extension and posts what came back. What is posted is decided by the list: a course
and a teacher whole, a registration as a student id and a CRN. Reconciliation — what left
the portal since the last pull — is the store's, and the same for all three.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.api.timetables import require_client
from sorbonne.config import config
from sorbonne.services.portal_lists import KINDS, PortalListStore, TeacherNotFound, UnknownKind
from sorbonne.services.student_database import (
    CohortNotFound,
    DuplicateFilterName,
    FilterNotFound,
    InvalidFilter,
    StudentDatabase,
)
from sorbonne.services.student_timetables import StudentPlatformClient, StudentPlatformError

router = APIRouter(prefix="/portal", tags=["portal"])

MAX_ROWS = 60_000


def get_store() -> PortalListStore:
    return PortalListStore(config.database_url)


def get_database() -> StudentDatabase:
    return StudentDatabase(config.database_url)


class FilterInput(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=120)
    filter: dict[str, list[str]] = Field(default_factory=dict)


class CourseRow(BaseModel):
    termCode: str = ""
    crn: str = ""
    courseCode: str = ""
    title: str = ""
    subject: str = ""
    sequence: str = ""
    partOfTerm: str = ""
    partOfTermDesc: str = ""
    credits: str = ""
    department: str = ""
    level: str = ""
    college: str = ""
    contactHours: str = ""
    teacherName: str = ""
    registered: int = 0
    begins: str = ""
    ends: str = ""


class TeacherRow(BaseModel):
    teacherId: str = ""
    fullName: str = ""
    status: str = ""
    category: str = ""
    type: str = ""
    lastTerm: str = ""
    credits: str = ""
    coursesCount: str = ""
    periodsCount: str = ""
    studentsCount: str = ""
    department: str = ""
    rank: str = ""
    courses: str = ""
    institution: str = ""
    psuadEmail: str = ""


class RegistrationRow(BaseModel):
    """Only what the server keeps. A name in the pull never reaches this model."""

    studentId: str = ""
    crn: str = ""
    courseCode: str = ""


class CoursesSyncInput(BaseModel):
    rows: list[CourseRow] = Field(default_factory=list, max_length=MAX_ROWS)


class TeachersSyncInput(BaseModel):
    rows: list[TeacherRow] = Field(default_factory=list, max_length=MAX_ROWS)


class RegistrationsSyncInput(BaseModel):
    termCode: str = Field(min_length=1, max_length=20)
    rows: list[RegistrationRow] = Field(default_factory=list, max_length=MAX_ROWS)


class TeacherLinkInput(BaseModel):
    partTimeTeacherId: str = Field(default="", max_length=80)


class TermLinkInput(BaseModel):
    portalTermCode: str = Field(default="", max_length=20)


def _actor(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    return getattr(staff, "email", "") or ""


def _is_admin(request: Request) -> bool:
    staff = getattr(request.state, "staff_user", None)
    return bool(getattr(staff, "is_admin", False))


def _missing(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"That {what} no longer exists.")


# ------------------------------------------------------------------- filters


@router.get("/filters")
async def list_filters(kind: str, store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    if kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown list.")
    return {"filters": store.list_filters(kind)}


@router.post("/filters", status_code=status.HTTP_201_CREATED)
async def create_filter(
    body: FilterInput, request: Request, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    """A filter fixes a population, so making one is an administrator's — as for views."""
    if not _is_admin(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can create or delete a filter."
        )
    if body.kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown list.")
    try:
        return store.create_filter(kind=body.kind, name=body.name, criteria=body.filter, actor=_actor(request))
    except InvalidFilter as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DuplicateFilterName as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"There is already a filter called {exc}."
        ) from exc


@router.delete("/filters/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_filter(filter_id: str, request: Request, store: PortalListStore = Depends(get_store)) -> None:
    if not _is_admin(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can create or delete a filter."
        )
    try:
        store.delete_filter(filter_id)
    except FilterNotFound as exc:
        raise _missing("filter") from exc


@router.post("/filters/{filter_id}/sync/courses")
async def sync_courses(
    filter_id: str, body: CoursesSyncInput, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.sync_courses(filter_id, [row.model_dump() for row in body.rows])
    except FilterNotFound as exc:
        raise _missing("filter") from exc
    except UnknownKind as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That filter is not a courses filter."
        ) from exc


@router.post("/filters/{filter_id}/sync/teachers")
async def sync_teachers(
    filter_id: str, body: TeachersSyncInput, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.sync_teachers(filter_id, [row.model_dump() for row in body.rows])
    except FilterNotFound as exc:
        raise _missing("filter") from exc
    except UnknownKind as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That filter is not a teachers filter."
        ) from exc


@router.post("/filters/{filter_id}/sync/registrations")
async def sync_registrations(
    filter_id: str, body: RegistrationsSyncInput, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.sync_registrations(filter_id, body.termCode, [row.model_dump() for row in body.rows])
    except FilterNotFound as exc:
        raise _missing("filter") from exc
    except UnknownKind as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That filter is not a registrations filter."
        ) from exc


# ------------------------------------------------------------------- reading


@router.get("/courses")
async def list_courses(term: str = "", filter: str = "", store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"terms": store.course_terms(), "courses": store.list_courses(term, filter)}


@router.get("/teachers")
async def list_teachers(filter: str = "", store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"teachers": store.list_teachers(filter)}


@router.put("/teachers/{teacher_id}/link")
async def link_teacher(
    teacher_id: str, body: TeacherLinkInput, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.link_teacher(teacher_id, body.partTimeTeacherId)
    except TeacherNotFound as exc:
        raise _missing("teacher") from exc


@router.get("/students/{student_id}/registrations")
async def student_registrations(student_id: str, store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"registrations": store.registrations_of(student_id)}


# ---------------------------------------------------------------- term links


@router.get("/term-links")
async def term_links(store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"links": store.term_links()}


@router.put("/term-links/{term_id}")
async def link_term(term_id: str, body: TermLinkInput, store: PortalListStore = Depends(get_store)) -> dict[str, str]:
    return store.link_term(term_id, body.portalTermCode)


@router.get("/terms/{term_id}/crns")
async def term_crns(term_id: str, store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    """Every portal CRN of the semester, for a page that wants to check the ones it holds."""
    return store.crns_for_term(term_id)


@router.get("/terms/{term_id}/check")
async def term_check(
    term_id: str,
    store: PortalListStore = Depends(get_store),
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    """The Student Hub's timetable held against the portal's courses for the same term."""
    held = store.crns_for_term(term_id)
    if not held["portalTermCode"]:
        return {"portalTermCode": "", "linked": False, "hubOnly": [], "teacherDiffers": [], "portalCourses": 0}
    try:
        sections = await client.list_sections(term_id)
    except StudentPlatformError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    crns = held["crns"]
    hub_only = []
    differs = []
    for section in sections:
        crn = str(section.get("crn", ""))
        course = crns.get(crn)
        if course is None:
            hub_only.append({"crn": crn, "code": section.get("code", ""), "staff": section.get("staff", "")})
            continue
        staff = " ".join(str(section.get("staff", "")).split())
        if staff and course["teacherName"] and _loose(staff) != _loose(course["teacherName"]):
            differs.append({"crn": crn, "code": section.get("code", ""), "hub": staff, "portal": course["teacherName"]})
    return {
        "portalTermCode": held["portalTermCode"],
        "linked": True,
        "portalCourses": len(crns),
        "hubOnly": hub_only,
        "teacherDiffers": differs,
    }


def _loose(name: str) -> str:
    """Names as the eye compares them: case and titles aside, the words in any order."""
    words = {
        word
        for word in "".join(ch if ch.isalnum() else " " for ch in name.lower()).split()
        if word not in {"dr", "pr", "prof", "mr", "mrs", "ms", "mme", "m", "phd", "post", "doc"}
    }
    return " ".join(sorted(words))


# ------------------------------------------------------------ the comparison


@router.get("/cohorts/{cohort_id}/registration-check")
async def registration_check(
    cohort_id: str,
    store: PortalListStore = Depends(get_store),
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    try:
        database.get_cohort(cohort_id)
    except CohortNotFound as exc:
        raise _missing("cohort") from exc
    return {"mismatches": [mismatch.as_payload() for mismatch in store.registration_check(cohort_id, database)]}
