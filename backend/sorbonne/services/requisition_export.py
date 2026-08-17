"""Build editable SUAD teaching-recruitment requisition DOCX files."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor


def build_requisition_docx(requisition: dict[str, Any], output_path: Path) -> None:
    """Create an editable requisition while deliberately omitting HR and approval fields."""
    content = _record(requisition.get("content"))
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.55)
    section.bottom_margin = Inches(0.55)
    section.left_margin = Inches(0.6)
    section.right_margin = Inches(0.6)

    title = document.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _run(title, "SUAD Teaching-Recruitment Request / Authorisation", bold=True, size=14)
    subtitle = document.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _run(subtitle, "Academic Division — request details", size=10)

    details = document.add_table(rows=9, cols=2)
    details.style = "Table Grid"
    details.alignment = WD_TABLE_ALIGNMENT.CENTER
    values = [
        ("Academic year", _text(requisition.get("academicYear"))),
        ("Employee name", _text(requisition.get("employeeName"))),
        ("Hiring department", _text(content.get("department"))),
        ("Programme", _text(content.get("program"))),
        ("Job title", _text(content.get("jobTitle"))),
        ("Contract from", _display_date(content.get("contractFrom"))),
        ("Contract to", _display_date(content.get("contractTo"))),
        ("Type of class", _text(content.get("classType"))),
        ("Total hours", str(total_hours(content.get("courses")))),
    ]
    for row, (label, value) in zip(details.rows, values, strict=True):
        row.cells[0].width = Inches(2.0)
        row.cells[0].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        _cell_text(row.cells[0], label, bold=True)
        _cell_text(row.cells[1], value)

    employee_type = _text(content.get("employeeType"))
    type_line = document.add_paragraph()
    _run(type_line, "Employee type: ", bold=True)
    full_time = "☒" if employee_type == "FT" else "☐"
    part_time = "☒" if employee_type != "FT" else "☐"
    _run(type_line, f"{full_time} Full time    {part_time} Part time")

    heading = document.add_paragraph()
    _run(heading, "Academic Division — reasons for recruitment", bold=True, size=11)
    courses = document.add_table(rows=1, cols=5)
    courses.style = "Table Grid"
    courses.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Subject Code", "Course Number", "Level", "Course Title as per Sorbonne Space", "Hours"]
    for cell, header in zip(courses.rows[0].cells, headers, strict=True):
        _cell_text(cell, header, bold=True)
    rows = _rows(content.get("courses"))
    for course in rows:
        cells = courses.add_row().cells
        values = [
            _text(course.get("subjectCode")), _text(course.get("courseNumber")), _text(course.get("level")),
            _text(course.get("title")), _text(course.get("hours")),
        ]
        for cell, value in zip(cells, values, strict=True):
            _cell_text(cell, value)
    if not rows:
        for cell in courses.add_row().cells:
            _cell_text(cell, "")

    note = document.add_paragraph()
    _run(note, "HR / Finance / approval fields are intentionally left blank.", size=8)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)


def total_hours(courses: Any) -> int:
    return sum(int(match.group()) for row in _rows(courses) if (match := re.search(r"\d+", _text(row.get("hours")))))


def _cell_text(cell: Any, text: str, *, bold: bool = False) -> None:
    paragraph = cell.paragraphs[0]
    paragraph.clear()
    _run(paragraph, text, bold=bold)


def _run(paragraph: Any, text: str, *, bold: bool = False, size: int = 9) -> None:
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.name = "Arial"
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor(0x47, 0x4A, 0x4C)


def _display_date(value: Any) -> str:
    text = _text(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        year, month, day = text.split("-")
        return f"{month}/{day}/{year}"
    return text


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _text(value: Any) -> str:
    return str(value or "").strip()
