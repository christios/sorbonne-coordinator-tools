"""The university's Part Time Sheet, filled from a period the Timesheets app had approved.

The template is HR's own workbook: a logo, a time sheet with one row per day of the period
(the 15th to the 14th), the day's start and end times picked from lists on a second sheet,
formulas that turn them into hours, a total and an amount, and a signature block. It is
filled cell by cell in its own XML, and nothing else in it is touched — an Excel library
that read it in and wrote it back out would drop the time lists the cells pick from, which
are an Excel extension the libraries do not keep.

One row per day is the template's rule, and a teacher often worked several slots in a day:
a morning class and an afternoon one. The row then starts at the first slot and ends that
day's total later, so the sheet's own formula gives the hours that were approved, and the
details column says which slots they were. On the first approved period one teacher had
eleven such days: eleven rows whose times are not the times they were in a room, and the
details are what says so.
"""

from __future__ import annotations

import io
import math
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "assets" / "part_time_sheet_template.xlsx"
SHEET = "xl/worksheets/sheet1.xml"
STYLES = "xl/styles.xml"
WORKBOOK = "xl/workbook.xml"

#: The template's day rows: the 15th on row 17, through the 31st on 33, then the 1st on 34
#: through the 14th on 47.
FIRST_ROW = 17
LAST_ROW = 47
SPLIT_DAY = 15

#: Where the template's style for the details column is, and how wide the column reads.
DETAILS_STYLE = 21
DETAILS_CHARACTERS_PER_LINE = 40
LINE_HEIGHT = 11.25
ROW_HEIGHT = 15.75

GULF = ZoneInfo("Asia/Dubai")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass(frozen=True)
class SheetDay:
    """One row of the time sheet: a day, however many slots it was worked in."""

    on: str
    starts: int  # minutes after midnight
    hours: float
    details: str

    @property
    def row(self) -> int:
        return row_for(int(self.on[8:10]))

    @property
    def ends(self) -> int:
        return self.starts + round(self.hours * 60)


@dataclass(frozen=True)
class FilledSheet:
    name: str
    id_number: str
    month: str
    department: str
    position: str
    days: list[SheetDay]
    rate: float | None = None
    #: The two signatures this system can speak for: the teacher's, and the Head of
    #: Department's, each a name and the date it was given (blank when it is not known).
    employee_signed_on: str = ""
    head: str = ""
    head_signed_on: str = ""
    unplaced: list[str] = field(default_factory=list)

    @property
    def total(self) -> float:
        return round(sum(day.hours for day in self.days), 2)


def row_for(day_of_month: int) -> int:
    """The template's row for a day of the month: 15..31 first, then 1..14."""
    if day_of_month >= SPLIT_DAY:
        return FIRST_ROW + day_of_month - SPLIT_DAY
    return FIRST_ROW + (31 - SPLIT_DAY + 1) + day_of_month - 1


def month_label(period_start: str, period_end: str) -> str:
    """"Sep-26 & Oct-26": the way the template's own list of months writes a period."""
    first = date.fromisoformat(period_start)
    last = date.fromisoformat(period_end)
    one = f"{MONTHS[first.month - 1]}-{first.year % 100:02d}"
    two = f"{MONTHS[last.month - 1]}-{last.year % 100:02d}"
    return one if one == two else f"{one} & {two}"


def gulf_day(instant: str) -> str:
    """The Gulf date of a UTC instant the app sends ("2026-10-14T05:44:10Z"); "" if unreadable."""
    text = (instant or "").strip()
    if not text:
        return ""
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]) else ""
    if moment.tzinfo is None:
        return moment.date().isoformat()
    return moment.astimezone(GULF).date().isoformat()


def _minutes(clock: str) -> int | None:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", (clock or "").strip())
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _hours_said(hours: float) -> str:
    return f"{hours:g} h"


def _described(line: dict) -> str:
    """A line's own words, with admin work said to be admin."""
    details = str(line.get("details") or "").strip()
    if str(line.get("kind") or "") == "admin":
        return f"Admin: {details}" if details else "Admin"
    return details


def days_of(lines: list[dict], period_start: str, period_end: str) -> tuple[list[SheetDay], list[str]]:
    """The approved lines as the template's rows: one per day, several slots made one.

    Returns the rows, and the lines that could not be placed — a date outside the period
    or no start time — said rather than dropped, because a sheet that silently lost an
    hour is worse than one that says it could not show it.
    """
    by_day: dict[str, list[dict]] = {}
    unplaced: list[str] = []
    for line in lines:
        on = str(line.get("date") or "")[:10]
        starts = _minutes(str(line.get("from") or ""))
        if not (period_start <= on <= period_end) or starts is None:
            unplaced.append(f"{on or 'no date'} {line.get('from') or ''}-{line.get('to') or ''}".strip())
            continue
        by_day.setdefault(on, []).append(line)

    days: list[SheetDay] = []
    for on in sorted(by_day):
        slots = sorted(by_day[on], key=lambda line: _minutes(str(line.get("from"))) or 0)
        hours = round(sum(float(line.get("hours") or 0) for line in slots), 2)
        first = _minutes(str(slots[0].get("from"))) or 0
        if len(slots) == 1:
            details = _described(slots[0])
        else:
            listed = "; ".join(
                " ".join(
                    part
                    for part in (f"{slot.get('from')}–{slot.get('to')}", _described(slot))
                    if part
                )
                for slot in slots
            )
            details = (
                f"{len(slots)} slots: {listed}. Shown as {_clock(first)} + {_hours_said(hours)}."
            )
        days.append(SheetDay(on=on, starts=first, hours=hours, details=details))
    return days, unplaced


def _excel_day(iso: str) -> int:
    return (date.fromisoformat(iso) - date(1899, 12, 30)).days


def _cell(xml: str, ref: str) -> re.Match[str]:
    found = re.search(rf'<c r="{ref}"(?P<attrs>[^>]*?)(?:/>|>(?P<body>.*?)</c>)', xml, re.S)
    if not found:
        raise ValueError(f"The template has no cell {ref}.")
    return found


def _style(attrs: str) -> str:
    found = re.search(r'\bs="(\d+)"', attrs)
    return f' s="{found.group(1)}"' if found else ""


def _put_text(xml: str, ref: str, value: str, style: int | None = None) -> str:
    found = _cell(xml, ref)
    s = f' s="{style}"' if style is not None else _style(found.group("attrs"))
    cell = f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
    return xml[: found.start()] + cell + xml[found.end() :]


def _put_number(xml: str, ref: str, value: float) -> str:
    found = _cell(xml, ref)
    cell = f'<c r="{ref}"{_style(found.group("attrs"))}><v>{value!r}</v></c>'
    return xml[: found.start()] + cell + xml[found.end() :]


def _cache(xml: str, ref: str, value: float) -> str:
    """A formula's last answer, so a preview that does not recalculate shows the right figure."""
    found = _cell(xml, ref)
    body = found.group("body") or ""
    body = re.sub(r"<v>.*?</v>", f"<v>{value!r}</v>", body) if "<v>" in body else body + f"<v>{value!r}</v>"
    cell = f'<c r="{ref}"{found.group("attrs")}>{body}</c>'
    return xml[: found.start()] + cell + xml[found.end() :]


def _taller(xml: str, row: int, height: float) -> str:
    found = re.search(rf'<row r="{row}"[^>]*>', xml)
    if not found:
        return xml
    tag = re.sub(r'\sht="[^"]*"', "", found.group(0))
    tag = re.sub(r"\scustomHeight=\"[^\"]*\"", "", tag)
    tag = tag.replace(f'<row r="{row}"', f'<row r="{row}" ht="{height:g}" customHeight="1"', 1)
    return xml[: found.start()] + tag + xml[found.end() :]


def _wrapping_style(styles: str) -> tuple[str, int]:
    """The details column's own style, wrapping: the template's does not, and a two-slot day does not fit."""
    head = re.search(r'<cellXfs count="(\d+)">', styles)
    if not head:
        raise ValueError("The template's styles have no cell formats.")
    body = re.search(r"<cellXfs[^>]*>(.*?)</cellXfs>", styles, re.S).group(1)
    formats = re.findall(r"<xf [^>]*?(?:/>|>.*?</xf>)", body, re.S)
    wrapped = re.sub(
        r"<alignment [^>]*/>", '<alignment horizontal="left" vertical="center" wrapText="1"/>', formats[DETAILS_STYLE]
    )
    index = len(formats)
    styles = styles.replace("</cellXfs>", wrapped + "</cellXfs>", 1)
    styles = styles.replace(head.group(0), f'<cellXfs count="{index + 1}">', 1)
    return styles, index


def fill(sheet: FilledSheet, template: bytes | None = None) -> bytes:
    """The template with this sheet written into it, as the bytes of an .xlsx."""
    source = template if template is not None else TEMPLATE_PATH.read_bytes()
    with zipfile.ZipFile(io.BytesIO(source)) as held:
        parts = {name: held.read(name) for name in held.namelist()}
        infos = held.infolist()

    xml = parts[SHEET].decode("utf-8")
    styles, wrapping = _wrapping_style(parts[STYLES].decode("utf-8"))

    for ref, value in (
        ("D9", sheet.name),
        ("D10", sheet.id_number),
        ("D11", sheet.month),
        ("D12", sheet.department),
        ("D13", sheet.position),
    ):
        # Nothing known is the template's own empty cell, not an empty piece of text.
        if value:
            xml = _put_text(xml, ref, value)

    for day in sheet.days:
        row = day.row
        xml = _put_number(xml, f"D{row}", day.starts / 1440)
        xml = _put_number(xml, f"E{row}", day.ends / 1440)
        xml = _cache(xml, f"F{row}", day.hours)
        if day.details:
            xml = _put_text(xml, f"G{row}", day.details, style=wrapping)
            lines = math.ceil(len(day.details) / DETAILS_CHARACTERS_PER_LINE)
            if lines > 1:
                xml = _taller(xml, row, max(ROW_HEIGHT, LINE_HEIGHT * lines + 4))

    total = sheet.total
    xml = _cache(xml, "F48", total)
    xml = _cache(xml, "J48", total)
    if sheet.rate is not None:
        xml = _put_number(xml, "F49", sheet.rate)
        xml = _cache(xml, "F50", round(total * sheet.rate, 2))

    if sheet.employee_signed_on:
        xml = _put_number(xml, "E52", _excel_day(sheet.employee_signed_on))
    xml = _put_text(xml, "G52", sheet.name)
    if sheet.head_signed_on:
        xml = _put_number(xml, "E53", _excel_day(sheet.head_signed_on))
    if sheet.head:
        xml = _put_text(xml, "G53", sheet.head)

    workbook = parts[WORKBOOK].decode("utf-8")
    # Excel works every formula out again on opening, whatever was cached above.
    workbook = re.sub(r"<calcPr\b", '<calcPr fullCalcOnLoad="1"', workbook, count=1)

    parts[SHEET] = xml.encode("utf-8")
    parts[STYLES] = styles.encode("utf-8")
    parts[WORKBOOK] = workbook.encode("utf-8")

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as written:
        for info in infos:
            written.writestr(info, parts[info.filename])
    return out.getvalue()
