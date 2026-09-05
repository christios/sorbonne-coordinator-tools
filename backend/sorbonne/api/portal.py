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
from sorbonne.services.portal_lists import (
    KINDS,
    ActiveCourseNotFound,
    ActiveTeacherNotFound,
    InvalidParent,
    PortalListStore,
    UnknownKind,
)
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


class PartTimeRef(BaseModel):
    """A record of the part-time teacher database, as much of it as an active teacher keeps."""

    id: str = Field(min_length=1, max_length=80)
    fullName: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)


class ActiveTeachersInput(BaseModel):
    portalTeacherIds: list[str] = Field(default_factory=list, max_length=2000)
    partTime: list[PartTimeRef] = Field(default_factory=list, max_length=2000)


class ByHandCourse(BaseModel):
    """A course the portal does not list yet, said by code and title."""

    courseCode: str = Field(min_length=1, max_length=40)
    title: str = Field(default="", max_length=200)


class ActiveCoursesInput(BaseModel):
    courseCodes: list[str] = Field(default_factory=list, max_length=2000)
    byHand: list[ByHandCourse] = Field(default_factory=list, max_length=200)


class ActiveCourseUpdate(BaseModel):
    title: str = Field(default="", max_length=200)
    ue: str = Field(default="", max_length=40)


class RegisterCrn(BaseModel):
    """One CRN taken into the register by hand, rather than with its course."""

    termCode: str = Field(default="", max_length=20)
    crn: str = Field(min_length=1, max_length=20)
    courseCode: str = Field(default="", max_length=40)


class ActiveCrnsInput(BaseModel):
    #: Every CRN the portal lists for these courses joins the register.
    courseCodes: list[str] = Field(default_factory=list, max_length=2000)
    crns: list[RegisterCrn] = Field(default_factory=list, max_length=5000)


class ActiveCrnUpdate(BaseModel):
    """What this section hangs from, as a CRN of the portal's own list."""

    parentCrn: str = Field(default="", max_length=20)


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


@router.get("/active-teachers")
async def list_active_teachers(store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"teachers": store.list_active_teachers()}


@router.post("/active-teachers")
async def add_active_teachers(
    body: ActiveTeachersInput, request: Request, store: PortalListStore = Depends(get_store)
) -> dict[str, int]:
    """Choose teachers from the portal's list, or bring them from the part-time database."""
    return store.add_active_teachers(
        portal_teacher_ids=body.portalTeacherIds,
        part_time=[record.model_dump() for record in body.partTime],
        actor=_actor(request),
    )


@router.delete("/active-teachers/{active_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_active_teacher(active_id: str, store: PortalListStore = Depends(get_store)) -> None:
    try:
        store.remove_active_teacher(active_id)
    except ActiveTeacherNotFound as exc:
        raise _missing("active teacher") from exc


@router.get("/active-courses")
async def list_active_courses(store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    return {"courses": store.list_active_courses()}


@router.post("/active-courses")
async def add_active_courses(
    body: ActiveCoursesInput, request: Request, store: PortalListStore = Depends(get_store)
) -> dict[str, int]:
    """Choose courses from the portal's list, or add one by hand."""
    return store.add_active_courses(
        course_codes=body.courseCodes,
        by_hand=[record.model_dump() for record in body.byHand],
        actor=_actor(request),
    )


@router.patch("/active-courses/{active_id}")
async def update_active_course(
    active_id: str, body: ActiveCourseUpdate, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.update_active_course(active_id, title=body.title, ue=body.ue)
    except ActiveCourseNotFound as exc:
        raise _missing("active course") from exc


# ------------------------------------------------------- the register of CRNs


@router.get("/active-crns")
async def list_active_crns(term: str = "", store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    """Our CRNs for a term, each with what the portal says about it and about its parent."""
    return {"crns": store.list_active_crns(term)}


@router.post("/active-crns")
async def add_active_crns(
    body: ActiveCrnsInput, request: Request, store: PortalListStore = Depends(get_store)
) -> dict[str, int]:
    return store.add_active_crns(
        course_codes=body.courseCodes,
        crns=[record.model_dump() for record in body.crns],
        actor=_actor(request),
    )


@router.patch("/active-crns/{crn_id}")
async def update_active_crn(
    crn_id: str, body: ActiveCrnUpdate, store: PortalListStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.update_active_crn(crn_id, parent_crn=body.parentCrn)
    except ActiveCourseNotFound as exc:
        raise _missing("registered CRN") from exc
    except InvalidParent as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/active-crns/{crn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_active_crn(crn_id: str, store: PortalListStore = Depends(get_store)) -> None:
    try:
        store.remove_active_crn(crn_id)
    except ActiveCourseNotFound as exc:
        raise _missing("registered CRN") from exc


@router.get("/register-check")
async def register_check(term: str = "", store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    """Where the registrar's list and the department's register have moved apart."""
    return store.register_check(term)


@router.delete("/active-courses/{active_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_active_course(active_id: str, store: PortalListStore = Depends(get_store)) -> None:
    try:
        store.remove_active_course(active_id)
    except ActiveCourseNotFound as exc:
        raise _missing("active course") from exc


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
