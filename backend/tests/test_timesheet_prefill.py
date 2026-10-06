"""A part-timer's scheduled sessions, read back by the Part-Time Timesheets app.

The flow pre-fills each draft from this once a day, matching rows on `sessionId`, so the
cases here are about what lands in a part-timer's timesheet and what a coordinator is
shown as changed. The contract is `timesheet.prefill.v1`.
"""

from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import timesheets as api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.facility_timetable import FacilityTimetableStore
from sorbonne.services.session_changes import SessionChangeStore
from sorbonne.services.student_database import StudentDatabase
from sorbonne.services.teacher_store import TeacherStore
from sorbonne.services.timesheet_prefill import TimesheetPrefill, names_them, period_of
from tests.conftest import TEST_DATABASE_URL

PREFILL = "/api/v1/timesheets/prefill"
KEY = "a-read-only-secret-for-tests"
TERM = "262710"
#: The day the tests are read on: the 20th, so the 16th is past and the 23rd is not.
TODAY = date(2026, 10, 20)

pytestmark = pytest.mark.anonymous


@pytest.fixture(autouse=True)
def empty_tables() -> None:
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        for table in (
            "facility_meetings",
            "facility_sections",
            "facility_pulls",
            "session_changes",
            "portal_courses",
            "active_course_crns",
            "active_teachers",
            "term_links",
            "teacher_requisitions",
            "part_time_teachers",
        ):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608


@pytest.fixture
def prefill() -> TimesheetPrefill:
    return TimesheetPrefill(TEST_DATABASE_URL)


def a_part_timer(name: str) -> dict:
    """Their part-time record and the Active Teachers row a section names them by."""
    record = TeacherStore(TEST_DATABASE_URL).create_teacher(full_name=name, email=f"{uuid4().hex[:8]}@sorbonne.ae")
    active_id = f"at-{uuid4().hex[:8]}"
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_teachers
                        (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at)
                    VALUES (:id, :portal, :pt, :name, '', 'now')"""),
            {"id": active_id, "portal": f"A{uuid4().hex[:6]}", "pt": record["id"], "name": name},
        )
    return {**record, "activeId": active_id}


def a_section(
    *,
    crn: str,
    teacher_id: str = "",
    teacher: str = "",
    course: str = "SCEN-102",
    component: str = "TD",
    scope: str = "RDNS",
    group: str = "10",
) -> None:
    """One group of one set, on a semester linked to the portal term, holding `crn`."""
    database = StudentDatabase(TEST_DATABASE_URL)
    hub_term = f"term-{uuid4().hex[:8]}"
    with database.engine.begin() as connection:
        connection.execute(
            text("INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, :p)"), {"t": hub_term, "p": TERM}
        )
    cohort = database.create_cohort(name=f"FYS {uuid4().hex[:6]}", term="2026-27")
    set_id = database.add_scope(cohort["id"], code=scope, name="", term_id=hub_term)
    course_id = database.add_course(set_id, code=course, component=component)
    group_id = database.add_group(set_id, label=group)
    database.set_cell(group_id=group_id, course_id=course_id, crn=crn, teacher=teacher)
    if teacher_id:
        database.update_section(group_id=group_id, course_id=course_id, teacher_id=teacher_id)


def swept(sections: dict[str, list[tuple[str, str, str]]], *, teacher: str = "", complete: bool = True) -> None:
    """A Portal sync's timetable step: these sections, with these dated meetings."""
    FacilityTimetableStore(TEST_DATABASE_URL).record_pull(
        term_code=TERM,
        asked=list(sections),
        sections=[
            {
                "crn": crn,
                "courseCode": "SCEN-102",
                "title": f"Maths Readiness {crn}",
                "teacherName": teacher,
                "ours": True,
                "meetings": [
                    {"meetsOn": day, "startsAt": start, "endsAt": end, "room": "4.024"} for day, start, end in meetings
                ],
            }
            for crn, meetings in sections.items()
        ],
        silent=[],
        failed=[],
        complete=complete,
        now="2026-10-20T06:10:00+00:00",
    )


# ------------------------------------------------------------------- the period


def test_a_period_runs_from_the_15th_to_the_14th_across_a_new_year():
    assert period_of("2026-12-15") == (date(2026, 12, 15), date(2027, 1, 14))


def test_a_name_field_with_two_teachers_names_each_of_them():
    theirs = {"khaled sara"}
    assert names_them("Diaa Mereib, Sara Khaled", theirs)
    assert not names_them("Sara Khaledi", theirs)


# ----------------------------------------------------------------- whose sessions


def test_the_sessions_of_a_section_the_planning_names_them_on(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept(
        {
            "24007": [
                ("2026-10-14", "15:00", "16:30"),  # the previous period
                ("2026-10-16", "15:00", "16:30"),
                ("2026-10-16", "16:45", "18:15"),  # twice that day
                ("2026-10-23", "15:00", "16:30"),
                ("2026-11-15", "15:00", "16:30"),  # the next period
            ]
        }
    )

    answer = prefill.sessions(period_start="2026-10-15", email=ahmed["email"].upper(), today=TODAY)

    assert answer["schema"] == "timesheet.prefill.v1"
    assert (answer["periodStart"], answer["periodEnd"]) == ("2026-10-15", "2026-11-14")
    assert answer["teacherName"] == "Ahmed Menaa"
    assert answer["scheduleSyncedAt"] == "2026-10-20T06:10:00+00:00"
    assert answer["complete"] is True
    assert [(s["sessionId"], s["from"], s["to"], s["status"]) for s in answer["sessions"]] == [
        ("262710:24007:2026-10-16:1", "15:00", "16:30", "met"),
        ("262710:24007:2026-10-16:2", "16:45", "18:15", "met"),
        ("262710:24007:2026-10-23:1", "15:00", "16:30", "scheduled"),
    ]
    first = answer["sessions"][0]
    assert first["kind"] == "teaching"
    assert first["label"] == "SCEN-102 TD RDNS 10"
    assert first["ref"] == {"crn": "24007", "courseCode": "SCEN-102", "component": "TD", "group": "RDNS 10"}


def test_an_id_survives_the_registrar_moving_the_hour(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept({"24007": [("2026-10-23", "15:00", "16:30")]})
    before = prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"]
    swept({"24007": [("2026-10-23", "13:15", "14:45")]})

    after = prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"]

    assert [s["sessionId"] for s in after] == [s["sessionId"] for s in before]
    assert after[0]["from"] == "13:15"


def test_a_section_typed_with_their_name_is_theirs_too(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher="ahmed menaa")
    swept({"24007": [("2026-10-16", "15:00", "16:30")]})

    assert len(prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"]) == 1


def test_a_section_only_the_portal_gives_them_counts_even_shared_with_another_name(prefill: TimesheetPrefill):
    sara = a_part_timer("Sara Khaled")
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_course_crns (id, term_code, crn, course_code, added_at, added_by)
                    VALUES ('a1', :t, '23652', 'MATH-011', 'now', '')"""),
            {"t": TERM},
        )
        connection.execute(
            text("""INSERT INTO portal_courses
                        (term_code, crn, course_code, title, teacher_name, first_seen_at, last_seen_at)
                    VALUES (:t, '23652', 'MATH-011', 'Algorithms G.1-TD', 'Diaa Mereib, Sara Khaled', 'now', 'now')"""),
            {"t": TERM},
        )
    swept({"23652": [("2026-10-16", "08:30", "10:00")]})

    [session] = prefill.sessions(period_start="2026-10-15", email=sara["email"], today=TODAY)["sessions"]

    assert session["label"] == "MATH-011 Algorithms G.1-TD"
    assert session["ref"]["crn"] == "23652"


def the_portal_lists(crn: str, teachers: str) -> None:
    """One of our Active CRNs, as the portal's course list staffs it."""
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_course_crns (id, term_code, crn, course_code, added_at, added_by)
                    VALUES (:id, :t, :crn, 'SCEN-102', 'now', '')"""),
            {"id": f"a-{crn}", "t": TERM, "crn": crn},
        )
        connection.execute(
            text("""INSERT INTO portal_courses
                        (term_code, crn, course_code, title, teacher_name, first_seen_at, last_seen_at)
                    VALUES (:t, :crn, 'SCEN-102', 'Maths Readiness G.3-TD', :who, 'now', 'now')"""),
            {"t": TERM, "crn": crn, "who": teachers},
        )


def test_where_the_planning_says_who_teaches_the_portals_second_name_adds_nothing(prefill: TimesheetPrefill):
    """The portal named "Sachin Valera, Ahmed Menaa" on G.3; the planning gives it to Sachin."""
    sachin = a_part_timer("Sachin Valera")
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24000", teacher_id=sachin["activeId"], group="3")
    the_portal_lists("24000", "Sachin Valera, Ahmed Menaa")
    swept({"24000": [("2026-10-16", "13:15", "14:45")]})

    assert prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"] == []
    assert len(prefill.sessions(period_start="2026-10-15", email=sachin["email"], today=TODAY)["sessions"]) == 1


def test_a_section_the_planning_leaves_to_be_decided_follows_the_portal(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24000", teacher="TBD", group="3")
    the_portal_lists("24000", "Sachin Valera, Ahmed Menaa")
    swept({"24000": [("2026-10-16", "13:15", "14:45")]})

    [session] = prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"]
    assert session["ref"]["crn"] == "24000"


def test_somebody_elses_section_is_not_theirs(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    amina = a_part_timer("Amina Menaa")
    a_section(crn="24006", teacher_id=amina["activeId"], group="9")
    swept({"24006": [("2026-10-16", "15:00", "16:30")]})

    assert prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"] == []


# ------------------------------------------------------------ what coordinators said


def test_cancelled_and_covered_sessions_are_returned_and_said_so(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    sara = a_part_timer("Sara Khaled")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept({"24007": [("2026-10-16", "15:00", "16:30"), ("2026-10-23", "15:00", "16:30")]})
    notes = SessionChangeStore(TEST_DATABASE_URL)
    notes.set_change(
        term_code=TERM, crn="24007", meets_on="2026-10-16", starts_at="15:00", ends_at="16:30", kind="cancelled"
    )
    notes.set_change(
        term_code=TERM,
        crn="24007",
        meets_on="2026-10-23",
        starts_at="15:00",
        ends_at="16:30",
        kind="covered",
        cover_teacher_id=sara["activeId"],
        cover_teacher_name="Sara Khaled",
    )

    mine = prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["sessions"]
    covering = prefill.sessions(period_start="2026-10-15", email=sara["email"], today=TODAY)["sessions"]

    assert [s["status"] for s in mine] == ["cancelled", "covered"]
    [cover] = covering
    assert cover["status"] == "cover"
    assert cover["sessionId"] == "262710:24007:2026-10-23:1"
    assert cover["label"] == "SCEN-102 TD RDNS 10 (cover for Ahmed Menaa)"


# --------------------------------------------------------------- the sync it is read from


def test_a_sync_that_stopped_partway_says_the_answer_is_incomplete(prefill: TimesheetPrefill):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept({"24007": [("2026-10-16", "15:00", "16:30")]}, complete=False)

    assert prefill.sessions(period_start="2026-10-15", email=ahmed["email"], today=TODAY)["complete"] is False


# ------------------------------------------------------------------------- the door


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, prefill: TimesheetPrefill) -> TestClient:
    monkeypatch.setattr(config, "timesheet_read_key", KEY)
    app.dependency_overrides[api.get_prefill] = lambda: prefill
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_prefill, None)


def test_without_the_read_key_nothing_is_read(client: TestClient):
    assert client.get(PREFILL, params={"periodStart": "2026-10-15", "email": "x@sorbonne.ae"}).status_code == 401
    wrong = client.get(PREFILL, params={"periodStart": "2026-10-15"}, headers={"X-Timesheet-Read-Key": "nope"})
    assert wrong.status_code == 401


def test_the_push_key_does_not_open_the_read(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "timesheet_push_key", "the-push-key")
    answer = client.get(PREFILL, params={"periodStart": "2026-10-15"}, headers={"X-Timesheet-Key": "the-push-key"})
    assert answer.status_code == 401


def test_no_read_key_configured_means_no_door(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "timesheet_read_key", None)
    answer = TestClient(app).get(PREFILL, params={"periodStart": "2026-10-15"}, headers={"X-Timesheet-Read-Key": ""})
    assert answer.status_code == 401


def test_a_period_that_does_not_start_on_the_15th_is_refused(client: TestClient):
    answer = client.get(
        PREFILL, params={"periodStart": "2026-10-01", "email": "x@sorbonne.ae"}, headers={"X-Timesheet-Read-Key": KEY}
    )

    assert answer.status_code == 400
    assert "15th" in answer.json()["detail"]


def test_somebody_nobody_knows_is_refused_by_address(client: TestClient):
    answer = client.get(
        PREFILL,
        params={"periodStart": "2026-10-15", "email": "nobody@sorbonne.ae"},
        headers={"X-Timesheet-Read-Key": KEY},
    )

    assert answer.status_code == 422
    assert "nobody@sorbonne.ae" in answer.json()["detail"]


def test_the_flow_gets_the_contract_and_it_is_never_kept(client: TestClient):
    ahmed = a_part_timer("Ahmed Menaa")
    answer = client.get(
        PREFILL, params={"periodStart": "2026-10-15", "email": ahmed["email"]}, headers={"X-Timesheet-Read-Key": KEY}
    )

    assert answer.status_code == 200
    assert answer.json()["schema"] == "timesheet.prefill.v1"
    assert answer.headers["cache-control"] == "no-store"
