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
from sorbonne.api.deps import optional_client
from sorbonne.services.facility_timetable import ContradictoryPull, FacilityTimetableStore
from sorbonne.services.portal_lists import (
    PortalTeacherAlreadyLinked,
    PortalTeacherNotFound,
    KINDS,
    ActiveCourseNotFound,
    ActiveTeacherNotFound,
    InvalidParent,
    PortalListStore,
    UnknownDisposition,
    UnknownKind,
    names_agree,
)
from sorbonne.services.term_clashes import cohort_clashes, groups_of
from sorbonne.services.student_database import (
    CohortNotFound,
    DuplicateFilterName,
    FilterNotFound,
    InvalidFilter,
    StudentDatabase,
)
from sorbonne.services.student_timetables import StudentPlatformClient, StudentPlatformError, sessions_of

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


class LinkTeacherInput(BaseModel):
    """Which portal profile an active teacher is."""

    portalTeacherId: str = Field(min_length=1)  # noqa: N815 - the wire is camelCase


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
    #: "" nobody has said · "yes" taught to both degrees at once · "no" to one alone.
    mutualized: str = Field(default="", max_length=10)


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


@router.get("/active-teachers/matches")
async def teacher_matches(store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    """Active teachers who came from the part-time database and look like a portal profile."""
    return {"matches": store.unlinked_portal_matches()}


@router.post("/active-teachers/{active_id}/link")
async def link_active_teacher(
    active_id: str, body: LinkTeacherInput, store: PortalListStore = Depends(get_store)
) -> dict[str, bool]:
    """Say that this active teacher is that portal profile, and let the profile lead."""
    try:
        store.link_active_teacher(active_id, body.portalTeacherId)
    except ActiveTeacherNotFound as exc:
        raise _missing("active teacher") from exc
    except PortalTeacherNotFound as exc:
        raise _missing("portal teacher") from exc
    except PortalTeacherAlreadyLinked as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Somebody else on the department's list is already that portal profile.",
        ) from exc
    return {"linked": True}


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
        return store.update_active_course(
            active_id, title=body.title, ue=body.ue, mutualized=body.mutualized
        )
    except ActiveCourseNotFound as exc:
        raise _missing("active course") from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


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
    """Where the registrar's list and the department's register have moved apart.

    Teacher drift travels with the rest rather than on a route of its own: it is the same
    question — what has moved since we wrote it down — asked of a different column, and one
    page shows the answer.
    """
    # Collisions need a portal term to have been swept, so they travel with the term code
    # rather than the whole register — and their absence is blind, not clean, which the
    # `swept` flag says out loud.
    return {
        **store.register_check(term),
        **store.teacher_drift(term),
        **store.section_collisions(term),
        # Asked separately from whether any collision was found, because those are
        # different facts and only one is good news: with no pull, no collision can be
        # found in any section, and calling that "none" is the mistake this record exists
        # to stop.
        "swept": store.has_facility_pull(term),
    }


class CollisionVerdict(BaseModel):
    """What a coordinator decided about one of our sections sharing an hour with somebody's."""

    termCode: str = Field(min_length=1, max_length=20)
    ourCrn: str = Field(min_length=1, max_length=20)
    weekday: str = Field(min_length=3, max_length=3)
    startsAt: str = Field(min_length=4, max_length=5)
    endsAt: str = Field(min_length=4, max_length=5)
    #: accepted · referred · "" to unsettle it again.
    disposition: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=400)


@router.post("/section-collisions/settle", status_code=status.HTTP_204_NO_CONTENT)
async def settle_collision(
    body: CollisionVerdict,
    request: Request,
    store: PortalListStore = Depends(get_store),
) -> None:
    """Accept a collision or record that it has been referred; an empty disposition undoes it.

    Server-side rather than in the browser's dismissal store: every input is the server's
    and identical for every coordinator, so this is the department deciding rather than one
    person hiding a line on their own machine.
    """
    try:
        store.settle_collision(
            term_code=body.termCode,
            our_crn=body.ourCrn,
            weekday=body.weekday,
            starts_at=body.startsAt,
            ends_at=body.endsAt,
            disposition=body.disposition,
            note=body.note,
            actor=_actor(request),
        )
    except UnknownDisposition as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Unknown disposition: {exc}") from exc


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
        # `names_agree`, not a string compare: the Hub and the portal break a surname's
        # spaces differently just as our planning and the portal do, and this used to report
        # every one of those as a difference.
        if staff and course["teacherName"] and not names_agree(staff, course["teacherName"]):
            differs.append({"crn": crn, "code": section.get("code", ""), "hub": staff, "portal": course["teacherName"]})
    return {
        "portalTermCode": held["portalTermCode"],
        "linked": True,
        "portalCourses": len(crns),
        "hubOnly": hub_only,
        "teacherDiffers": differs,
    }


# ------------------------------------------------------------ the comparison


def get_facilities() -> FacilityTimetableStore:
    return FacilityTimetableStore(config.database_url)


@router.get("/cohorts/{cohort_id}/registration-check")
async def registration_check(
    cohort_id: str,
    store: PortalListStore = Depends(get_store),
    database: StudentDatabase = Depends(get_database),
    facilities: FacilityTimetableStore = Depends(get_facilities),
) -> dict[str, Any]:
    try:
        database.get_cohort(cohort_id)
    except CohortNotFound as exc:
        raise _missing("cohort") from exc
    # The registrar's own timetable, so a section that is not running today is not expected
    # today. Without it the check is date-blind and reports both halves of a half-semester
    # handover as missing all year — which it did, for ten students, every day.
    report = store.registration_check(cohort_id, database, facilities=facilities)
    # Coverage travels with the differences, never separately. A caller that can fetch the
    # verdicts without the floor they rest on will eventually report "nothing wrong" about
    # a cohort nobody has asked the registrar about.
    return {
        "mismatches": [mismatch.as_payload() for mismatch in report.mismatches],
        "coverage": [term.as_payload() for term in report.coverage],
    }


# -------------------------------------------------- the registrar's own schedule


class FacilityMeeting(BaseModel):
    meetsOn: str = Field(min_length=8, max_length=10)
    startsAt: str = Field(min_length=4, max_length=8)
    endsAt: str = Field(min_length=4, max_length=8)
    room: str = Field(default="", max_length=120)


class FacilitySection(BaseModel):
    crn: str = Field(min_length=1, max_length=20)
    courseCode: str = Field(default="", max_length=40)
    title: str = Field(default="", max_length=200)
    teacherName: str = Field(default="", max_length=160)
    rooms: list[str] = Field(default_factory=list, max_length=20)
    ours: bool = Field(default=False)
    headCount: int | None = Field(default=None, ge=0, le=10_000)
    meetings: list[FacilityMeeting] = Field(default_factory=list, max_length=400)


class FacilityPull(BaseModel):
    """One sweep of the registrar's timetable, as the extension reports it.

    `asked` is mandatory and is the whole point: a section that was asked about and
    answered nothing is a fact, and one nobody asked about is a different fact. Without the
    list there is no way to tell them apart, and a pull that silently returned less than it
    should would read as the registrar cancelling classes.
    """

    termCode: str = Field(min_length=1, max_length=20)
    asked: list[str] = Field(default_factory=list, max_length=5000)
    sections: list[FacilitySection] = Field(default_factory=list, max_length=5000)
    silent: list[str] = Field(default_factory=list, max_length=5000)
    failed: list[str] = Field(default_factory=list, max_length=5000)
    #: False when the sweep gave up part way. Its silences are then not evidence.
    complete: bool = Field(default=False)


@router.get("/terms/{term_code}/section-days")
async def section_days(
    term_code: str,
    store: PortalListStore = Depends(get_store),
    facilities: FacilityTimetableStore = Depends(get_facilities),
) -> dict[str, Any]:
    """Which weekdays each section meets on, and which sections nobody knows about.

    On this router deliberately, so it carries no `Depends(require_client)`: the question
    is the registrar's to answer and a Student Hub that is down must not take the Meets
    column away with it.

    `blind` is the other half of the answer and the half that is easy to leave out. A
    section with no facility row is not a section that meets on no days — it is one nobody
    has asked about — and a column that silently omitted it would let "Meets exclude LANG
    Tue" quietly select students whose language hour is simply unknown.
    """
    days = facilities.weekdays_for(term_code)
    ours = store.live_crns()
    return {"days": days, "blind": sorted(crn for crn in ours if crn not in days)}


@router.get("/terms/{term_code}/timetable-targets")
async def timetable_targets(term_code: str, store: PortalListStore = Depends(get_store)) -> dict[str, Any]:
    """Which CRNs the extension should ask the registrar's timetable about.

    From our own registrations, not from a second trip to the portal: it is the only list
    that holds the electives, and asking the registrar twice for something we already know
    is both slower and one more thing to disagree with.
    """
    return store.timetable_targets(term_code)


@router.post("/facility-timetable")
async def record_facility_pull(
    body: FacilityPull,
    request: Request,
    facilities: FacilityTimetableStore = Depends(get_facilities),
) -> dict[str, Any]:
    """Write down one sweep of the registrar's timetable."""
    try:
        return facilities.record_pull(
            term_code=body.termCode,
            asked=body.asked,
            sections=[section.model_dump() for section in body.sections],
            silent=body.silent,
            failed=body.failed,
            complete=body.complete,
            actor=_actor(request),
        )
    except ContradictoryPull as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/terms/{term_id}/clashes")
async def read_term_clashes(
    term_id: str,
    store: PortalListStore = Depends(get_store),
    database: StudentDatabase = Depends(get_database),
    facilities: FacilityTimetableStore = Depends(get_facilities),
    client: StudentPlatformClient | None = Depends(optional_client),
) -> dict[str, Any]:
    """Which groups meet at the same hour, answered from the registrar's own timetable.

    The same reading the publication page gives, without needing the SCEN Student Hub: the
    facilities pull is a record of its own, and a clash it can settle should not be
    unanswerable because a separate deployment is down.

    The Hub is still asked, but only for the sections facilities could not answer for, and
    only if there is one. That ordering is the whole design — the Hub's timetable is itself
    a registrar export uploaded by hand at the start of term, so where the two disagree the
    live one wins, and where facilities is blind a stale answer beats none.

    Never a union of the two for one CRN. A section described by both would contribute two
    spellings of the same meeting and clash with itself.
    """
    cohorts = database.term_publication(term_id)
    if not cohorts:
        return {"termId": term_id, "portalTermCode": "", "linked": False, "cohorts": [], "coverage": {}}

    crns = sorted(
        {
            crn
            for cohort in cohorts
            for group in [*cohort["groups"], *cohort.get("sharedGroups", [])]
            for crns in group["crns"].values()
            for crn in crns
            if crn
        }
    )
    term_code = store.term_links().get(term_id, "")
    coverage = facilities.coverage_for(term_code, crns) if term_code else None
    sessions = facilities.sessions_for(term_code, crns) if term_code else []

    blind = coverage.blind if coverage else crns
    hub_reachable: bool | None = None
    if blind and client is not None:
        hub_reachable = True
        try:
            rows = await client.list_sections(term_id)
            wanted = set(blind)
            sessions = [*sessions, *[row for row in sessions_of(rows) if row.crn in wanted]]
        except StudentPlatformError:
            # A Hub that will not answer degrades the coverage; it never fails the reading.
            hub_reachable = False

    answered = {session.crn for session in sessions}
    return {
        "termId": term_id,
        "portalTermCode": term_code,
        "linked": bool(term_code),
        "pulledAt": coverage.pulled_at if coverage else "",
        "hubReachable": hub_reachable,
        "cohorts": [
            {
                "cohortId": cohort["cohortId"],
                "cohortName": cohort["cohortName"],
                "clashes": cohort_clashes(cohort, groups_of(cohort), sessions),
            }
            for cohort in cohorts
        ],
        # Said out loud beside every count: a clash total over sections nobody has times
        # for is a floor, and one that does not declare itself a floor is worse than none.
        "coverage": {
            "facilities": sorted(answered & set(coverage.published if coverage else [])),
            "blind": sorted(crn for crn in crns if crn not in answered),
        },
    }
