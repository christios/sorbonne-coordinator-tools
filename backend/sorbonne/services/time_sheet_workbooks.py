"""Approved periods as the university's Part Time Sheet: one workbook, or a zip of them.

Everything the sheet needs comes from somewhere already: the days and the approval from
the Timesheets app, the rates from the teacher's record, the ID from the registrar's portal
(a staff number the app sends wins, but it has never sent one), and the Head of
Department from Settings.

A period with more than one kind of line — CM, TD/TP, other work — is more than one sheet,
each at its own rate, named for its kind; a period of one kind is one sheet named as before.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.department_roles import DepartmentRoles
from sorbonne.services.part_time_sheet import SHEET_WORDS, FilledSheet, days_of, fill, gulf_day, month_label, split


class SheetNotFound(LookupError):
    """No approved period by that id."""


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ZIP = "application/zip"


@dataclass(frozen=True)
class Workbook:
    filename: str
    data: bytes
    #: Lines of the approved sheet the template had no row for, said rather than dropped.
    unplaced: int
    media_type: str = XLSX


_SHEETS = """SELECT s.period_id, s.teacher_id, s.period_start, s.period_end, s.staff_name, s.staff_number,
                    s.department, s.position, s.approved_on, s.submitted_on, s.days,
                    t.full_name AS part_time_name, t.hourly_rate, t.cm_hourly_rate, t.other_hourly_rate,
                    (SELECT a.portal_teacher_id FROM active_teachers a
                     WHERE a.part_time_teacher_id = s.teacher_id AND coalesce(a.portal_teacher_id, '') <> ''
                     ORDER BY a.id LIMIT 1) AS portal_id
             FROM pushed_time_sheets s
             LEFT JOIN part_time_teachers t ON t.id = s.teacher_id
             WHERE s.period_id = ANY(:ids)"""


def _file_safe(words: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|&]+', " ", words)).strip()


def filename_for(name: str, month: str, kind: str = "") -> str:
    """"Part Time Sheet - Jane Doe - Sep-26 and Oct-26.xlsx", or "… - CM.xlsx" when it is one of several."""
    stem = f"Part Time Sheet - {_file_safe(name) or 'Unnamed'} - {_file_safe(month.replace('&', 'and'))}"
    return f"{stem} - {SHEET_WORDS[kind]}.xlsx" if kind else f"{stem}.xlsx"


#: Which rate on the teacher's record each sheet is paid at.
RATE_OF = {"CM": "cm_hourly_rate", "TD-TP": "hourly_rate", "OTHER": "other_hourly_rate"}


class TimeSheetWorkbooks:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def _rows(self, period_ids: list[str]) -> list[Any]:
        with self.engine.connect() as connection:
            return list(connection.execute(text(_SHEETS), {"ids": list(period_ids)}).mappings().all())

    def _files(self, row: Any, head: dict[str, Any]) -> tuple[list[tuple[str, bytes]], int, str, str]:
        """One period as its sheets — one per kind of line it has — named, filled, and how many lines were lost."""
        name = (row["staff_name"] or row["part_time_name"] or "").strip()
        month = month_label(row["period_start"], row["period_end"])
        groups = split(list(row["days"] or [])) or {"TD-TP": []}
        files: list[tuple[str, bytes]] = []
        lost = 0
        for kind, lines in groups.items():
            days, unplaced = days_of(lines, row["period_start"], row["period_end"])
            lost += len(unplaced)
            rate = row[RATE_OF[kind]]
            sheet = FilledSheet(
                name=name,
                id_number=(row["staff_number"] or row["portal_id"] or "").strip(),
                month=month,
                department=row["department"] or "",
                position=row["position"] or "",
                days=days,
                rate=float(rate) if rate is not None else None,
                employee_signed_on=gulf_day(row["submitted_on"] or ""),
                head=head["fullName"],
                head_signed_on=gulf_day(row["approved_on"] or ""),
                unplaced=unplaced,
            )
            files.append((filename_for(name, month, kind if len(groups) > 1 else ""), fill(sheet)))
        return files, lost, name, month

    def workbook(self, period_id: str) -> Workbook:
        """The period's sheet, or — when it is several, one per rate — a zip of them."""
        rows = self._rows([period_id])
        if not rows:
            raise SheetNotFound(period_id)
        files, lost, name, month = self._files(rows[0], DepartmentRoles(self.engine).head())
        if len(files) == 1:
            return Workbook(files[0][0], files[0][1], lost)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as written:
            for filename, data in files:
                written.writestr(filename, data)
        title = f"Part Time Sheets - {_file_safe(name) or 'Unnamed'} - {_file_safe(month.replace('&', 'and'))}.zip"
        return Workbook(title, out.getvalue(), lost, ZIP)

    def bundle(self, period_ids: list[str]) -> Workbook:
        """Each period's workbook, in one zip; two people of the same name do not overwrite each other."""
        rows = self._rows(period_ids)
        if not rows:
            raise SheetNotFound(", ".join(period_ids))
        head = DepartmentRoles(self.engine).head()
        out = io.BytesIO()
        taken: set[str] = set()
        months: set[str] = set()
        unplaced = 0
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as written:
            for row in sorted(rows, key=lambda one: ((one["staff_name"] or "").casefold(), one["period_start"])):
                files, lost, _, month = self._files(row, head)
                unplaced += lost
                months.add(month)
                for filename, data in files:
                    stem, number, unique = filename[: -len(".xlsx")], 2, filename
                    while unique in taken:
                        unique = f"{stem} ({number}).xlsx"
                        number += 1
                    taken.add(unique)
                    written.writestr(unique, data)
        month = next(iter(months)) if len(months) == 1 else ""
        title = f"Part Time Sheets - {_file_safe(month.replace('&', 'and'))}.zip" if month else "Part Time Sheets.zip"
        return Workbook(title, out.getvalue(), unplaced, ZIP)
