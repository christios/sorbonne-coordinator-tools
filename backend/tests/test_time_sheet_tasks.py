"""The task that asks for a period's time sheet: who gets one, when, and what closes it."""

from datetime import date
from uuid import uuid4

import pytest

from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.time_sheet_tasks import (
    TimeSheetTasks,
    academic_year_of,
    opens_on_across,
    period_end,
    period_label,
    period_starts,
    hr_task_id_for,
    task_id_for,
)
from sorbonne.services.time_sheet_intake import TimeSheetIntake
from sorbonne.services.workflow_store import WorkflowStore
from tests.conftest import TEST_DATABASE_URL


@pytest.fixture
def store() -> TeacherStore:
    return TeacherStore(TEST_DATABASE_URL)


@pytest.fixture
def tasks() -> WorkflowStore:
    return WorkflowStore(TEST_DATABASE_URL)


@pytest.fixture
def keeper() -> TimeSheetTasks:
    return TimeSheetTasks(TEST_DATABASE_URL)


def a_teacher(store: TeacherStore) -> dict:
    return store.create_teacher(full_name=f"Dr Period {uuid4()}", email=f"{uuid4()}@sorbonne.ae")


def mine(tasks: WorkflowStore, teacher_id: str) -> list[dict]:
    return [task for task in tasks.list_tasks("teacher", teacher_id) if task["id"].startswith("time-sheet:")]


# --------------------------------------------------------------- the calendar


def test_the_year_is_named_after_the_august_it_opens_in():
    assert academic_year_of(date(2026, 9, 22)) == "2026-2027"
    assert academic_year_of(date(2026, 8, 1)) == "2026-2027"
    assert academic_year_of(date(2027, 1, 30)) == "2026-2027"
    assert academic_year_of(date(2026, 7, 31)) == "2025-2026"


def test_only_the_periods_that_have_opened_are_counted():
    opened = period_starts("2026-2027", 15, opened_by=date(2026, 9, 22))
    assert opened == [date(2026, 8, 15), date(2026, 9, 15)]


def test_a_period_is_not_open_on_the_morning_before_its_day():
    assert period_starts("2026-2027", 15, opened_by=date(2026, 9, 14)) == [date(2026, 8, 15)]


def test_a_whole_year_is_twelve_periods_ending_in_july():
    whole = period_starts("2026-2027", 15, opened_by=date(2027, 12, 31))
    assert len(whole) == 12
    assert whole[-1] == date(2027, 7, 15)


def test_a_period_ends_the_day_before_it_would_come_round_again():
    assert period_end(date(2026, 8, 15)) == date(2026, 9, 14)
    assert period_end(date(2026, 12, 15)) == date(2027, 1, 14)


def test_a_period_says_both_years_only_when_it_spans_them():
    assert period_label(date(2026, 8, 15)) == "15 Aug – 14 Sep 2026"
    assert period_label(date(2026, 12, 15)) == "15 Dec 2026 – 14 Jan 2027"


def test_the_semesters_day_is_used_where_they_agree_and_the_usual_one_where_they_do_not():
    assert opens_on_across({}) == 15
    assert opens_on_across({"S1": 1, "S2": 1}) == 1
    assert opens_on_across({"S1": 1, "S2": 20}) == 15


# ------------------------------------------------------------------ the tasks


def test_a_contracted_teacher_is_asked_for_every_period_that_has_opened(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")

    keeper.catch_up(today=date(2026, 9, 22))

    titles = [task["title"] for task in mine(tasks, teacher["id"])]
    assert titles == ["Time sheet: 15 Aug – 14 Sep 2026", "Time sheet: 15 Sep – 14 Oct 2026"]


def test_a_teacher_with_no_contract_for_the_year_is_asked_for_nothing(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """A task is a claim on somebody's time. Nobody owes a sheet they have no contract for."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Last year", academic_year="2025-2026")

    keeper.catch_up(today=date(2026, 9, 22))

    assert mine(tasks, teacher["id"]) == []


def test_the_task_is_due_the_day_its_period_closes(store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks):
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")

    keeper.catch_up(today=date(2026, 8, 20))

    assert mine(tasks, teacher["id"])[0]["dueDate"] == "2026-09-14"


def test_running_it_again_writes_nothing_new(store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks):
    """It runs on the way to every reader, so twice must cost the same as once."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")

    keeper.catch_up(today=date(2026, 9, 22))
    assert len(mine(tasks, teacher["id"])) == 2

    again = keeper.catch_up(today=date(2026, 9, 22))

    assert again == {"created": 0, "closed": 0, "periods": 2, "toHr": 0}
    assert len(mine(tasks, teacher["id"])) == 2


def test_filing_the_sheet_closes_the_task(store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks):
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))

    store.create_time_sheet(
        teacher["id"],
        label="AugSept",
        academic_year="2026-2027",
        url="https://example.org/sheet",
        period_start="2026-08-15",
    )
    keeper.catch_up(today=date(2026, 9, 22))

    august = next(task for task in mine(tasks, teacher["id"]) if task["dueDate"] == "2026-09-14")
    assert august["status"] == "COMPLETED"
    assert august["completedAt"]
    assert [event["kind"] for event in tasks.list_task_activity(august["id"])] == ["CREATED", "COMPLETED"]


def test_a_period_already_answered_is_never_asked_for(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """A sheet filed before any of this existed still answers its period."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    store.create_time_sheet(
        teacher["id"],
        label="AugSept",
        academic_year="2026-2027",
        url="https://example.org/sheet",
        period_start="2026-08-15",
    )

    keeper.catch_up(today=date(2026, 9, 22))

    august = next(task for task in mine(tasks, teacher["id"]) if task["dueDate"] == "2026-09-14")
    assert august["status"] == "COMPLETED"


def test_a_task_closed_by_hand_is_not_reopened(store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks):
    """Somebody who ticked it off knows something this does not. It stays ticked off."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))
    august = next(task for task in mine(tasks, teacher["id"]) if task["dueDate"] == "2026-09-14")
    tasks.update_task(
        august["id"],
        expected_revision=august["revision"],
        title=august["title"],
        due_date=august["dueDate"],
        status="COMPLETED",
    )

    keeper.catch_up(today=date(2026, 9, 22))

    assert tasks.get_task(august["id"])["status"] == "COMPLETED"


def test_a_task_deleted_by_hand_stays_deleted(store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks):
    """Deleting a period's task says no sheet is owed for it. It used to be written straight
    back by the next read, so the delete looked like it had not worked."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))
    august = task_id_for(teacher["id"], date(2026, 8, 15))

    tasks.delete_task(august, actor="coordinator@sorbonne.ae")
    keeper.catch_up(today=date(2026, 9, 22))

    assert [task["title"] for task in mine(tasks, teacher["id"])] == ["Time sheet: 15 Sep – 14 Oct 2026"]


def test_deleting_one_period_leaves_the_next_one_asked_for(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))
    tasks.delete_task(task_id_for(teacher["id"], date(2026, 8, 15)))

    keeper.catch_up(today=date(2026, 10, 16))

    assert [task["dueDate"] for task in mine(tasks, teacher["id"])] == ["2026-10-14", "2026-11-14"]


def test_a_sheet_pushed_from_the_timesheets_app_closes_the_task_too(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """A period answered in the Power App is answered. The task must not keep asking."""
    teacher = a_teacher(store)
    store.create_requisition(teacher["id"], label="Physics TD", academic_year="2026-2027")
    keeper.catch_up(today=date(2026, 9, 22))

    TimeSheetIntake(TEST_DATABASE_URL).receive(
        {
            "schema": "timesheet.period.v1",
            "periodId": f"pushed-{teacher['id'][:8]}",
            "version": 1,
            "periodStart": "2026-08-15",
            "periodEnd": "2026-09-14",
            "staff": {"email": teacher["email"], "name": teacher["fullName"]},
            "totals": {"hours": 24.5},
            "days": [],
        }
    )
    keeper.catch_up(today=date(2026, 9, 22))

    august = next(task for task in mine(tasks, teacher["id"]) if task["dueDate"] == "2026-09-14")
    assert august["status"] == "COMPLETED"


def test_the_task_is_named_after_its_teacher_and_its_period():
    assert task_id_for("abc", date(2026, 8, 15)) == "time-sheet:abc:2026-08-15"


# ------------------------------------------------------- and then, to HR


def approve(store: TeacherStore, *, version: int = 1, teacher: dict | None = None) -> tuple[dict, str]:
    """A sheet approved in the Timesheets app for August's period; the teacher and the period's id."""
    teacher = teacher or a_teacher(store)
    period_id = f"hr-{teacher['id'][:8]}"
    TimeSheetIntake(TEST_DATABASE_URL).receive(
        {
            "schema": "timesheet.period.v1",
            "periodId": period_id,
            "version": version,
            "periodStart": "2026-08-15",
            "periodEnd": "2026-09-14",
            "staff": {"email": teacher["email"], "name": teacher["fullName"]},
            "totals": {"hours": 6},
            "approval": {"approvedOn": f"2026-09-1{5 + version}T08:00:00Z"},
            "days": [],
        }
    )
    return teacher, period_id


def to_hr(tasks: WorkflowStore, teacher_id: str) -> list[dict]:
    return [task for task in tasks.list_tasks("teacher", teacher_id) if task["id"].startswith("time-sheet-to-hr:")]


def test_an_approved_sheet_asks_for_it_to_be_sent_to_hr(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """Whether or not they hold a requisition: the sheet is approved, so it is owed to HR."""
    teacher, _ = approve(store)

    keeper.catch_up(today=date(2026, 9, 22))

    [task] = to_hr(tasks, teacher["id"])
    assert task["id"] == hr_task_id_for(teacher["id"], "2026-08-15")
    assert task["title"] == "Submitted to HR: 15 Aug – 14 Sep 2026"
    assert (task["status"], task["dueDate"]) == ("NOT_STARTED", None)


def test_the_download_ticks_exactly_the_sheets_it_made_and_says_who(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    sent, sent_id = approve(store)
    kept, _ = approve(store)

    assert keeper.mark_submitted_to_hr([sent_id], by="Christian") == 1

    [done] = to_hr(tasks, sent["id"])
    assert done["status"] == "COMPLETED"
    assert done["description"].startswith("Submitted to HR — marked by Christian on ")
    assert [task["status"] for task in to_hr(tasks, kept["id"])] == ["NOT_STARTED"]
    # The approved sheet says when it went, for the Time sheets tab.
    assert TimeSheetIntake(TEST_DATABASE_URL).for_teacher(sent["id"])[0]["hrSubmittedAt"]
    assert TimeSheetIntake(TEST_DATABASE_URL).for_teacher(kept["id"])[0]["hrSubmittedAt"] == ""
    # Ticking it twice is once.
    assert keeper.mark_submitted_to_hr([sent_id], by="Christian") == 0


def test_a_correction_approved_after_it_went_to_hr_opens_it_again(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher, period_id = approve(store)
    keeper.mark_submitted_to_hr([period_id], by="Christian")

    approve(store, version=2, teacher=teacher)

    [task] = to_hr(tasks, teacher["id"])
    assert task["status"] == "NOT_STARTED"
    assert "corrected version was approved on 2026-09-17" in task["description"]


def test_the_same_version_arriving_again_does_not_open_it(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    """A retry of the flow is not a correction."""
    teacher, period_id = approve(store)
    keeper.mark_submitted_to_hr([period_id], by="Christian")

    approve(store, teacher=teacher)

    assert [task["status"] for task in to_hr(tasks, teacher["id"])] == ["COMPLETED"]


def test_a_submitted_to_hr_task_deleted_by_hand_stays_deleted(
    store: TeacherStore, tasks: WorkflowStore, keeper: TimeSheetTasks
):
    teacher, _ = approve(store)
    keeper.catch_up(today=date(2026, 9, 22))

    tasks.delete_task(hr_task_id_for(teacher["id"], "2026-08-15"), actor="c@sorbonne.ae")
    keeper.catch_up(today=date(2026, 9, 22))

    assert to_hr(tasks, teacher["id"]) == []

