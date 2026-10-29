"""Every teacher's classes, read by the SCEN Requests app.

The app's flow copies this into SharePoint every hour, one row per teacher, and a
professor ticks the classes a request is about. So the cases are about who is listed,
which of their classes, and what the app is told of each. The contract is
`requests.classes.v1`.
"""

from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import requests_app as api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.session_changes import SessionChangeStore
from sorbonne.services.student_database import StudentDatabase
from sorbonne.services.teacher_classes import TeacherClasses
from tests.conftest import TEST_DATABASE_URL
from tests.test_timesheet_prefill import TERM, a_part_timer, a_section, empty_tables, swept  # noqa: F401

CLASSES = "/api/v1/requests/classes"
KEY = "a-requests-secret-for-tests"
#: The day the tests are read on, so the look-back reaches the 6th.
TODAY = date(2026, 10, 20)

pytestmark = pytest.mark.anonymous


@pytest.fixture
def service() -> TeacherClasses:
    return TeacherClasses(TEST_DATABASE_URL)


def an_active_teacher(name: str, email: str) -> str:
    """A full-timer: an Active teachers row with an address of its own, and no part-time record."""
    active_id = f"at-{uuid4().hex[:8]}"
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO active_teachers
                        (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at)
                    VALUES (:id, :portal, '', :name, :email, 'now')"""),
            {"id": active_id, "portal": f"A{uuid4().hex[:6]}", "name": name, "email": email},
        )
    return active_id


def by_email(answer: dict, email: str) -> dict:
    return next(teacher for teacher in answer["teachers"] if teacher["email"] == email.lower())


def test_their_classes_run_from_two_weeks_back(service: TeacherClasses):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept(
        {
            "24007": [
                ("2026-10-01", "15:00", "16:30"),
                ("2026-10-08", "15:00", "16:30"),
                ("2026-10-23", "15:00", "16:30"),
            ]
        }
    )

    answer = service.classes(today=TODAY)
    classes = by_email(answer, ahmed["email"])["classes"]

    assert answer["schema"] == "requests.classes.v1"
    assert answer["from"] == "2026-10-06"
    assert [c["date"] for c in classes] == ["2026-10-08", "2026-10-23"]
    first = classes[0]
    assert first["id"] == "262710:24007:2026-10-08:1"
    assert (first["start"], first["end"], first["room"]) == ("15:00", "16:30", "4.024")
    assert (first["crn"], first["course"], first["component"]) == ("24007", "SCEN-102", "TD")
    assert first["label"] == "SCEN-102 TD RDNS 10"
    assert first["status"] == "scheduled"


@pytest.fixture
def rooms_list():
    """Two rooms on the Rooms page: a lab, and the amphitheatre the portal calls by a shortened name."""
    engine = StudentDatabase(TEST_DATABASE_URL).engine
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM rooms"))
        for code, aliases in (("5.104", "[]"), ("Richelieu", '["B5.Richeli"]')):
            connection.execute(
                text("""INSERT INTO rooms (id, code, name, building, kind, seats, aliases, updated_at, updated_by)
                        VALUES (:id, :code, '', '', '', NULL, :aliases, 'now', 'tests')"""),
                {"id": uuid4().hex, "code": code, "aliases": aliases},
            )
    yield
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM rooms"))


def test_a_room_is_named_as_the_rooms_list_names_it(service: TeacherClasses, rooms_list):
    ahmed = a_part_timer("Ahmed Slimani")
    a_section(crn="24008", teacher_id=ahmed["activeId"])
    swept(
        {
            "24008": [
                ("2026-10-08", "08:15", "10:15"),
                ("2026-10-09", "08:15", "10:15"),
                ("2026-10-12", "08:15", "10:15"),
            ]
        }
    )
    with StudentDatabase(TEST_DATABASE_URL).engine.begin() as connection:
        for day, room in (("2026-10-08", "5.104(Phys"), ("2026-10-09", "B5.Richeli"), ("2026-10-12", "5.105/.107")):
            connection.execute(
                text("UPDATE facility_meetings SET room = :room WHERE crn = '24008' AND meets_on = :day"),
                {"room": room, "day": day},
            )

    rooms = [c["room"] for c in by_email(service.classes(today=TODAY), ahmed["email"])["classes"]]

    # cut by the portal to ten characters, another name on the list, and a room the list does not know
    assert rooms == ["5.104", "Richelieu", "5.105/.107"]


def test_everybody_is_listed_with_their_department_even_without_a_class(service: TeacherClasses):
    an_active_teacher("Nadia Farouk", "Nadia.Farouk@sorbonne.ae")

    nadia = by_email(service.classes(today=TODAY), "nadia.farouk@sorbonne.ae")

    assert nadia == {"email": "nadia.farouk@sorbonne.ae", "name": "Nadia Farouk", "department": "SCEN", "classes": []}


def test_somebody_with_no_address_cannot_be_matched_so_is_left_out(service: TeacherClasses):
    an_active_teacher("Nobody Known", "")

    assert all(teacher["name"] != "Nobody Known" for teacher in service.classes(today=TODAY)["teachers"])


def test_somebody_elses_class_is_not_theirs(service: TeacherClasses):
    ahmed = a_part_timer("Ahmed Menaa")
    sara = a_part_timer("Sara Khaled")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept({"24007": [("2026-10-23", "15:00", "16:30")]})

    assert by_email(service.classes(today=TODAY), sara["email"])["classes"] == []


def test_cancelled_covered_and_covering_classes_say_so(service: TeacherClasses):
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

    answer = service.classes(today=TODAY)
    mine = by_email(answer, ahmed["email"])["classes"]
    [cover] = by_email(answer, sara["email"])["classes"]

    assert [(c["status"], c["other"]) for c in mine] == [("cancelled", ""), ("covered", "Sara Khaled")]
    assert (cover["status"], cover["other"]) == ("cover", "Ahmed Menaa")
    assert cover["id"] == "262710:24007:2026-10-23:1"


def test_the_answer_says_how_fresh_the_timetable_is(service: TeacherClasses):
    ahmed = a_part_timer("Ahmed Menaa")
    a_section(crn="24007", teacher_id=ahmed["activeId"])
    swept({"24007": [("2026-10-23", "15:00", "16:30")]}, complete=False)

    answer = service.classes(today=TODAY)

    assert answer["complete"] is False
    assert answer["scheduleSyncedAt"]


# ------------------------------------------------------------------------- the door


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, service: TeacherClasses) -> TestClient:
    monkeypatch.setattr(config, "requests_read_key", KEY)
    app.dependency_overrides[api.get_classes] = lambda: service
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_classes, None)


def test_without_the_requests_key_nothing_is_read(client: TestClient):
    assert client.get(CLASSES).status_code == 401
    assert client.get(CLASSES, headers={"X-Requests-Read-Key": "nope"}).status_code == 401


def test_a_timesheet_key_does_not_open_it(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "timesheet_read_key", "the-timesheet-read-key")
    assert client.get(CLASSES, headers={"X-Timesheet-Read-Key": "the-timesheet-read-key"}).status_code == 401


def test_no_requests_key_configured_means_no_door(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "requests_read_key", None)
    assert TestClient(app).get(CLASSES, headers={"X-Requests-Read-Key": ""}).status_code == 401


def test_the_requests_key_reads_only_this(client: TestClient):
    assert client.get("/api/v1/timesheets/prefill", headers={"X-Requests-Read-Key": KEY}).status_code == 401


def test_the_flow_gets_the_contract_and_it_is_never_kept(client: TestClient):
    answer = client.get(CLASSES, headers={"X-Requests-Read-Key": KEY})

    assert answer.status_code == 200
    assert answer.json()["schema"] == "requests.classes.v1"
    assert answer.headers["cache-control"] == "no-store"
