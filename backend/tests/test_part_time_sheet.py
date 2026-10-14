"""HR's Part Time Sheet, filled from an approved period without disturbing anything else in it."""

from __future__ import annotations

import io
import warnings
import zipfile
from datetime import time

import openpyxl
import pytest

from sorbonne.services.part_time_sheet import (
    TEMPLATE_PATH,
    FilledSheet,
    days_of,
    fill,
    gulf_day,
    month_label,
    row_for,
)

START, END = "2026-09-15", "2026-10-14"


def line(on: str, start: str, end: str, hours: float, details: str = "", kind: str = "teaching") -> dict:
    return {"date": on, "from": start, "to": end, "hours": hours, "details": details, "kind": kind}


def opened(data: bytes):
    with warnings.catch_warnings():
        # The time lists are an Excel extension openpyxl does not read; it says so.
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(io.BytesIO(data))["TIME SHEET"]


@pytest.mark.parametrize(("day", "row"), [(15, 17), (16, 18), (31, 33), (1, 34), (14, 47)])
def test_each_day_of_the_month_has_its_row_from_the_15th_to_the_14th(day: int, row: int):
    assert row_for(day) == row


def test_the_month_is_written_the_way_the_templates_own_list_writes_it():
    assert month_label("2026-09-15", "2026-10-14") == "Sep-26 & Oct-26"
    assert month_label("2026-12-15", "2027-01-14") == "Dec-26 & Jan-27"


def test_an_approval_is_dated_on_the_gulfs_calendar_not_greenwichs():
    assert gulf_day("2026-10-14T05:44:10Z") == "2026-10-14"
    # Half past one in the morning in Abu Dhabi is still the day before in UTC.
    assert gulf_day("2026-10-13T21:30:00Z") == "2026-10-14"
    assert gulf_day("") == ""


def test_a_day_of_one_slot_keeps_its_times_and_says_what_the_sheet_says():
    cover = line("2026-09-16", "13:15", "14:45", 1.5, "SCEN-102 TD RDNS 3 (cover for Ahmed Menaa)")
    [day], unplaced = days_of([cover], START, END)

    assert (day.row, day.starts, day.ends, day.hours) == (18, 13 * 60 + 15, 14 * 60 + 45, 1.5)
    assert day.details == "SCEN-102 TD RDNS 3 (cover for Ahmed Menaa)"
    assert unplaced == []


def test_several_slots_in_a_day_start_at_the_first_and_add_up_to_the_days_total():
    """The template has one row a day; the hours approved must still be the hours it shows."""
    [day], _ = days_of(
        [
            line("2026-09-18", "10:15", "11:45", 1.5, "SCEN-102 TD RDNS 3"),
            line("2026-09-18", "08:30", "10:00", 1.5, "SCEN-102 TD RDNS 6"),
            line("2026-09-18", "15:00", "16:00", 1, "Exam board", kind="admin"),
        ],
        START,
        END,
    )

    assert day.starts == 8 * 60 + 30
    assert day.hours == 4
    assert day.ends == 12 * 60 + 30
    assert day.details == (
        "3 slots: 08:30–10:00 SCEN-102 TD RDNS 6; 10:15–11:45 SCEN-102 TD RDNS 3; "
        "15:00–16:00 Admin: Exam board. Shown as 08:30 + 4 h."
    )


def test_a_line_that_cannot_be_placed_is_said_rather_than_lost():
    days, unplaced = days_of(
        [
            line("2026-10-20", "09:00", "10:00", 1),
            line("2026-09-20", "", "", 2),
            line("2026-09-21", "09:00", "10:00", 1),
        ],
        START,
        END,
    )

    assert [day.on for day in days] == ["2026-09-21"]
    assert unplaced == ["2026-10-20 09:00-10:00", "2026-09-20 -"]


def sheet(**changes) -> FilledSheet:
    days, _ = days_of(
        [
            line("2026-09-16", "13:15", "14:45", 1.5, "SCEN-102 TD RDNS 3"),
            line("2026-09-18", "08:30", "10:00", 1.5, "SCEN-102 TD RDNS 6"),
            line("2026-09-18", "10:15", "11:45", 1.5, "SCEN-102 TD RDNS 3"),
            line("2026-10-14", "09:00", "10:00", 1, "Exam board", kind="admin"),
        ],
        START,
        END,
    )
    base = {
        "name": "Jane Doe",
        "id_number": "A00012345",
        "month": "Sep-26 & Oct-26",
        "department": "SCEN",
        "position": "Part Time Lecturer",
        "days": days,
        "rate": 150.0,
        "employee_signed_on": "2026-10-12",
        "head": "Lama Tarsissi",
        "head_signed_on": "2026-10-14",
    }
    return FilledSheet(**{**base, **changes})


def test_the_template_is_filled_where_hr_reads_it():
    cells = opened(fill(sheet()))

    assert [cells[ref].value for ref in ("D9", "D10", "D11", "D12", "D13")] == [
        "Jane Doe", "A00012345", "Sep-26 & Oct-26", "SCEN", "Part Time Lecturer",
    ]
    assert (cells["D18"].value, cells["E18"].value) == (time(13, 15), time(14, 45))
    assert (cells["D20"].value, cells["E20"].value) == (time(8, 30), time(11, 30))
    assert cells["G20"].value.startswith("2 slots: 08:30–10:00")
    assert cells["G47"].value == "Admin: Exam board"
    # The formulas are the template's, untouched; only their inputs were written.
    assert cells["F20"].value == "=(E20-D20)*24"
    assert cells["F48"].value == "=SUM(F17:F47)"
    assert cells["F49"].value == 150.0
    # The two signatures this system can speak for, with their dates.
    assert (cells["E52"].value.date().isoformat(), cells["G52"].value) == ("2026-10-12", "Jane Doe")
    assert (cells["E53"].value.date().isoformat(), cells["G53"].value) == ("2026-10-14", "Lama Tarsissi")
    assert cells["G54"].value is None


def test_a_preview_that_does_not_recalculate_still_shows_the_right_totals():
    data = fill(sheet())
    xml = zipfile.ZipFile(io.BytesIO(data)).read("xl/worksheets/sheet1.xml").decode()

    assert '<c r="F20" s="49"><f t="shared" si="0"/><v>3.0</v></c>' in xml
    assert "<v>5.5</v>" in xml  # F48, the total
    assert "<v>825.0</v>" in xml  # F50, total × rate
    assert 'fullCalcOnLoad="1"' in zipfile.ZipFile(io.BytesIO(data)).read("xl/workbook.xml").decode()


def test_everything_else_in_the_template_is_kept():
    data = fill(sheet())
    original = zipfile.ZipFile(TEMPLATE_PATH)
    filled = zipfile.ZipFile(io.BytesIO(data))

    assert filled.namelist() == original.namelist()
    # The logo, the Menu sheet the time lists come from, and the lists themselves.
    for part in ("xl/media/image1.png", "xl/worksheets/sheet2.xml", "xl/drawings/drawing1.xml"):
        assert filled.read(part) == original.read(part)
    assert "Menu!$D$4:$D$58" in filled.read("xl/worksheets/sheet1.xml").decode()


def test_what_is_not_known_is_left_for_somebody_to_fill():
    cells = opened(fill(sheet(rate=None, employee_signed_on="", head="", head_signed_on="")))

    assert cells["F49"].value is None
    assert cells["E52"].value is None
    assert cells["G53"].value is None
    # The teacher's own name is always known.
    assert cells["G52"].value == "Jane Doe"


def test_text_that_looks_like_markup_is_written_as_text():
    cells = opened(fill(sheet(name="O'Brien & <Sons>")))

    assert cells["D9"].value == "O'Brien & <Sons>"
