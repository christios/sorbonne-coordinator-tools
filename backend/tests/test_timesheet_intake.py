"""Receiving an approved timesheet from the Part-Time Timesheets app.

The flow writes our answer back onto the SharePoint item, so every case here is really a
question about what a coordinator sees in the app they approved the sheet in.
"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import timesheets as api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.time_sheet_intake import TimeSheetIntake
from tests.conftest import TEST_DATABASE_URL

PUSH = "/api/v1/timesheets"
KEY = "a-shared-secret-for-tests"


@pytest.fixture
def store() -> TeacherStore:
    return TeacherStore(TEST_DATABASE_URL)


@pytest.fixture
def intake() -> TimeSheetIntake:
    return TimeSheetIntake(TEST_DATABASE_URL)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, intake: TimeSheetIntake) -> TestClient:
    monkeypatch.setattr(config, "timesheet_push_key", KEY)
    app.dependency_overrides[api.get_intake] = lambda: intake
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_intake, None)


def a_teacher(store: TeacherStore) -> dict:
    return store.create_teacher(full_name=f"Dr Push {uuid4()}", email=f"{uuid4()}@sorbonne.ae")


def a_push(email: str, *, period_id: str, version: int = 1, hours: float = 24.5) -> dict:
    return {
        "schema": "timesheet.period.v1",
        "periodId": period_id,
        "version": version,
        "periodLabel": "Aug–Sep 2026",
        "periodStart": "2026-08-15",
        "periodEnd": "2026-09-14",
        "staff": {
            "name": "Dr Push",
            "staffId": "A00099999",
            "email": email,
            "department": "SCEN",
            "position": "Lecturer",
        },
        "totals": {"hours": hours},
        "approval": {
            "approvedBy": "Christian Khairallah",
            "approvedByEmail": "christian.khairallah@sorbonne.ae",
            "approvedOn": "2026-09-16T08:00:00Z",
        },
        "days": [
            {"day": "Mon", "date": "2026-08-17", "from": "10:30", "to": "12:30", "hours": 2, "details": "PHYS-125 TD"},
            {"day": "Tue", "date": "2026-08-18", "from": "08:30", "to": "10:00", "hours": 1.5, "details": ""},
        ],
        "sentAt": "2026-09-16T08:02:00Z",
    }


# ------------------------------------------------------------------ the door


def test_a_push_without_the_key_is_refused(client: TestClient):
    """Which the flow reads as a failure, and marks the period Failed in SharePoint."""
    answer = client.post(PUSH, json={"schema": "timesheet.period.v1"})

    assert answer.status_code == 401


def test_a_push_with_the_wrong_key_is_refused(client: TestClient):
    answer = client.post(PUSH, json={}, headers={"X-Timesheet-Key": "not-the-key"})

    assert answer.status_code == 401


def test_no_key_configured_means_no_door_at_all(monkeypatch: pytest.MonkeyPatch):
    """A department not expecting a push should not have an endpoint that takes one."""
    monkeypatch.setattr(config, "timesheet_push_key", None)
    answer = TestClient(app).post(PUSH, json={}, headers={"X-Timesheet-Key": ""})

    assert answer.status_code == 401


# --------------------------------------------------------------- what arrives


def test_an_approved_sheet_is_kept_against_the_period_it_is_for(
    client: TestClient, store: TeacherStore, intake: TimeSheetIntake
):
    teacher = a_teacher(store)

    answer = client.post(
        PUSH, json=a_push(teacher["email"], period_id=f"p{uuid4().hex[:8]}"), headers={"X-Timesheet-Key": KEY}
    )

    assert answer.status_code == 200
    [held] = intake.for_teacher(teacher["id"])
    assert held["periodStart"] == "2026-08-15"
    assert held["claimedHours"] == 24.5
    assert held["approvedBy"] == "Christian Khairallah"
    assert [line["date"] for line in held["days"]] == ["2026-08-17", "2026-08-18"]


def test_the_same_push_twice_is_one_sheet(client: TestClient, store: TeacherStore, intake: TimeSheetIntake):
    """The flow retries a failed push, and a retry must not make a second sheet."""
    teacher = a_teacher(store)
    body = a_push(teacher["email"], period_id=f"p{uuid4().hex[:8]}")

    client.post(PUSH, json=body, headers={"X-Timesheet-Key": KEY})
    client.post(PUSH, json=body, headers={"X-Timesheet-Key": KEY})

    assert len(intake.for_teacher(teacher["id"])) == 1


def test_a_corrected_sheet_replaces_the_one_before_it(
    client: TestClient, store: TeacherStore, intake: TimeSheetIntake
):
    teacher = a_teacher(store)
    period = f"p{uuid4().hex[:8]}"
    client.post(PUSH, json=a_push(teacher["email"], period_id=period), headers={"X-Timesheet-Key": KEY})

    client.post(
        PUSH, json=a_push(teacher["email"], period_id=period, version=2, hours=26), headers={"X-Timesheet-Key": KEY}
    )

    [held] = intake.for_teacher(teacher["id"])
    assert (held["version"], held["claimedHours"]) == (2, 26.0)


def test_a_late_retry_does_not_undo_a_correction(client: TestClient, store: TeacherStore, intake: TimeSheetIntake):
    """Taken, so the app stops trying; ignored, so the correction stands."""
    teacher = a_teacher(store)
    period = f"p{uuid4().hex[:8]}"
    client.post(
        PUSH, json=a_push(teacher["email"], period_id=period, version=2, hours=26), headers={"X-Timesheet-Key": KEY}
    )

    answer = client.post(
        PUSH, json=a_push(teacher["email"], period_id=period, version=1, hours=24.5), headers={"X-Timesheet-Key": KEY}
    )

    assert answer.status_code == 200
    assert answer.json()["stored"] is False
    assert intake.for_teacher(teacher["id"])[0]["claimedHours"] == 26.0


def test_somebody_nobody_knows_is_refused_by_name(client: TestClient):
    answer = client.post(
        PUSH, json=a_push("nobody@sorbonne.ae", period_id="p-unknown"), headers={"X-Timesheet-Key": KEY}
    )

    assert answer.status_code == 422
    assert "nobody@sorbonne.ae" in answer.json()["detail"]
    assert "Pending" in answer.json()["detail"]


def test_a_body_from_something_else_is_refused_saying_what_was_expected(client: TestClient):
    answer = client.post(PUSH, json={"schema": "timesheet.period.v2"}, headers={"X-Timesheet-Key": KEY})

    assert answer.status_code == 400
    assert "timesheet.period.v1" in answer.json()["detail"]


def test_the_address_is_matched_however_it_is_capitalised(
    client: TestClient, store: TeacherStore, intake: TimeSheetIntake
):
    """SharePoint gives the address from the tenant directory; the database was typed."""
    teacher = a_teacher(store)

    client.post(
        PUSH,
        json=a_push(teacher["email"].upper(), period_id=f"p{uuid4().hex[:8]}"),
        headers={"X-Timesheet-Key": KEY},
    )

    assert len(intake.for_teacher(teacher["id"])) == 1


def test_the_portals_address_finds_somebody_with_none_of_their_own(
    client: TestClient, store: TeacherStore, intake: TimeSheetIntake
):
    """Most part-time teachers have no address on their own record, and one in the portal."""
    teacher = store.create_teacher(full_name=f"Dr Portal {uuid4()}")
    address = f"{uuid4()}@sorbonne.ae"
    with intake.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_teachers
                        (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                    VALUES (:id, :portal, :pt, :name, :email, '2026-09-01', 'test')"""),
            {
                "id": str(uuid4()),
                "portal": f"A{uuid4().hex[:8].upper()}",
                "pt": teacher["id"],
                "name": teacher["fullName"],
                "email": address,
            },
        )

    client.post(PUSH, json=a_push(address, period_id=f"p{uuid4().hex[:8]}"), headers={"X-Timesheet-Key": KEY})

    assert len(intake.for_teacher(teacher["id"])) == 1


def test_the_staff_number_finds_them_when_no_address_does(
    client: TestClient, store: TeacherStore, intake: TimeSheetIntake
):
    teacher = store.create_teacher(full_name=f"Dr Numbered {uuid4()}")
    number = f"A{uuid4().hex[:8].upper()}"
    with intake.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_teachers
                        (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                    VALUES (:id, :portal, :pt, :name, '', '2026-09-01', 'test')"""),
            {"id": str(uuid4()), "portal": number, "pt": teacher["id"], "name": teacher["fullName"]},
        )

    body = a_push("", period_id=f"p{uuid4().hex[:8]}")
    body["staff"]["staffId"] = number
    client.post(PUSH, json=body, headers={"X-Timesheet-Key": KEY})

    assert len(intake.for_teacher(teacher["id"])) == 1
