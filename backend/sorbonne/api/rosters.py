from io import BytesIO
from pathlib import Path
from time import strftime
from urllib.parse import quote
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from sorbonne.services.roster_converter import ConversionError, convert_course_roster_pdf

router = APIRouter(prefix="/rosters", tags=["rosters"])
EXPORTS_DIR = Path(__file__).resolve().parents[3] / "exports"


async def _read_pdf(file: UploadFile) -> bytes:
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    return content


@router.post("/preview")
async def preview_roster(file: UploadFile = File(...)) -> dict:
    content = await _read_pdf(file)
    try:
        result = convert_course_roster_pdf(content, source_filename=file.filename)
    except ConversionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result.to_preview_payload()


@router.post("/preview-batch")
async def preview_rosters(files: list[UploadFile] = File(...)) -> dict:
    items = []
    for file in files:
        item = await _preview_batch_item(file)
        items.append(item)

    return {
        "files": items,
        "successCount": sum(1 for item in items if item["ok"]),
        "failureCount": sum(1 for item in items if not item["ok"]),
    }


@router.post("/convert")
async def convert_roster(file: UploadFile = File(...)) -> StreamingResponse:
    content = await _read_pdf(file)
    try:
        result = convert_course_roster_pdf(content, source_filename=file.filename)
    except ConversionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    output = BytesIO(result.to_xlsx_bytes())
    filename = result.excel_filename
    quoted = quote(filename)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quoted}'}

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/convert-batch")
async def convert_rosters(files: list[UploadFile] = File(...)) -> StreamingResponse:
    output = await _build_batch_zip(files)
    output.seek(0)
    filename = "course-rosters.zip"
    quoted = quote(filename)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quoted}'}

    return StreamingResponse(
        output,
        media_type="application/zip",
        headers=headers,
    )


@router.post("/export-batch")
async def export_rosters(files: list[UploadFile] = File(...)) -> dict:
    output = await _build_batch_zip(files)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"course-rosters-{strftime('%Y%m%d-%H%M%S')}.zip"
    path = EXPORTS_DIR / filename
    path.write_bytes(output.getvalue())
    return {"filename": filename, "path": str(path)}


async def _preview_batch_item(file: UploadFile) -> dict:
    filename = file.filename or "Uploaded file"
    try:
        content = await _read_pdf(file)
        result = convert_course_roster_pdf(content, source_filename=file.filename)
    except (ConversionError, HTTPException) as exc:
        message = exc.detail if isinstance(exc, HTTPException) else str(exc)
        return {"filename": filename, "ok": False, "error": message}

    return {"filename": filename, "ok": True, "preview": result.to_preview_payload()}


async def _build_batch_zip(files: list[UploadFile]) -> BytesIO:
    output = BytesIO()
    used_names: set[str] = set()

    with ZipFile(output, mode="w", compression=ZIP_DEFLATED) as archive:
        for file in files:
            try:
                content = await _read_pdf(file)
                result = convert_course_roster_pdf(content, source_filename=file.filename)
                archive.writestr(_unique_zip_name(result.excel_filename, used_names), result.to_xlsx_bytes())
            except (ConversionError, HTTPException) as exc:
                message = exc.detail if isinstance(exc, HTTPException) else str(exc)
                archive.writestr(
                    _unique_zip_name(f"{file.filename or 'roster'}.error.txt", used_names),
                    f"{file.filename or 'Uploaded file'} could not be converted.\n\n{message}\n",
                )

    output.seek(0)
    return output


def _unique_zip_name(filename: str, used_names: set[str]) -> str:
    if filename not in used_names:
        used_names.add(filename)
        return filename

    stem, dot, suffix = filename.rpartition(".")
    base = stem if dot else filename
    extension = f".{suffix}" if dot else ""
    counter = 2
    while True:
        candidate = f"{base}-{counter}{extension}"
        if candidate not in used_names:
            used_names.add(candidate)
            return candidate
        counter += 1
