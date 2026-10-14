"""An approved period downloaded as the university's Part Time Sheet, alone or in a zip."""

from __future__ import annotations

import io
import warnings
import zipfile
from uuid import uuid4

import openpyxl
import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import department_roles as roles_api
from sorbonne.api import pay_rates as rates_api
from sorbonne.api import teachers as teachers_api
from sorbonne.api import timesheets as timesheets_api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.department_roles import DepartmentRoles
from sorbonne.services.engine import engine_for
from sorbonne.services.pay_rates import PayRates
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.time_sheet_intake import TimeSheetIntake
from sorbonne.services.time_sheet_workbooks import TimeSheetWorkbooks
from tests.conftest import TEST_DATABASE_URL

TIMESHEETS = "/api/v1/timesheets"
HEAD = "/api/v1/department-roles/head-of-department"
RATES = "/api/v1/pay-rates"

#: The department's rates for 2026-2027, as Christian gave them. Bachelors are not paid CM.
YEAR = {
    "phd": {"CM": 500, "TD-TP": 350, "OTHER": 100},
    "masters": {"CM": 350, "TD-TP": 350, "OTHER": 100},
    "bachelors": {"TD-TP": 150, "OTHER": 100},
}

#: A period of lectures, a tutorial and office hours: three sheets at three rates.
MIXED = [
    {"date": "2026-09-16", "from": "08:30", "to": "10:00", "hours": 1.5, "details": "MATH-001 CM"},
    {"date": "2026-09-16", "from": "10:15", "to": "11:45", "hours": 1.5, "details": "MATH-001 TD G2"},
    {"date": "2026-09-17", "from": "13:00", "to": "14:00", "hours": 1, "details": "Office hours"},
    {"date": "2026-09-18", "from": "08:30", "to": "10:00", "hours": 1.5, "details": "MATH-001", "component": "CM"},
]


@pytest.fixture(autouse=True)
def engine():
    """The test database, and the routes pointed at it."""
    held = engine_for(TEST_DATABASE_URL)
    with held.begin() as connection:
        connection.execute(text("DELETE FROM department_roles"))
        connection.execute(text("DELETE FROM pay_rates"))
    PayRates(held).set_year("2026-2027", YEAR, actor="admin@sorbonne.ae")
    app.dependency_overrides[timesheets_api.get_workbooks] = lambda: TimeSheetWorkbooks(held)
    app.dependency_overrides[rates_api.get_rates] = lambda: PayRates(held)
    app.dependency_overrides[roles_api.get_roles] = lambda: DepartmentRoles(held)
    app.dependency_overrides[teachers_api.get_store] = lambda: TeacherStore(TEST_DATABASE_URL)
    app.dependency_overrides[timesheets_api.get_intake] = lambda: TimeSheetIntake(TEST_DATABASE_URL)
    try:
        yield held
    finally:
        for dependency in (
            timesheets_api.get_workbooks,
            roles_api.get_roles,
            teachers_api.get_store,
            timesheets_api.get_intake,
            rates_api.get_rates,
        ):
            app.dependency_overrides.pop(dependency, None)


def an_active_teacher(engine, *, name: str, portal_id: str = "", part_time_id: str | None = None) -> str:
    row_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_teachers
                        (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                    VALUES (:id, :portal, :pt, :name, '', '2026-09-01', 'test')"""),
            {
                "id": row_id,
                "portal": portal_id or f"HEAD{uuid4().hex[:8].upper()}",
                "pt": part_time_id or "",
                "name": name,
            },
        )
    return row_id


def an_approved_period(
    *,
    degree: str = "bachelors",
    portal_id: str = "",
    submitted: str = "",
    days: list[dict] | None = None,
) -> tuple[str, str]:
    """A part-time teacher with a period approved; the period's id and the teacher's name."""
    store = TeacherStore(TEST_DATABASE_URL)
    name = f"Dr Sheet {uuid4().hex[:6]}"
    teacher = store.create_teacher(full_name=name, email=f"{uuid4()}@sorbonne.ae")
    store.update_teacher(
        teacher["id"],
        full_name=name,
        email=teacher["email"],
        phone="",
        notes="",
        highest_degree=degree,
    )
    if portal_id:
        an_active_teacher(store.engine, name=name, portal_id=portal_id, part_time_id=teacher["id"])
    period_id = f"p{uuid4().hex[:8]}"
    TimeSheetIntake(TEST_DATABASE_URL).receive(
        {
            "schema": "timesheet.period.v1",
            "periodId": period_id,
            "version": 1,
            "periodStart": "2026-09-15",
            "periodEnd": "2026-10-14",
            "staff": {"name": name, "email": teacher["email"], "department": "SCEN", "position": "Part Time Lecturer"},
            "totals": {"hours": 4.5},
            "approval": {"approvedBy": "Lama Tarsissi", "approvedOn": "2026-10-14T05:44:10Z"},
            **({"submittedOn": submitted} if submitted else {}),
            "days": days
            if days is not None
            else [
                {"date": "2026-09-16", "from": "13:15", "to": "14:45", "hours": 1.5, "details": "SCEN-102 TD RDNS 3"},
                {"date": "2026-09-18", "from": "08:30", "to": "10:00", "hours": 1.5, "details": "SCEN-102 TD RDNS 6"},
                {"date": "2026-09-18", "from": "10:15", "to": "11:45", "hours": 1.5, "details": "SCEN-102 TD RDNS 3"},
            ],
        }
    )
    return period_id, name


def cells(data: bytes):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(io.BytesIO(data))["TIME SHEET"]


def test_one_period_downloads_as_the_filled_template(engine):
    head = an_active_teacher(engine, name="Lama Tarsissi")
    DepartmentRoles(engine).set_head(head, actor="admin@sorbonne.ae")
    period_id, name = an_approved_period(portal_id="A00012345", submitted="2026-10-12T09:00:00Z")

    answer = TestClient(app).get(f"{TIMESHEETS}/submitted/{period_id}/workbook")

    assert answer.status_code == 200, answer.text
    assert f"Part Time Sheet - {name} - Sep-26 and Oct-26.xlsx" in answer.headers["content-disposition"]
    assert answer.headers["x-lines-not-placed"] == "0"
    sheet = cells(answer.content)
    assert (sheet["D9"].value, sheet["D10"].value, sheet["D11"].value) == (name, "A00012345", "Sep-26 & Oct-26")
    assert sheet["F49"].value == 150.0
    assert sheet["G20"].value.startswith("2 slots: 08:30–10:00 SCEN-102 TD RDNS 6")
    # The employee's line is theirs, dated the day they submitted; the Head's, the day it was approved.
    assert (sheet["G52"].value, sheet["E52"].value.date().isoformat()) == (name, "2026-10-12")
    assert (sheet["G53"].value, sheet["E53"].value.date().isoformat()) == ("Lama Tarsissi", "2026-10-14")


def test_what_nobody_has_said_yet_is_left_blank_for_somebody_to_fill(engine):
    period_id, _ = an_approved_period(degree="")

    sheet = cells(TestClient(app).get(f"{TIMESHEETS}/submitted/{period_id}/workbook").content)

    assert sheet["D10"].value is None  # no portal ID on file
    assert sheet["F49"].value is None  # no rate on the record
    assert sheet["E52"].value is None  # the app did not say when it was submitted
    assert sheet["G53"].value is None  # no Head of Department in Settings


def test_several_periods_come_as_one_zip_of_one_workbook_each(engine):
    first, first_name = an_approved_period()
    second, second_name = an_approved_period()

    answer = TestClient(app).post(f"{TIMESHEETS}/workbooks", json={"periodIds": [first, second]})

    assert answer.status_code == 200, answer.text
    assert "Part Time Sheets - Sep-26 and Oct-26.zip" in answer.headers["content-disposition"]
    held = zipfile.ZipFile(io.BytesIO(answer.content))
    assert sorted(held.namelist()) == sorted(
        f"Part Time Sheet - {name} - Sep-26 and Oct-26.xlsx" for name in (first_name, second_name)
    )
    assert cells(held.read(held.namelist()[0]))["F49"].value == 150.0


def test_a_period_that_is_not_here_says_so():
    assert TestClient(app).get(f"{TIMESHEETS}/submitted/nothing-{uuid4()}/workbook").status_code == 404
    nothing = {"periodIds": [f"nothing-{uuid4()}"]}
    assert TestClient(app).post(f"{TIMESHEETS}/workbooks", json=nothing).status_code == 404


def test_an_administrator_names_the_head_of_department_and_anybody_reads_it(engine):
    head = an_active_teacher(engine, name="Lama Tarsissi")
    client = TestClient(app)
    assert client.get(HEAD).json()["activeTeacherId"] == ""

    saved = client.put(HEAD, json={"activeTeacherId": head})

    assert saved.status_code == 200, saved.text
    read = client.get(HEAD).json()
    assert (read["activeTeacherId"], read["fullName"]) == (head, "Lama Tarsissi")
    assert client.put(HEAD, json={"activeTeacherId": ""}).json()["activeTeacherId"] == ""


def test_only_somebody_on_active_teachers_can_be_named(engine):
    refused = TestClient(app).put(HEAD, json={"activeTeacherId": f"nobody-{uuid4()}"})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_only_an_administrator_names_the_head_of_department(engine, monkeypatch):
    head = an_active_teacher(engine, name="Lama Tarsissi")
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )
    client = TestClient(app)

    assert client.get(HEAD).status_code == status.HTTP_200_OK
    assert client.put(HEAD, json={"activeTeacherId": head}).status_code == status.HTTP_403_FORBIDDEN


def test_a_period_of_lectures_and_tutorials_is_a_sheet_per_rate():
    """CM and TD/TP are paid differently, and office hours at a rate of their own."""
    period_id, name = an_approved_period(days=MIXED, degree="phd")

    answer = TestClient(app).get(f"{TIMESHEETS}/submitted/{period_id}/workbook")

    assert answer.status_code == 200, answer.text
    assert answer.headers["content-type"] == "application/zip"
    assert f"Part Time Sheets - {name} - Sep-26 and Oct-26.zip" in answer.headers["content-disposition"]
    held = zipfile.ZipFile(io.BytesIO(answer.content))
    stem = f"Part Time Sheet - {name} - Sep-26 and Oct-26"
    assert held.namelist() == [f"{stem} - CM.xlsx", f"{stem} - TD-TP.xlsx", f"{stem} - Other.xlsx"]
    cm, tutorials, other = (cells(held.read(part)) for part in held.namelist())
    # Each sheet its own lines, its own total and its own rate.
    assert (cm["D18"].value is not None, cm["D20"].value is not None, cm["F49"].value) == (True, True, 500.0)
    assert cm["G18"].value == "MATH-001 CM"
    assert (tutorials["G18"].value, tutorials["F49"].value) == ("MATH-001 TD G2", 350.0)
    assert tutorials["D19"].value is None
    assert (other["G19"].value, other["F49"].value) == ("Office hours", 100.0)


def test_the_approved_sheet_says_which_sheets_it_makes_and_where_each_line_goes():
    period_id, _ = an_approved_period(days=MIXED)

    listed = TestClient(app).get(f"{TIMESHEETS}/submitted").json()["items"]
    [sheet] = [one for one in listed if one["periodId"] == period_id]

    assert sheet["partTimeSheets"] == [
        {"type": "CM", "lines": 2, "hours": 3.0},
        {"type": "TD-TP", "lines": 1, "hours": 1.5},
        {"type": "OTHER", "lines": 1, "hours": 1.0},
    ]
    assert [line["sheet"] for line in sheet["days"]] == ["CM", "TD-TP", "OTHER", "CM"]
    assert sheet["days"][3]["component"] == "CM"


def test_the_zip_for_several_teachers_holds_every_sheet_of_every_one():
    mixed, mixed_name = an_approved_period(days=MIXED)
    plain, plain_name = an_approved_period()

    answer = TestClient(app).post(f"{TIMESHEETS}/workbooks", json={"periodIds": [mixed, plain]})

    names = zipfile.ZipFile(io.BytesIO(answer.content)).namelist()
    assert len(names) == 4
    assert f"Part Time Sheet - {plain_name} - Sep-26 and Oct-26.xlsx" in names
    assert f"Part Time Sheet - {mixed_name} - Sep-26 and Oct-26 - CM.xlsx" in names


def listed(period_id: str) -> dict:
    items = TestClient(app).get(f"{TIMESHEETS}/submitted").json()["items"]
    return next(one for one in items if one["periodId"] == period_id)


def test_each_sheet_is_paid_at_the_degrees_rate_for_the_periods_year():
    period_id, _ = an_approved_period(days=MIXED, degree="masters")

    assert listed(period_id)["pay"] == {
        "degree": "masters",
        "year": "2026-2027",
        "rates": {"CM": 350.0, "TD-TP": 350.0, "OTHER": 100.0},
        "issues": [],
    }


def test_a_bachelors_lectures_go_out_unpaid_and_say_so():
    """A Bachelors is not paid CM: the sheet is made, with its hours and no rate, and a warning."""
    period_id, _ = an_approved_period(days=MIXED, degree="bachelors")

    pay = listed(period_id)["pay"]
    assert pay["rates"] == {"CM": None, "TD-TP": 150.0, "OTHER": 100.0}
    assert pay["issues"] == [{"kind": "not_paid", "sheet": "CM", "degree": "bachelors"}]
    answer = TestClient(app).get(f"{TIMESHEETS}/submitted/{period_id}/workbook")
    held = zipfile.ZipFile(io.BytesIO(answer.content))
    cm = cells(held.read(held.namelist()[0]))
    assert (cm["F49"].value, cm["G18"].value) == (None, "MATH-001 CM")


def test_no_degree_and_no_rates_for_the_year_are_said_too(engine):
    period_id, _ = an_approved_period(degree="")
    assert listed(period_id)["pay"]["issues"] == [{"kind": "no_degree"}]

    PayRates(engine).set_year("2026-2027", {}, actor="admin@sorbonne.ae")
    other, _ = an_approved_period(degree="phd")
    assert listed(other)["pay"]["issues"] == [{"kind": "no_rates", "year": "2026-2027"}]


def test_a_period_opening_in_august_is_paid_at_that_academic_years_rates(engine):
    """Rates change by year, and a sheet keeps its own: August 2027 is 2027-2028."""
    PayRates(engine).set_year("2027-2028", {"bachelors": {"TD-TP": 175}}, actor="admin@sorbonne.ae")
    store = TeacherStore(TEST_DATABASE_URL)
    teacher = store.create_teacher(full_name=f"Dr Next {uuid4().hex[:6]}", email=f"{uuid4()}@sorbonne.ae")
    store.update_teacher(teacher["id"], full_name=teacher["fullName"], email=teacher["email"], phone="", notes="",
                         highest_degree="bachelors")
    period_id = f"p{uuid4().hex[:8]}"
    TimeSheetIntake(TEST_DATABASE_URL).receive({
        "schema": "timesheet.period.v1", "periodId": period_id, "version": 1,
        "periodStart": "2027-08-15", "periodEnd": "2027-09-14",
        "staff": {"name": teacher["fullName"], "email": teacher["email"]},
        "days": [{"date": "2027-08-16", "from": "08:30", "to": "10:00", "hours": 1.5, "details": "SCEN-102 TD"}],
    })

    assert listed(period_id)["pay"]["rates"] == {"TD-TP": 175.0}
    assert cells(TestClient(app).get(f"{TIMESHEETS}/submitted/{period_id}/workbook").content)["F49"].value == 175.0


def test_an_administrator_sets_a_years_rates_and_anybody_reads_them(monkeypatch):
    client = TestClient(app)

    saved = client.put(f"{RATES}/2027-2028", json={"rates": {"phd": {"CM": 520, "TD-TP": 360, "OTHER": None}}})

    assert saved.status_code == 200, saved.text
    assert client.get(RATES).json()["years"]["2027-2028"] == {"phd": {"CM": 520.0, "TD-TP": 360.0}}
    for refused in (
        client.put(f"{RATES}/2027", json={"rates": {}}),
        client.put(f"{RATES}/2027-2028", json={"rates": {"diploma": {"CM": 1}}}),
        client.put(f"{RATES}/2027-2028", json={"rates": {"phd": {"Lab": 1}}}),
        client.put(f"{RATES}/2027-2028", json={"rates": {"phd": {"CM": -5}}}),
    ):
        assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY, refused.text
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )
    assert client.get(RATES).status_code == status.HTTP_200_OK
    assert client.put(f"{RATES}/2027-2028", json={"rates": {}}).status_code == status.HTTP_403_FORBIDDEN


def test_a_teachers_degree_is_kept_until_it_is_changed():
    teacher = TeacherStore(TEST_DATABASE_URL).create_teacher(full_name=f"Dr Degree {uuid4()}")
    client = TestClient(app)
    base = {"fullName": teacher["fullName"], "email": "", "phone": "", "notes": ""}
    profile = f"/api/v1/teachers/{teacher['id']}"

    assert client.patch(profile, json={**base, "highestDegree": "PhD"}).json()["highestDegree"] == "phd"
    # A save that does not mention the degree leaves it alone.
    assert client.patch(profile, json={**base, "notes": "x"}).json()["highestDegree"] == "phd"
    assert client.patch(profile, json={**base, "highestDegree": ""}).json()["highestDegree"] == ""
    assert client.patch(profile, json={**base, "highestDegree": "diploma"}).status_code == 422

