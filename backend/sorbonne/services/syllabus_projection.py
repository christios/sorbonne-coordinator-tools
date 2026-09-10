"""What a syllabus says, section by section, independent of how it is drawn.

The exported document and the in-app export preview are two renderings of one
syllabus. Both reduce to this shape, so a test can hold them against each other
cell by cell rather than trusting that they agree.
"""

from __future__ import annotations

from typing import Any

from docx.table import Table
from docx.document import Document as DocumentType


def document_projection(document: DocumentType) -> dict[str, list[list[str]]]:
    """Read the filled template back out as plain rows."""
    tables = document.tables
    return {
        "identification": _labelled(tables[0], value_column=1),
        "instructor": _labelled(tables[1], value_column=1),
        "coordinator": [[_cell(tables[2], 0, 1)]],
        "description": [[_cell(tables[3], 0, 0)]],
        "delivery": [[_cell(tables[4], 2, 0), _cell(tables[4], 2, 1), _cell(tables[4], 2, 2)]],
        "plos": _body(tables[5], header_rows=1),
        "clos": _body(tables[6], header_rows=1),
        "schedule": _body(tables[7], header_rows=1),
        "bibliography": _labelled(tables[8], value_column=1),
        "assessments": _body(tables[9], header_rows=1),
        "rubrics": _rubrics(tables[11:13]),
    }


def _rubrics(tables: list[Table]) -> list[list[str]]:
    rows: list[list[str]] = []
    for table in tables:
        title = _cell(table, 0, 0).removeprefix("Assessment type:").strip()
        if not title:
            continue
        for row in _body(table, header_rows=2):
            rows.append([title, *row])
    return rows


def _labelled(table: Table, *, value_column: int) -> list[list[str]]:
    rows = []
    for row in table.rows:
        label = _text(row.cells[0].text)
        value = _text(row.cells[value_column].text) if len(row.cells) > value_column else ""
        if label and value:
            rows.append([label, value])
    return rows


def _body(table: Table, *, header_rows: int) -> list[list[str]]:
    rows = []
    for row in table.rows[header_rows:]:
        # A merged cell repeats its text across the row; keep each column once.
        values, seen = [], None
        for cell in row.cells:
            text = _text(cell.text)
            values.append("" if text == seen and text else text)
            seen = text
        # The template pads its tables with numbered but empty rows; those say nothing.
        if any(values[1:]):
            rows.append([_text(cell.text) for cell in row.cells])
    return rows


def _cell(table: Table, row: int, column: int) -> str:
    return _text(table.rows[row].cells[column].text)


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())
