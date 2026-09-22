from pathlib import Path
from io import BytesIO
from tempfile import NamedTemporaryFile, TemporaryDirectory
from typing import Any
from uuid import uuid4
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

import openpyxl
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from sorbonne.config import config
from sorbonne.api.timesheets import get_intake
from sorbonne.services.time_sheet_intake import TimeSheetIntake
from sorbonne.services.requisition_export import build_requisition_docx
from sorbonne.services.teacher_store import (
    FolderNameConflict,
    FolderNotEmpty,
    FolderNotFound,
    InvalidPeriod,
    InvalidTimeSheetLink,
    RequisitionNotFound,
    RevisionConflict,
    TeacherNotFound,
    DEFAULT_PERIOD_OPENS_ON,
    TeacherStore,
    TimeSheetNotFound,
)

router = APIRouter(prefix="/teachers", tags=["teachers"])
requisition_router = APIRouter(prefix="/teacher-requisitions", tags=["teacher requisitions"])


class TeacherInput(BaseModel):
    fullName: str = Field(min_length=1, max_length=200)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=5000)
    taskTemplateIds: list[str] = Field(default_factory=list, max_length=20)


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parentId: str | None = None


class MoveTeacherRequest(BaseModel):
    folderId: str | None = None


class CreateTeacherRequisitionRequest(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    academicYear: str = Field(min_length=1, max_length=20)
    sourceRequisitionId: str | None = None


class TimeSheetRequest(BaseModel):
    """A labelled link to the teacher's time sheet, wherever it is kept."""

    label: str = Field(min_length=1, max_length=160)
    academicYear: str = Field(default="", max_length=20)
    url: str = Field(min_length=1, max_length=2000)
    #: The day the pay period starts, as a date. Empty where nobody has said.
    periodStart: str = Field(default="", max_length=10)


class RequisitionExportRequest(BaseModel):
    """Which of a teacher's requisitions to put in the zip."""

    ids: list[str] = Field(min_length=1, max_length=50)


class BulkRequisitionExportRequest(BaseModel):
    """Whose requisitions to put in the zip: everything each of these teachers has."""

    teacherIds: list[str] = Field(min_length=1, max_length=200)


class UpdateTeacherRequisitionRequest(BaseModel):
    expectedRevision: int = Field(ge=1)
    label: str = Field(min_length=1, max_length=160)
    academicYear: str = Field(min_length=1, max_length=20)
    content: dict[str, Any]


def get_store() -> TeacherStore:
    return TeacherStore(config.database_url)


class PayCycleInput(BaseModel):
    """The day of the month this semester's pay periods open on."""

    opensOn: int = Field(ge=1, le=28)


@router.get("/pay-cycles")
def pay_cycles(store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    """Which day each semester's pay periods open on, and the day the rest are paid from.

    Only the semesters somebody has decided about are listed. The default is sent with
    them so the browser does not have to carry a second copy of the department's habit.
    """
    return {"cycles": store.pay_cycles(), "default": DEFAULT_PERIOD_OPENS_ON}


@router.put("/pay-cycles/{term_id}")
def set_pay_cycle(
    term_id: str,
    body: PayCycleInput,
    request: Request,
    store: TeacherStore = Depends(get_store),
) -> dict[str, int]:
    staff = getattr(request.state, "staff_user", None)
    try:
        opens_on = store.set_pay_cycle(term_id, body.opensOn, actor=getattr(staff, "email", "") or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"opensOn": opens_on}


@router.get("")
def list_teachers(
    includeArchived: bool = Query(default=False), store: TeacherStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    return {"items": store.list_teachers(include_archived=includeArchived)}


@router.post("", status_code=201)
def create_teacher(request: TeacherInput, store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.create_teacher(
            full_name=request.fullName.strip(),
            email=request.email.strip(),
            phone=request.phone.strip(),
            notes=request.notes.strip(),
            task_template_ids=request.taskTemplateIds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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


@router.get("/courses/academic-years")
def list_academic_years(store: TeacherStore = Depends(get_store)) -> dict[str, list[str]]:
    """The academic years a syllabus may be written for, read from the imported terms."""
    return {"items": store.list_academic_years()}


@router.get("/courses/by-code")
def list_courses_by_code(
    query: str = Query(default="", max_length=200),
    store: TeacherStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    """The course list a syllabus binds to: one entry per course, not per section."""
    return {"items": store.list_courses_by_code(query=query)}


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


@router.post("/export/requisitions")
def export_many_teachers_requisitions(
    request: BulkRequisitionExportRequest,
    background_tasks: BackgroundTasks,
    store: TeacherStore = Depends(get_store),
) -> FileResponse:
    """Every requisition of every teacher named, as one zip with a folder each.

    A folder per teacher rather than one flat heap: the names inside already carry the
    teacher, but a payroll run of twenty people unpacked into one directory is a wall of
    files, and the folder is what makes it a set of people again.

    A teacher with no requisitions is not an error — they are simply somebody there was
    nothing to fetch for, and a selection of twelve should not fail because one of them
    has not been contracted yet. The answer says who those were.
    """
    wanted = list(dict.fromkeys(request.teacherIds))
    try:
        teachers = {identifier: store.get_teacher(identifier) for identifier in wanted}
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc

    with NamedTemporaryFile(prefix="scen-requisitions-", suffix=".zip", delete=False) as file:
        bundle_path = Path(file.name)
    background_tasks.add_task(bundle_path.unlink, missing_ok=True)
    written = 0
    empty: list[str] = []
    with TemporaryDirectory() as workspace, ZipFile(bundle_path, "w", ZIP_DEFLATED) as bundle:
        for identifier in wanted:
            teacher = teachers[identifier]
            folder = _safe_stem(teacher["fullName"])
            used: set[str] = set()
            requisitions = store.list_requisitions(identifier)
            if not requisitions:
                empty.append(teacher["fullName"])
                continue
            for summary in requisitions:
                requisition = store.get_requisition(summary["id"])
                document = Path(workspace) / f"{uuid4()}.docx"
                build_requisition_docx({**requisition, "employeeName": teacher["fullName"]}, document)
                name = _export_filename(teacher["fullName"], requisition["academicYear"])
                if name in used:
                    stem, suffix = name.rsplit(".", 1)
                    name = f"{stem}-{requisition['label'] or len(used)}.{suffix}".replace(" ", "-")
                used.add(name)
                bundle.write(document, arcname=f"{folder}/{name}")
                written += 1
    if not written:
        raise HTTPException(
            status_code=404, detail="None of the teachers you chose has a requisition to download."
        )
    return FileResponse(
        bundle_path,
        media_type="application/zip",
        filename="part-time-requisitions.zip",
        headers={"X-Teachers-Without-Requisitions": str(len(empty))},
        background=background_tasks,
    )


# Ahead of "/{teacher_id}" deliberately: routes match in the order they are declared,
# and below this line "summary" would be read as somebody's id.
@router.get("/summary")
def teacher_library_summary(store: TeacherStore = Depends(get_store)) -> dict[str, Any]:
    """What every teacher's row shows, in one answer instead of one request per teacher."""
    return {"summary": store.library_summary()}


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


def _bad_link() -> HTTPException:
    return HTTPException(
        status_code=422,
        detail="That is not a web address. Paste the link OneDrive gives you, starting with https://.",
    )


def _bad_period() -> HTTPException:
    return HTTPException(status_code=422, detail="A pay period is named by the day it starts, as a date.")


@router.get("/{teacher_id}/submitted-time-sheets")
def list_submitted_time_sheets(
    teacher_id: str, intake: TimeSheetIntake = Depends(get_intake)
) -> dict[str, list[dict[str, Any]]]:
    """The periods this teacher has had approved in the Part-Time Timesheets app.

    A different thing from the sheets above, which are links to workbooks somebody typed
    in. These arrived whole — the hours claimed, the days worked, who approved them — and
    the record shows them against the period they are for.
    """
    return {"items": intake.for_teacher(teacher_id)}


@router.get("/{teacher_id}/time-sheets")
def list_teacher_time_sheets(
    teacher_id: str, store: TeacherStore = Depends(get_store)
) -> dict[str, list[dict[str, Any]]]:
    try:
        return {"items": store.list_time_sheets(teacher_id)}
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc


@router.post("/{teacher_id}/time-sheets", status_code=201)
def create_teacher_time_sheet(
    teacher_id: str, request: TimeSheetRequest, store: TeacherStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        return store.create_time_sheet(
            teacher_id,
            label=request.label,
            academic_year=request.academicYear,
            url=request.url,
            period_start=request.periodStart,
        )
    except TeacherNotFound as exc:
        raise HTTPException(status_code=404, detail="Teacher not found.") from exc
    except InvalidTimeSheetLink as exc:
        raise _bad_link() from exc
    except InvalidPeriod as exc:
        raise _bad_period() from exc


@router.patch("/{teacher_id}/time-sheets/{time_sheet_id}")
def update_teacher_time_sheet(
    teacher_id: str, time_sheet_id: str, request: TimeSheetRequest, store: TeacherStore = Depends(get_store)
) -> dict[str, Any]:
    try:
        if store.get_time_sheet(time_sheet_id)["teacherId"] != teacher_id:
            raise TimeSheetNotFound
        return store.update_time_sheet(
            time_sheet_id,
            label=request.label,
            academic_year=request.academicYear,
            url=request.url,
            period_start=request.periodStart,
        )
    except TimeSheetNotFound as exc:
        raise HTTPException(status_code=404, detail="Time sheet not found on this teacher profile.") from exc
    except InvalidTimeSheetLink as exc:
        raise _bad_link() from exc
    except InvalidPeriod as exc:
        raise _bad_period() from exc


@router.delete("/{teacher_id}/time-sheets/{time_sheet_id}", status_code=204)
def delete_teacher_time_sheet(
    teacher_id: str, time_sheet_id: str, store: TeacherStore = Depends(get_store)
) -> Response:
    try:
        if store.get_time_sheet(time_sheet_id)["teacherId"] != teacher_id:
            raise TimeSheetNotFound
        store.delete_time_sheet(time_sheet_id)
    except TimeSheetNotFound as exc:
        raise HTTPException(status_code=404, detail="Time sheet not found on this teacher profile.") from exc
    return Response(status_code=204)


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


@router.post("/{teacher_id}/requisitions/export")
def export_teacher_requisitions(
    teacher_id: str,
    request: RequisitionExportRequest,
    background_tasks: BackgroundTasks,
    store: TeacherStore = Depends(get_store),
) -> FileResponse:
    """Several of one teacher's requisitions, as one zip of the same documents.

    The single export is unchanged and is what the browser asks for when only one is
    chosen; this exists so that choosing three does not mean three trips to the
    downloads folder. A requisition belonging to somebody else is refused rather than
    quietly dropped, because a zip that is missing one of the things you ticked is
    worse than an error.
    """
    try:
        teacher = store.get_teacher(teacher_id)
        chosen = [store.get_requisition(identifier) for identifier in dict.fromkeys(request.ids)]
    except (RequisitionNotFound, TeacherNotFound) as exc:
        raise HTTPException(status_code=404, detail="Requisition not found.") from exc
    if any(item["teacherId"] != teacher_id for item in chosen):
        raise HTTPException(status_code=404, detail="Those requisitions are not all on this teacher profile.")

    with NamedTemporaryFile(prefix="scen-requisitions-", suffix=".zip", delete=False) as file:
        bundle_path = Path(file.name)
    background_tasks.add_task(bundle_path.unlink, missing_ok=True)
    with TemporaryDirectory() as workspace, ZipFile(bundle_path, "w", ZIP_DEFLATED) as bundle:
        used: set[str] = set()
        for requisition in chosen:
            document = Path(workspace) / f"{uuid4()}.docx"
            build_requisition_docx({**requisition, "employeeName": teacher["fullName"]}, document)
            name = _export_filename(teacher["fullName"], requisition["academicYear"])
            # Two requisitions for one year would otherwise be one name twice in the zip,
            # and the second would replace the first on unpacking.
            if name in used:
                stem, suffix = name.rsplit(".", 1)
                name = f"{stem}-{requisition['label'] or len(used)}.{suffix}".replace(" ", "-")
            used.add(name)
            bundle.write(document, arcname=name)
    return FileResponse(
        bundle_path,
        media_type="application/zip",
        filename=f"{_safe_stem(teacher['fullName'])}-requisitions.zip",
        background=background_tasks,
    )


def _safe_stem(name: str) -> str:
    return "".join(character if character.isalnum() else "-" for character in name).strip("-") or "teacher"


def _export_filename(name: str, academic_year: str) -> str:
    safe_name = "".join(character if character.isalnum() else "-" for character in name).strip("-")
    safe_year = "".join(character if character.isalnum() else "-" for character in academic_year).strip("-")
    return f"Recruitment-Request-{safe_name or 'teacher'}-{safe_year or 'export'}.docx"
