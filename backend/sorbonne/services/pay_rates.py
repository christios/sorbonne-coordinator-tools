"""What a part-timer is paid an hour: the department's rates, by academic year and degree.

One table per academic year, a row per degree (PhD, Masters, Bachelors), a column per Part
Time Sheet (CM, TD/TP, other work). A cell left empty is work that degree is not paid for —
a Bachelors does not give lectures — and a sheet that needs it goes out with no rate and
a warning, rather than at a rate nobody agreed to.

A period is paid at its own year's rates, the year its first day falls in (August onwards),
so a sheet downloaded again after the rates change still says what was paid.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.part_time_sheet import SHEET_TYPES, split
from sorbonne.services.teacher_store import DEGREES
from sorbonne.services.time_sheet_tasks import academic_year_of

#: How a rate may be written; a rate is never more than this.
HIGHEST = 100_000

#: year -> degree -> sheet -> rate
Table = dict[str, dict[str, dict[str, float]]]


class InvalidRates(ValueError):
    """Not a table of rates — said in words."""


def year_of(period_start: str) -> str:
    """"2026-2027" for any period opening from August 2026 to July 2027; "" if unreadable."""
    try:
        return academic_year_of(date.fromisoformat(period_start))
    except ValueError:
        return ""


class PayRates:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def table(self) -> Table:
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT academic_year, degree, sheet, rate FROM pay_rates")).all()
        held: Table = {}
        for year, degree, sheet, rate in rows:
            held.setdefault(year, {}).setdefault(degree, {})[sheet] = float(rate)
        return held

    def set_year(self, year: str, rates: dict[str, dict[str, Any]], *, actor: str = "") -> Table:
        """Replace one year's table. A cell missing or null is work that degree is not paid for."""
        match = re.fullmatch(r"(\d{4})-(\d{4})", (year or "").strip())
        if not match or int(match.group(2)) != int(match.group(1)) + 1:
            raise InvalidRates(f"{year!r} is not an academic year: write it as 2026-2027.")
        rows = []
        for degree, cells in (rates or {}).items():
            if degree not in DEGREES:
                raise InvalidRates(f"{degree!r} is not a degree: say phd, masters or bachelors.")
            for sheet, rate in (cells or {}).items():
                if sheet not in SHEET_TYPES:
                    raise InvalidRates(f"{sheet!r} is not a kind of work: say CM, TD-TP or OTHER.")
                if rate is None:
                    continue
                if not isinstance(rate, int | float) or isinstance(rate, bool) or not 0 <= rate <= HIGHEST:
                    raise InvalidRates(f"A rate is a number of dirhams from 0 to {HIGHEST:,}.")
                rows.append({"degree": degree, "sheet": sheet, "rate": rate})
        now = datetime.now(UTC).isoformat(timespec="seconds")
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM pay_rates WHERE academic_year = :y"), {"y": year})
            for row in rows:
                connection.execute(
                    text("""INSERT INTO pay_rates (academic_year, degree, sheet, rate, updated_at, updated_by)
                            VALUES (:y, :degree, :sheet, :rate, :at, :by)"""),
                    {**row, "y": year, "at": now, "by": actor},
                )
        return self.table()

    def degrees(self, teacher_ids: list[str]) -> dict[str, str]:
        with self.engine.connect() as connection:
            return {
                str(row[0]): str(row[1] or "")
                for row in connection.execute(
                    text("SELECT id, highest_degree FROM part_time_teachers WHERE id = ANY(:ids)"),
                    {"ids": list(teacher_ids)},
                )
            }


def pay_for(table: Table, *, degree: str, period_start: str, lines: list[dict]) -> dict[str, Any]:
    """The rate of each sheet a period makes, and what stands in the way of paying one.

    `issues` are said on the sheet's pop-up and the bulk download: no degree on the profile,
    no rates for the period's year, or a kind of work the degree is not paid for.
    """
    year = year_of(period_start)
    kinds = list(split(lines)) or ["TD-TP"]
    held = table.get(year, {})
    cells = held.get(degree, {}) if degree else {}
    issues: list[dict[str, str]] = []
    if not degree:
        issues.append({"kind": "no_degree"})
    elif not held:
        issues.append({"kind": "no_rates", "year": year})
    else:
        issues.extend({"kind": "not_paid", "sheet": kind, "degree": degree} for kind in kinds if kind not in cells)
    return {
        "degree": degree,
        "year": year,
        "rates": {kind: cells.get(kind) for kind in kinds},
        "issues": issues,
    }


def rates_of(table: Table, *, degree: str, period_start: str) -> dict[str, Any]:
    """All three of a teacher's rates for a period's year, for the Timesheets app to show.

    A rate of None with no issue is work their degree is not paid for; with an issue, it is
    one nobody can say yet — no degree on their profile, or no table for the year.
    """
    year = year_of(period_start)
    held = table.get(year, {})
    cells = held.get(degree, {}) if degree else {}
    issues = [{"kind": "no_degree"}] if not degree else [] if held else [{"kind": "no_rates", "year": year}]
    return {
        "degree": degree,
        "year": year,
        "rates": {kind: cells.get(kind) for kind in SHEET_TYPES},
        "issues": issues,
    }


def with_pay(engine: Engine, sheets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Approved sheets, each with what its Part Time Sheets are paid at — for the pages."""
    if not sheets:
        return sheets
    rates = PayRates(engine)
    table = rates.table()
    degrees = rates.degrees(list({sheet["teacherId"] for sheet in sheets}))
    return [
        {
            **sheet,
            "pay": pay_for(
                table,
                degree=degrees.get(sheet["teacherId"], ""),
                period_start=sheet["periodStart"],
                lines=sheet["days"],
            ),
        }
        for sheet in sheets
    ]
