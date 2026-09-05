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
    CourseNotFound,
    InvalidRule,
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
    # What the cohort expects of its students, as the portal codes it: the majors and the
    # portal terms it spans, and a year level. Optional: a cohort that states none of them
    # is judged on status alone.
    majors: list[str] = Field(default_factory=list, max_length=20)
    terms: list[str] = Field(default_factory=list, max_length=20)
    yearLevel: str = Field(default="", max_length=40)


class RuleInput(BaseModel):
    """One thing that counts as a discrepancy — see services.student_database._clean_rule."""

    id: str = Field(default="", max_length=80)
    field: str = Field(min_length=1, max_length=64)
    kind: str = Field(min_length=1, max_length=20)
    values: list[str] = Field(default_factory=list, max_length=100)
    # The cohort the rule is for; empty for every cohort.
    cohortId: str = Field(default="", max_length=80)


class RulesInput(BaseModel):
    rules: list[RuleInput] = Field(default_factory=list, max_length=50)


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
    # shared across its courses, or nested inside another set.
    kind: str = Field(default="shared", max_length=20)
    parent_scope_id: str = Field(default="", alias="parentScopeId", max_length=80)


class CourseInput(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=160)
    component: str = Field(default="", max_length=40)


class SectionInput(BaseModel):
    """What the timetabler's workbook says about one section, beyond its CRN."""

    teacherId: str = Field(default="", max_length=80)
    hours: str = Field(default="", max_length=40)
    # Free text from the workbook — "Weeks 2,5, 1-hour sessions; weeks 4,6,7,8,10,14, 2 2h-sessions; …"
    sessionsPerWeek: str = Field(default="", max_length=240)
    duration: str = Field(default="", max_length=40)
    weeks: str = Field(default="", max_length=240)
    anticipated: int = Field(default=0, ge=0, le=10_000)
    roomPref: str = Field(default="", max_length=200)
    dayPref: str = Field(default="", max_length=200)
    timePref: str = Field(default="", max_length=200)
    constraints: str = Field(default="", max_length=400)
    comments: str = Field(default="", max_length=400)
    retired: bool = False


class GroupInput(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    capacity: int = Field(default=0, ge=0, le=10_000)
    note: str = Field(default="", max_length=400)
    # The programme this group takes first, as the registrar spells it. Empty means any.
    program: str = Field(default="", max_length=160)
    # For a group of a nested set: the group of the parent set it sits inside.
    parent_group_id: str = Field(default="", alias="parentGroupId", max_length=80)


class CellInput(BaseModel):
    """An empty CRN clears the cell, which is how a group drops a course."""

    crn: str = Field(default="", max_length=20)
    teacher: str = Field(default="", max_length=160)


def _missing(exc: Exception, what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"That {what} no longer exists.")


def _duplicate(exc: DuplicateLabel, what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"There is already a {what} called {exc}.")


# ----------------------------------------------------------------- cohorts


@router.get("/cohorts")
async def list_cohorts(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return {"cohorts": database.list_cohorts()}


@router.post("/cohorts", status_code=status.HTTP_201_CREATED)
async def create_cohort(body: CohortInput, database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return database.create_cohort(
        name=body.name,
        term=body.term,
        notes=body.notes,
        majors=body.majors,
        terms=body.terms,
        year_level=body.yearLevel,
    )


@router.patch("/cohorts/{cohort_id}")
async def update_cohort(
    cohort_id: str, body: CohortInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return database.update_cohort(
            cohort_id,
            name=body.name,
            term=body.term,
            notes=body.notes,
            majors=body.majors,
            terms=body.terms,
            year_level=body.yearLevel,
        )
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.delete("/cohorts/{cohort_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cohort(cohort_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    try:
        database.delete_cohort(cohort_id)
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


# ----------------------------------------------------------- discrepancies


@router.get("/discrepancy-rules")
async def list_discrepancy_rules(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    return {"rules": database.list_discrepancy_rules()}


@router.put("/discrepancy-rules")
async def replace_discrepancy_rules(
    body: RulesInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, Any]:
    try:
        return {"rules": database.replace_discrepancy_rules([rule.model_dump() for rule in body.rules])}
    except InvalidRule as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


# ---------------------------------------------------------------- students


@router.get("/students")
async def list_students(view: str = "", database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
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
async def delete_view(view_id: str, request: Request, database: StudentDatabase = Depends(get_database)) -> None:
    _may_define_views(request)
    try:
        database.delete_filter(view_id)
    except FilterNotFound as exc:
        raise _missing(exc, "view") from exc


@router.post("/views/{view_id}/sync")
async def sync_view(view_id: str, body: SyncInput, database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    try:
        return database.sync_view(view_id, body.student_ids)
    except FilterNotFound as exc:
        raise _missing(exc, "view") from exc


@router.post("/students/cohort")
async def set_cohort(body: CohortAssignment, database: StudentDatabase = Depends(get_database)) -> dict[str, int]:
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
        read = parse_group_assignments(content, workbook.filename or "")
        placements, placement_note = read.students, ""
        # The student tabs are the only place that says which column a block's group sits
        # in, and that is what orders two blocks sharing a tab when the file is written out.
        for scope in reference.scopes:
            scope.column_index = read.columns.get(scope.code.upper(), 0)
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
    scope_code_of = {group_id: code for code, labels in groups.items() for group_id in labels.values()}
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
                cohort_id,
                code=body.code,
                name=body.name,
                note=body.note,
                term_id=body.term_id,
                kind=body.kind,
                parent_scope_id=body.parent_scope_id,
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
        database.update_scope(
            scope_id,
            code=body.code,
            name=body.name,
            note=body.note,
            kind=body.kind,
            parent_scope_id=body.parent_scope_id,
        )
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
        return {
            "id": database.add_course(scope_id, code=body.code, name=body.name, component=body.component)
        }
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc


@router.patch("/courses/{course_id}")
async def update_course(
    course_id: str, body: CourseInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    try:
        database.update_course(course_id, code=body.code, name=body.name, component=body.component)
    except CourseNotFound as exc:
        raise _missing(exc, "course") from exc
    return {"saved": True}


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


MAX_PLACEMENTS = 20_000


class PlacementsInput(BaseModel):
    """A whole fill: which students go in which group of the block."""

    placements: dict[str, list[str]] = Field(default_factory=dict)


@router.put("/scopes/{scope_id}/placements")
async def place_students(
    scope_id: str,
    body: PlacementsInput,
    request: Request,
    database: StudentDatabase = Depends(get_database),
) -> dict[str, Any]:
    """Write a previewed fill, all of it or none of it.

    The fill itself is worked out in the browser, which is where the names and programmes
    it orders by are held; only `id -> group` arrives here.
    """
    if sum(len(students) for students in body.placements.values()) > MAX_PLACEMENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That is too many students at once.")
    staff = getattr(request.state, "staff_user", None)
    actor = getattr(staff, "email", "") or ""
    try:
        return database.place_many(scope_id=scope_id, placements=body.placements, actor=actor)
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc


@router.get("/cohorts/{cohort_id}/assignments")
async def read_assignments(cohort_id: str, database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    try:
        return {"assignments": database.assignments_of(cohort_id)}
    except CohortNotFound as exc:
        raise _missing(exc, "cohort") from exc


@router.post("/scopes/{scope_id}/groups", status_code=status.HTTP_201_CREATED)
async def add_group(
    scope_id: str, body: GroupInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, str]:
    try:
        return {
            "id": database.add_group(
                scope_id,
                label=body.label,
                capacity=body.capacity,
                note=body.note,
                program=body.program,
                parent_group_id=body.parent_group_id,
            )
        }
    except ScopeNotFound as exc:
        raise _missing(exc, "block") from exc
    except DuplicateLabel as exc:
        raise _duplicate(exc, "group") from exc


@router.patch("/groups/{group_id}")
async def update_group(
    group_id: str, body: GroupInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    try:
        database.update_group(
            group_id,
            label=body.label,
            capacity=body.capacity,
            note=body.note,
            program=body.program,
            parent_group_id=body.parent_group_id,
        )
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc
    return {"saved": True}


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: str, database: StudentDatabase = Depends(get_database)) -> None:
    database.delete_group(group_id)


@router.patch("/groups/{group_id}/courses/{course_id}")
async def update_section(
    group_id: str, course_id: str, body: SectionInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    """Everything the workbook says about a section but its CRN, which `PUT` sets."""
    try:
        database.update_section(
            group_id=group_id,
            course_id=course_id,
            teacher_id=body.teacherId,
            hours=body.hours,
            sessions_per_week=body.sessionsPerWeek,
            duration=body.duration,
            weeks=body.weeks,
            anticipated=body.anticipated,
            room_pref=body.roomPref,
            day_pref=body.dayPref,
            time_pref=body.timePref,
            constraints=body.constraints,
            comments=body.comments,
            retired=body.retired,
        )
    except GroupNotFound as exc:
        raise _missing(exc, "group") from exc
    except CourseNotFound as exc:
        raise _missing(exc, "course") from exc
    return {"saved": True}


@router.get("/course-cards")
async def course_cards(database: StudentDatabase = Depends(get_database)) -> dict[str, Any]:
    """Every cohort's blocks, every semester: the one list the cards page shows."""
    return {"cohorts": database.list_catalogues()}


@router.put("/groups/{group_id}/courses/{course_id}")
async def set_cell(
    group_id: str, course_id: str, body: CellInput, database: StudentDatabase = Depends(get_database)
) -> dict[str, bool]:
    database.set_cell(group_id=group_id, course_id=course_id, crn=body.crn, teacher=body.teacher)
    return {"saved": True}
