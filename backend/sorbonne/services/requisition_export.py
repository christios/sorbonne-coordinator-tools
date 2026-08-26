"""Fill the approved SUAD teaching-recruitment requisition template from a stored requisition."""

from __future__ import annotations

import re
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from typing import Any

from docx import Document
from docx.oxml.ns import qn

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "assets" / "teaching_requisition_template.docx"

_FONT = "Arial"
_FONT_HALF_POINTS = "16"
_COLOUR = "474A4C"
_CLONED_SDT_ID_BASE = 900000000


def build_requisition_docx(requisition: dict[str, Any], output_path: Path) -> None:
    """Write an editable requisition on the approved template, leaving HR and approval fields blank."""
    content = _record(requisition.get("content"))
    document = Document(str(TEMPLATE_PATH))
    body = document.element.body
    details = _table_with(body, "Employee Name")

    _set_cell(_cells(_row_with(details, "Employee Name"))[1], _text(requisition.get("employeeName")))
    _set_dropdown(_row_with(details, "Hiring department"), 0, _text(content.get("department")))
    _set_dropdown(_row_with(details, "Program"), 0, _text(content.get("program")))
    _set_dropdown(_row_with(details, "Job title"), 0, _text(content.get("jobTitle")))
    _set_dropdown(_row_with(details, "Type of class"), 0, _text(content.get("classType")))
    contract = _row_with(details, "Contract period from")
    _set_date(contract, 0, _text(content.get("contractFrom")))
    _set_date(contract, 1, _text(content.get("contractTo")))
    _set_cell(_cells(_row_with(details, "Total number of hours"))[1], total_hours(content.get("courses")))

    part_time = _text(content.get("employeeType")) != "FT"
    employee_type = _row_with(details, "Employee Type")
    _set_checkbox(employee_type, 0, not part_time)
    _set_checkbox(employee_type, 1, part_time)

    _fill_courses(_table_with(body, "Subject Code"), _rows(content.get("courses")))
    _normalise_content_controls(body)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)


def total_hours(courses: Any) -> str:
    total = sum(
        (
            Decimal(match.group().replace(",", "."))
            for row in _rows(courses)
            if (match := re.search(r"\d+(?:[.,]\d+)?", _text(row.get("hours"))))
        ),
        Decimal(),
    )
    return format(total.normalize(), "f")


def _fill_courses(table: Any, courses: list[dict[str, Any]]) -> None:
    """Replace the template's sample rows with one row per course, keeping the level content control."""
    rows = table.findall(qn("w:tr"))
    prototype = deepcopy(rows[1])
    for row in rows[1:]:
        table.remove(row)
    for index, course in enumerate(courses or [{}]):
        row = deepcopy(prototype)
        cells = _cells(row)
        _set_cell(cells[0], _text(course.get("subjectCode")))
        _set_cell(cells[1], _text(course.get("courseNumber")))
        _set_cell(cells[3], _text(course.get("title")))
        _set_cell(cells[4], _course_hours(course))
        for offset, sdt in enumerate(_content_controls(row)):
            _set_id(sdt, _CLONED_SDT_ID_BASE + index * 10 + offset)
        _set_dropdown(row, 0, _text(course.get("level")))
        table.append(row)


def _course_hours(course: dict[str, Any]) -> str:
    hours = _text(course.get("hours"))
    class_type = _text(course.get("classType"))
    return f"{hours} {class_type}".strip() if class_type and class_type.casefold() not in hours.casefold() else hours


def _table_with(body: Any, marker: str) -> Any:
    return next(table for table in body.iter(qn("w:tbl")) if marker in "".join(table.itertext()))


def _row_with(table: Any, label: str) -> Any:
    return next(row for row in table.findall(qn("w:tr")) if "".join(row.itertext()).strip().startswith(label))


def _cells(row: Any) -> list[Any]:
    """Return the row's cells in reading order, including cells wrapped in a content control."""
    cells = []
    for child in row:
        if child.tag == qn("w:tc"):
            cells.append(child)
        elif child.tag == qn("w:sdt"):
            cells.extend(child.iter(qn("w:tc")))
    return cells


def _content_controls(row: Any) -> list[Any]:
    """Return the row's content controls in document order, whether they wrap a cell or sit inside one."""
    return list(row.iter(qn("w:sdt")))


def _set_dropdown(row: Any, index: int, value: str) -> None:
    sdt = _content_controls(row)[index]
    _clear_placeholder(sdt)
    _set_run_text(_first_text(sdt), value)


def _set_date(row: Any, index: int, iso_date: str) -> None:
    sdt = _content_controls(row)[index]
    _clear_placeholder(sdt)
    date = sdt.find(f"{qn('w:sdtPr')}/{qn('w:date')}")
    if date is not None and re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso_date):
        date.set(qn("w:fullDate"), f"{iso_date}T00:00:00Z")
    _set_run_text(_first_text(sdt), _display_date(iso_date))


def _set_checkbox(row: Any, index: int, checked: bool) -> None:
    sdt = _content_controls(row)[index]
    checkbox = next(sdt.iter(qn("w14:checkbox")))
    checkbox.find(qn("w14:checked")).set(qn("w14:val"), "1" if checked else "0")
    _first_text(sdt).text = "☒" if checked else "☐"


def _set_cell(cell: Any, value: str) -> None:
    paragraph = cell.find(qn("w:p"))
    for run in paragraph.findall(qn("w:r")):
        paragraph.remove(run)
    run = paragraph.makeelement(qn("w:r"), {})
    text = run.makeelement(qn("w:t"), {})
    run.append(text)
    paragraph.append(run)
    _set_run_text(text, value)


def _set_run_text(text: Any, value: str) -> None:
    text.text = value
    text.set(qn("xml:space"), "preserve")
    _apply_font(text.getparent())


def _apply_font(run: Any) -> None:
    for existing in run.findall(qn("w:rPr")):
        run.remove(existing)
    properties = run.makeelement(qn("w:rPr"), {})
    fonts = properties.makeelement(qn("w:rFonts"), {})
    for attribute in ("w:ascii", "w:hAnsi", "w:cs"):
        fonts.set(qn(attribute), _FONT)
    colour = properties.makeelement(qn("w:color"), {qn("w:val"): _COLOUR})
    size = properties.makeelement(qn("w:sz"), {qn("w:val"): _FONT_HALF_POINTS})
    complex_size = properties.makeelement(qn("w:szCs"), {qn("w:val"): _FONT_HALF_POINTS})
    for child in (fonts, colour, size, complex_size):
        properties.append(child)
    run.insert(0, properties)


def _clear_placeholder(sdt: Any) -> None:
    for placeholder in list(sdt.iter(qn("w:showingPlcHdr"))):
        placeholder.getparent().remove(placeholder)


def _first_text(sdt: Any) -> Any:
    return next(sdt.find(qn("w:sdtContent")).iter(qn("w:t")))


def _set_id(sdt: Any, value: int) -> None:
    identifier = sdt.find(f"{qn('w:sdtPr')}/{qn('w:id')}")
    if identifier is not None:
        identifier.set(qn("w:val"), str(value))


def _normalise_content_controls(body: Any) -> None:
    """Word rejects a content control whose run properties or end properties are out of schema order."""
    for sdt in body.iter(qn("w:sdt")):
        properties = sdt.find(qn("w:sdtPr"))
        if properties is not None:
            run_properties = properties.find(qn("w:rPr"))
            if run_properties is not None and list(properties).index(run_properties) != 0:
                properties.remove(run_properties)
                properties.insert(0, run_properties)
        end = sdt.find(qn("w:sdtEndPr"))
        content = sdt.find(qn("w:sdtContent"))
        if end is not None and content is not None and list(sdt).index(end) > list(sdt).index(content):
            sdt.remove(end)
            sdt.insert(list(sdt).index(content), end)


def _display_date(value: Any) -> str:
    text = _text(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        year, month, day = (int(part) for part in text.split("-"))
        return f"{month}/{day}/{year}"
    return text


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _text(value: Any) -> str:
    return str(value or "").strip()
