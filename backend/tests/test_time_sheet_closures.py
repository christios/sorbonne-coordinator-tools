"""A period the Timesheets app closed with nothing to pay, and reopened (timesheet.closure.v1).

Until 16 Nov 2026 a closed period looked here exactly like a sheet nobody filed: the period's
"Time sheet" task stayed open and the teacher's row said "No sheet filed" for good.
"""

from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sorbonne.api import timesheets as api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.time_sheet_closures import TimeSheetClosures
from sorbonne.services.time_sheet_intake import TimeSheetIntake
from sorbonne.services.time_sheet_tasks import TimeSheetTasks
from sorbonne.services.workflow_store import WorkflowStore
from tests.conftest import TEST_DATABASE_URL

CLOSE = "/api/v1/timesheets/closures"
KEY = "a-shared-secret-for-tests"
AUGUST = "2026-08-15"


@pytest.fixture
def store() -> TeacherStore:
    return TeacherStore(TEST_DATABASE_URL)


@pytest.fixture
def tasks() -> WorkflowStore:
    return WorkflowStore(TEST_DATABASE_URL)


@pytest.fixture
def keeper() -> TimeSheetTasks:
    return TimeSheetTasks(TEST_DATABASE_URL)


@pytest.fixture
def closures() -> TimeSheetClosures:
    return TimeSheetClosures(TEST_DATABASE_URL)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, closures: TimeSheetClosures) -> TestClient:
    monkeypatch.setattr(config, "timesheet_push_key", KEY)
    app.dependency_overrides[api.get_closures] = lambda: closures
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_closures, None)


def contracted(store: TeacherStore, keeper: TimeSheetTasks) -> dict:
    """A part-timer with a contract, whose August and September tasks are already open."""
    teacher = store.create_teacher(full_name=f"Dr Closed {uuid4()}", email=f"{uuid4()}@sorbonne.ae")
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))
    return teacher


def a_closure(teacher: dict, *, state: str = "closed", at: str = "2026-11-16T11:20:00Z", period_id: str = "") -> dict:
    return {
        "schema": "timesheet.closure.v1",
        "periodId": period_id or f"c-{teacher['id'][:8]}",
        "periodStart": AUGUST,
        "periodLabel": "15 Aug - 14 Sep 2026",
        "staff": {"name": teacher["fullName"], "email": teacher["email"], "department": "SCEN", "position": "…"},
        "state": state,
        "reason": "No classes in this period" if state == "closed" else "",
        "hours": 0,
        "by": {"name": "Coordinator Name", "email": "coord@sorbonne.ae"},
        "at": at,
        "sentAt": "2026-11-16T11:20:04Z",
    }


def august(tasks: WorkflowStore, teacher: dict) -> dict:
    """August's "Time sheet" task — not its "Submitted to HR" one, named after the same period."""
    return next(
        task
        for task in tasks.list_tasks("teacher", teacher["id"])
        if task["id"] == f"time-sheet:{teacher['id']}:{AUGUST}"
    )


# ------------------------------------------------------------------ the door


def test_a_closure_without_the_push_key_is_refused(client: TestClient, store: TeacherStore, keeper: TimeSheetTasks):
    teacher = contracted(store, keeper)
    assert client.post(CLOSE, json=a_closure(teacher)).status_code == 401
    assert client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": "wrong"}).status_code == 401


def test_a_closure_is_not_mistaken_for_a_sheet(client: TestClient, store: TeacherStore, keeper: TimeSheetTasks):
    """Sent to the push's door, it is not a timesheet.period.v1, so it is refused, never stored as approved."""
    teacher = contracted(store, keeper)
    refused = client.post("/api/v1/timesheets", json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})
    assert refused.status_code == 400
    assert not [s for s in TimeSheetIntake(TEST_DATABASE_URL).everyone() if s["teacherId"] == teacher["id"]]


def test_a_closure_saying_too_little_is_refused_with_why(
    client: TestClient, store: TeacherStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    for change, said in (
        ({"state": "paid"}, "state"),
        ({"periodStart": "August"}, "periodStart"),
        ({"at": ""}, "at"),
        ({"periodId": ""}, "periodId"),
        ({"schema": "timesheet.closure.v2"}, "timesheet.closure.v1"),
    ):
        refused = client.post(CLOSE, json={**a_closure(teacher), **change}, headers={"X-Timesheet-Key": KEY})
        assert refused.status_code == 400, change
        assert said in refused.json()["detail"]


def test_somebody_nobody_knows_is_refused(client: TestClient, store: TeacherStore, keeper: TimeSheetTasks):
    teacher = {**contracted(store, keeper), "email": "nobody@sorbonne.ae"}
    refused = client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})
    assert refused.status_code == 422
    assert "nobody@sorbonne.ae" in refused.json()["detail"]


# ------------------------------------------------------------- the period


def test_closing_a_period_closes_its_task_and_says_why(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    assert august(tasks, teacher)["status"] == "NOT_STARTED"

    taken = client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})

    assert taken.status_code == 200 and taken.json()["stored"] is True
    task = august(tasks, teacher)
    assert task["status"] == "COMPLETED"
    assert task["description"].startswith("Nothing to pay: No classes in this period. Closed in the Timesheets")
    assert "by Coordinator Name on 2026-11-16" in task["description"]
    # September is somebody else's business.
    september = next(t for t in tasks.list_tasks("teacher", teacher["id"]) if t["id"].endswith(":2026-09-15"))
    assert september["status"] == "NOT_STARTED"
    # And the teacher's record can say it.
    [said] = TimeSheetClosures(TEST_DATABASE_URL).for_teacher(teacher["id"])
    assert (said["periodStart"], said["state"], said["reason"], said["by"]) == (
        AUGUST,
        "closed",
        "No classes in this period",
        "Coordinator Name",
    )


def test_reopening_opens_it_again(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})

    client.post(
        CLOSE, json=a_closure(teacher, state="reopened", at="2026-11-16T12:00:00Z"), headers={"X-Timesheet-Key": KEY}
    )

    task = august(tasks, teacher)
    assert (task["status"], task["completedAt"]) == ("NOT_STARTED", None)
    assert task["description"] == "Closes itself when a time sheet is filed against this period."
    assert [e["kind"] for e in tasks.list_task_activity(task["id"])][-2:] == ["COMPLETED", "REOPENED"]
    # The catch-up leaves a reopened period open.
    keeper.catch_up(today=date(2026, 9, 22))
    assert august(tasks, teacher)["status"] == "NOT_STARTED"


def test_the_latest_word_wins_whatever_order_it_arrives_in(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    client.post(CLOSE, json=a_closure(teacher, at="2026-11-16T12:00:00Z"), headers={"X-Timesheet-Key": KEY})

    late = client.post(
        CLOSE, json=a_closure(teacher, state="reopened", at="2026-11-16T11:00:00Z"), headers={"X-Timesheet-Key": KEY}
    )

    assert late.status_code == 200 and late.json() == {**late.json(), "stored": False, "reason": "older"}
    assert august(tasks, teacher)["status"] == "COMPLETED"


def test_a_task_ticked_by_hand_stays_ticked_when_the_period_is_reopened(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    task = august(tasks, teacher)
    tasks.update_task(
        task["id"],
        status="COMPLETED",
        expected_revision=task["revision"],
        title=task["title"],
        due_date=task["dueDate"],
    )
    client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})

    client.post(
        CLOSE, json=a_closure(teacher, state="reopened", at="2026-11-16T12:00:00Z"), headers={"X-Timesheet-Key": KEY}
    )

    assert august(tasks, teacher)["status"] == "COMPLETED"


def test_a_sheet_beats_a_closure_in_either_order(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """The app sends "reopened" then the push, by two flows, so the push can arrive first."""
    teacher = contracted(store, keeper)
    closed = client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})
    assert closed.status_code == 200, closed.text
    assert august(tasks, teacher)["status"] == "COMPLETED"
    TimeSheetIntake(TEST_DATABASE_URL).receive(
        {
            "schema": "timesheet.period.v1",
            "periodId": f"c-{teacher['id'][:8]}",
            "version": 1,
            "periodStart": AUGUST,
            "periodEnd": "2026-09-14",
            "staff": {"email": teacher["email"], "name": teacher["fullName"]},
            "totals": {"hours": 6},
            "approval": {"approvedOn": "2026-11-16T12:30:00Z"},
            "days": [],
        }
    )
    task = august(tasks, teacher)
    assert task["status"] == "COMPLETED"
    assert not task["description"].startswith("Nothing to pay")

    # The "reopened" arriving after the sheet does not open a period a sheet has answered.
    client.post(
        CLOSE, json=a_closure(teacher, state="reopened", at="2026-11-16T12:00:00Z"), headers={"X-Timesheet-Key": KEY}
    )
    assert august(tasks, teacher)["status"] == "COMPLETED"
    # Nor does a stray "closed" say there was nothing to pay.
    client.post(CLOSE, json=a_closure(teacher, at="2026-11-16T13:00:00Z"), headers={"X-Timesheet-Key": KEY})
    assert not august(tasks, teacher)["description"].startswith("Nothing to pay")


def test_a_period_closed_before_its_task_was_made_starts_answered(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = store.create_teacher(full_name=f"Dr Early {uuid4()}", email=f"{uuid4()}@sorbonne.ae")
    client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY})
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")

    keeper.catch_up(today=date(2026, 9, 22))

    task = august(tasks, teacher)
    assert task["status"] == "COMPLETED"
    assert task["description"].startswith("Nothing to pay: No classes in this period.")


def test_the_same_closure_sent_twice_is_one(
    client: TestClient, store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = contracted(store, keeper)
    for _ in range(2):
        assert client.post(CLOSE, json=a_closure(teacher), headers={"X-Timesheet-Key": KEY}).status_code == 200
    assert len(TimeSheetClosures(TEST_DATABASE_URL).for_teacher(teacher["id"])) == 1
    assert [e["kind"] for e in tasks.list_task_activity(august(tasks, teacher)["id"])].count("COMPLETED") == 1
