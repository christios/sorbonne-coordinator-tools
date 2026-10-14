"""Approved periods as the university's Part Time Sheet: one workbook, or a zip of them.

Everything the sheet needs comes from somewhere already: the days and the approval from
the Timesheets app, the rate from the teacher's record, the ID from the registrar's portal
(a staff number the app sends wins, but it has never sent one), and the Head of
Department from Settings.
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
from sorbonne.services.part_time_sheet import FilledSheet, days_of, fill, gulf_day, month_label


class SheetNotFound(LookupError):
    """No approved period by that id."""


@dataclass(frozen=True)
class Workbook:
    filename: str
    data: bytes
    #: Lines of the approved sheet the template had no row for, said rather than dropped.
    unplaced: int


_SHEETS = """SELECT s.period_id, s.teacher_id, s.period_start, s.period_end, s.staff_name, s.staff_number,
                    s.department, s.position, s.approved_on, s.submitted_on, s.days,
                    t.full_name AS part_time_name, t.hourly_rate,
                    (SELECT a.portal_teacher_id FROM active_teachers a
                     WHERE a.part_time_teacher_id = s.teacher_id AND coalesce(a.portal_teacher_id, '') <> ''
                     ORDER BY a.id LIMIT 1) AS portal_id
             FROM pushed_time_sheets s
             LEFT JOIN part_time_teachers t ON t.id = s.teacher_id
             WHERE s.period_id = ANY(:ids)"""


def _file_safe(words: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|&]+', " ", words)).strip()


def filename_for(name: str, month: str) -> str:
    """"Part Time Sheet - Jane Doe - Sep-26 and Oct-26.xlsx"."""
    return f"Part Time Sheet - {_file_safe(name) or 'Unnamed'} - {_file_safe(month.replace('&', 'and'))}.xlsx"


class TimeSheetWorkbooks:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def _rows(self, period_ids: list[str]) -> list[Any]:
        with self.engine.connect() as connection:
            return list(connection.execute(text(_SHEETS), {"ids": list(period_ids)}).mappings().all())

    def _filled(self, row: Any, head: dict[str, Any]) -> tuple[FilledSheet, int]:
        days, unplaced = days_of(list(row["days"] or []), row["period_start"], row["period_end"])
        name = (row["staff_name"] or row["part_time_name"] or "").strip()
        sheet = FilledSheet(
            name=name,
            id_number=(row["staff_number"] or row["portal_id"] or "").strip(),
            month=month_label(row["period_start"], row["period_end"]),
            department=row["department"] or "",
            position=row["position"] or "",
            days=days,
            rate=float(row["hourly_rate"]) if row["hourly_rate"] is not None else None,
            employee_signed_on=gulf_day(row["submitted_on"] or ""),
            head=head["fullName"],
            head_signed_on=gulf_day(row["approved_on"] or ""),
            unplaced=unplaced,
        )
        return sheet, len(unplaced)

    def workbook(self, period_id: str) -> Workbook:
        rows = self._rows([period_id])
        if not rows:
            raise SheetNotFound(period_id)
        sheet, unplaced = self._filled(rows[0], DepartmentRoles(self.engine).head())
        return Workbook(filename_for(sheet.name, sheet.month), fill(sheet), unplaced)

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
                sheet, lost = self._filled(row, head)
                unplaced += lost
                months.add(sheet.month)
                name = filename_for(sheet.name, sheet.month)
                stem, number = name[: -len(".xlsx")], 2
                while name in taken:
                    name = f"{stem} ({number}).xlsx"
                    number += 1
                taken.add(name)
                written.writestr(name, fill(sheet))
        month = next(iter(months)) if len(months) == 1 else ""
        title = f"Part Time Sheets - {_file_safe(month.replace('&', 'and'))}.zip" if month else "Part Time Sheets.zip"
        return Workbook(title, out.getvalue(), unplaced)
