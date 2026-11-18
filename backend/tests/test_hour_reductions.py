"""Hour reductions: a full-timer declares theirs first, the Head of Department sets the rest.

The rules are Lama Tarsissi's (November 2026): 192 h a year, research through SAFIR declared by
the teacher and checked with SAFIR, the department's own set by the Head of Department.
"""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import hour_reductions as department_api
from sorbonne.api import teacher_wishes as coordinators
from sorbonne.api import wish_invite as door
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.account_access import AccountAccess
from sorbonne.services.course_plans import CoursePlans
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions, InvalidReductions, full_time, year_of
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.teacher_wishes import WishStore
from sorbonne.services.wish_invitations import InvitationStore
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/hour-reductions"
WISHES = "/api/v1/wishes"
DOOR = "/api/v1/invite/wishes"
TERM = "262710"
YEAR = "2026-2027"
FT, PT, PORTAL_FT = "reduce-test-ft", "reduce-test-pt", "reduce-test-portal-ft"


@pytest.fixture
def store() -> HourReductions:
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for table in (
            "hour_reductions",
            "hour_reduction_years",
            "hour_reduction_rules",
            "wish_invitations",
            "wish_reopenings",
            "teacher_wishes",
            "wish_collections",
        ):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed names
        connection.execute(text("DELETE FROM department_roles"))
        connection.execute(text("DELETE FROM active_teachers WHERE id LIKE 'reduce-test-%'"))
        connection.execute(text("DELETE FROM portal_teachers WHERE teacher_id = 'reduce-portal'"))
        connection.execute(
            text("""INSERT INTO portal_teachers (teacher_id, full_name, type, first_seen_at, last_seen_at)
                    VALUES ('reduce-portal', 'Portal Fulltimer', 'Full Time Employee', 'x', 'x')""")
        )
        for teacher, name, staff_status, portal, email in (
            (FT, "Lama Tarsissi", "FT", "", "lama.tarsissi@sorbonne.ae"),
            (PT, "Samar Ghantous", "PT", "", ""),
            (PORTAL_FT, "Portal Fulltimer", "", "reduce-portal", ""),
        ):
            connection.execute(
                text("""INSERT INTO active_teachers (id, full_name, staff_status, portal_teacher_id, email, added_at)
                        VALUES (:id, :name, :status, :portal, :email, '2026-11-16')"""),
                {"id": teacher, "name": name, "status": staff_status, "portal": portal, "email": email},
            )
            connection.execute(
                text("INSERT INTO active_teacher_terms (active_id, term_code) VALUES (:id, :term)"),
                {"id": teacher, "term": TERM},
            )
    return HourReductions(engine)


@pytest.fixture
def client(store: HourReductions, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = store.engine
    wishes, invitations = WishStore(engine), InvitationStore(engine)
    overrides = {
        coordinators.get_wishes: lambda: wishes,
        coordinators.get_invitations: lambda: invitations,
        door.get_wishes: lambda: wishes,
        door.get_invitations: lambda: invitations,
        door.get_reductions: lambda: store,
        door.get_course_plans: lambda: CoursePlans(engine),
        department_api.get_reductions: lambda: store,
        # Who administers what is read from the tests' database too: the page reads it from
        # the configured one, which is a developer's own wherever the two are kept apart.
        department_api.get_account_access: lambda: AccountAccess(TEST_DATABASE_URL),
    }
    app.dependency_overrides.update(overrides)
    monkeypatch.setattr(door, "verify_google_identity", lambda credential: (credential, "Somebody"))
    try:
        yield TestClient(app, base_url="https://testserver")
    finally:
        for get in overrides:
            app.dependency_overrides.pop(get, None)


def _invitee(client: TestClient, teacher: str, email: str, deadline: str = "2099-01-10") -> str:
    """Collect the semester's preferences, invite the teacher, and sign in as them."""
    opened = client.put(f"{WISHES}/collection/{TERM}", json={"deadline": deadline})
    assert opened.status_code == status.HTTP_200_OK, opened.text
    made = client.post(f"{WISHES}/{TERM}/{teacher}/invitation", json={"email": email})
    assert made.status_code == status.HTTP_201_CREATED, made.text
    code = made.json()["code"]
    assert client.post(f"{DOOR}/{code}/session", json={"credential": email}).status_code == status.HTTP_200_OK
    return code


def _item(sheet: dict, kind: str) -> dict:
    return next(item for item in sheet["items"] if item["kind"] == kind)


def test_both_semesters_are_one_academic_year():
    assert year_of("262710") == year_of("262720") == "2026-2027"
    with pytest.raises(InvalidReductions):
        year_of("2026")


def test_full_time_is_the_departments_word_alone():
    assert full_time("FT")
    assert full_time(" ft ")
    assert not full_time("PT")
    # The portal's Full Time type covers language teachers and other departments' staff: not enough.
    assert not full_time("")


def test_a_full_timer_declares_research_and_reads_what_the_head_of_department_set(client: TestClient):
    # The Head of Department's own: one committee, and heading a department of over 200.
    set_ = client.put(
        f"{AT}/{YEAR}/{FT}", json={"items": {"committees": {"detail": ["budget"]}, "hod": {"detail": "hod-200"}}}
    )
    assert set_.status_code == status.HTTP_200_OK, set_.text
    code = _invitee(client, FT, "lama@example.com")

    form = client.get(f"{DOOR}/{code}/form").json()
    sheet = form["reductions"]
    assert (sheet["year"], sheet["service"], sheet["total"], sheet["owed"]) == (YEAR, 192, 45, 147)
    assert (_item(sheet, "hod")["hours"], _item(sheet, "hod")["state"]) == (42, "set")

    declared = client.put(
        f"{DOOR}/{code}/reductions",
        json={"items": {"phd": {"amount": 3}, "internships": {"amount": 30}}, "note": "Two theses defended in June."},
    )
    assert declared.status_code == status.HTTP_200_OK, declared.text
    sheet = declared.json()["reductions"]
    # 3 × 5 h, and 30 × 0.5 h held to its 10 h.
    assert (_item(sheet, "phd")["hours"], _item(sheet, "internships")["hours"]) == (15, 10)
    assert _item(sheet, "phd")["state"] == "declared"
    assert (sheet["total"], sheet["owed"], sheet["note"]) == (70, 122, "Two theses defended in June.")
    assert sheet["declaredAt"]

    # The department's own are not the teacher's to set.
    refused = client.put(f"{DOOR}/{code}/reductions", json={"items": {"new_joiner": {"amount": 1}}})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "Head of Department" in refused.json()["detail"]


def test_nobody_but_a_full_timer_is_asked(client: TestClient):
    code = _invitee(client, PT, "samar@example.com")

    assert client.get(f"{DOOR}/{code}/form").json()["reductions"] is None
    refused = client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 1}}})
    assert refused.status_code == status.HTTP_403_FORBIDDEN
    # Full Time on the portal, but not marked FT by the department: not asked either.
    portal = _invitee(client, PORTAL_FT, "portal@example.com")
    assert client.get(f"{DOOR}/{portal}/form").json()["reductions"] is None


def test_a_validated_reduction_the_teacher_changes_is_to_be_checked_again(client: TestClient):
    code = _invitee(client, FT, "lama@example.com")
    client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 2}}})
    validated = client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"phd": {"amount": 2, "validated": True}}}).json()
    assert _item(validated, "phd")["state"] == "validated"

    # Sent again as it was, it stays validated; changed, it is the teacher's word again.
    same = client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 2}}}).json()["reductions"]
    assert _item(same, "phd")["state"] == "validated"
    changed = client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 3}}}).json()["reductions"]
    assert _item(changed, "phd")["state"] == "declared"


def test_an_irg_project_shares_its_hours_over_three_years(client: TestClient):
    for year, hours in (("2024-2025", 40), ("2025-2026", 30)):
        assert client.put(f"{AT}/{year}/{FT}", json={"items": {"irg": {"amount": hours}}}).status_code == 200
    code = _invitee(client, FT, "lama@example.com")
    assert _item(client.get(f"{DOOR}/{code}/form").json()["reductions"], "irg")["available"] == 10

    too_much = client.put(f"{DOOR}/{code}/reductions", json={"items": {"irg": {"amount": 20}}})
    assert too_much.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "10 h are left" in too_much.json()["detail"]
    assert client.put(f"{DOOR}/{code}/reductions", json={"items": {"irg": {"amount": 10}}}).status_code == 200


def test_after_the_deadline_the_declaration_is_closed(client: TestClient):
    code = _invitee(client, FT, "lama@example.com", deadline="2020-01-01")

    closed = client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 1}}})
    assert closed.status_code == status.HTTP_409_CONFLICT


def test_the_year_lists_every_full_timer_and_only_the_head_or_an_administrator_changes_it(
    client: TestClient, store: HourReductions, monkeypatch: pytest.MonkeyPatch
):
    with store.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO department_roles (role, active_teacher_id, updated_at, updated_by)
                    VALUES ('head_of_department', :id, 'x', 'x')"""),
            {"id": FT},
        )
    held = client.get(AT, params={"term": "262720"}).json()
    assert held["year"] == YEAR and held["canChange"] is True
    listed = {row["teacherId"]: row for row in held["teachers"] if row["teacherId"].startswith("reduce-test-")}
    # The department's FT alone: not the portal's Full Time it has not marked, not a part-timer.
    assert set(listed) == {FT}
    assert listed[FT]["head"] is True

    monkeypatch.setattr(
        auth_gate, "user_for_request", lambda *_args, **_kwargs: StaffUser(email="c@x.ae", name="C", is_admin=False)
    )
    refused = client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"accreditation": {"amount": 1}}})
    assert refused.status_code == status.HTTP_403_FORBIDDEN
    assert client.get(AT, params={"year": YEAR}).json()["canChange"] is False

    # The Head of Department named in Settings sets the reductions, without being an administrator.
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="Lama.Tarsissi@sorbonne.ae", name="Lama", is_admin=False),
    )
    seen = client.get(AT, params={"year": YEAR}).json()
    assert (seen["canChange"], seen["canChangeRules"]) == (True, False)
    assert client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"accreditation": {"amount": 1}}}).status_code == 200
    # The rules every reduction is worked out from stay an administrator's.
    assert client.put(f"{AT}/rules", json={"service": 180}).status_code == status.HTTP_403_FORBIDDEN


def test_an_admin_of_students_and_timetables_sets_the_reductions_but_not_the_rules(
    client: TestClient, store: HourReductions, monkeypatch: pytest.MonkeyPatch
):
    """Lama Tarsissi was admin of Students and Timetables and named Head of Department, and still
    could not change a figure (16 Nov 2026): she signs in with another address than her record's."""
    signed_in = "st-admin@example.com"
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM account_apps WHERE email = :email"), {"email": signed_in})
        connection.execute(
            text("INSERT INTO account_apps (email, app, role) VALUES (:email, 'database', 'admin')"),
            {"email": signed_in},
        )
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email=signed_in, name="Lama", is_admin=False),
    )
    try:
        seen = client.get(AT, params={"year": YEAR}).json()
        assert (seen["canChange"], seen["canChangeRules"]) == (True, False)
        changed = client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"accreditation": {"amount": 1}}})
        assert changed.status_code == 200
        assert client.put(f"{AT}/rules", json={"service": 180}).status_code == status.HTTP_403_FORBIDDEN

        # A member of Students and Timetables reads, as everybody does.
        with store.engine.begin() as connection:
            connection.execute(
                text("UPDATE account_apps SET role = 'member' WHERE email = :email"), {"email": signed_in}
            )
        assert client.get(AT, params={"year": YEAR}).json()["canChange"] is False
        refused = client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"accreditation": {"amount": 0}}})
        assert refused.status_code == status.HTTP_403_FORBIDDEN
        assert "Students and Timetables" in refused.json()["detail"]

        # An admin of another app is not one of Students and Timetables.
        with store.engine.begin() as connection:
            connection.execute(
                text("UPDATE account_apps SET app = 'syllabus', role = 'admin' WHERE email = :email"),
                {"email": signed_in},
            )
        assert client.get(AT, params={"year": YEAR}).json()["canChange"] is False
    finally:
        with store.engine.begin() as connection:
            connection.execute(text("DELETE FROM account_apps WHERE email = :email"), {"email": signed_in})


def test_an_administrator_adjusts_the_rules_and_every_total_follows(client: TestClient):
    code = _invitee(client, FT, "lama@example.com")
    client.put(f"{DOOR}/{code}/reductions", json={"items": {"phd": {"amount": 3}}})

    changed = client.put(f"{AT}/rules", json={"service": 180, "rules": {"phd": {"per": 6, "cap": 24}}})
    assert changed.status_code == status.HTTP_200_OK, changed.text
    phd = next(rule for rule in changed.json()["rules"] if rule["kind"] == "phd")
    assert phd["rule"].startswith("6 h for each PhD student")

    sheet = client.get(f"{DOOR}/{code}/form").json()["reductions"]
    assert (_item(sheet, "phd")["hours"], sheet["service"], sheet["owed"]) == (18, 180, 162)


def test_an_administrator_names_adds_and_takes_away_the_options_of_a_headship(client: TestClient):
    # Lama heads a Foundation Year of over 200 students.
    assert client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"hop": {"detail": "foundation-200"}}}).status_code == 200
    hop = next(rule for rule in client.get(f"{AT}/rules").json()["rules"] if rule["kind"] == "hop")
    options = [{**option} for option in hop["options"]]

    # Renamed, its hours changed, one taken away nobody has, and one added.
    for option in options:
        if option["key"] == "foundation-200":
            option.update(label="Foundation Year, 200 to 500 students", hours=36)
    options = [option for option in options if option["key"] != "master"]
    options.append({"label": "Data Science programme", "hours": 24})
    saved = client.put(f"{AT}/rules", json={"rules": {"hop": {"options": options}}})
    assert saved.status_code == status.HTTP_200_OK, saved.text
    hop = next(rule for rule in saved.json()["rules"] if rule["kind"] == "hop")
    assert [option["key"] for option in hop["options"]] == [
        "bachelor",
        "foundation",
        "foundation-200",
        "foundation-500",
        "data-science-programme",
    ]
    assert "Data Science programme: 24 h" in hop["rule"]

    # Lama keeps hers under its new name and hours; the new option can be given.
    sheet = client.get(AT, params={"year": YEAR}).json()["teachers"][0]
    assert (_item(sheet, "hop")["detail"], _item(sheet, "hop")["hours"]) == ("foundation-200", 36)
    given = client.put(f"{AT}/{YEAR}/{FT}", json={"items": {"hop": {"detail": "data-science-programme"}}})
    assert _item(given.json(), "hop")["hours"] == 24

    # An option a teacher has cannot be taken away until nobody has it.
    kept = [option for option in hop["options"] if option["key"] != "data-science-programme"]
    refused = client.put(f"{AT}/rules", json={"rules": {"hop": {"options": kept}}})
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "1 teacher has Data Science programme" in refused.json()["detail"]

    # Every option needs a name, once; and a call about the service alone keeps the options.
    nameless = client.put(f"{AT}/rules", json={"rules": {"hop": {"options": [{"label": " ", "hours": 3}]}}})
    assert nameless.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    twice = [{"label": "Bachelor's programme", "hours": 32}, {"label": "bachelor's programme", "hours": 32}]
    assert "twice" in client.put(f"{AT}/rules", json={"rules": {"hop": {"options": twice}}}).json()["detail"]
    client.put(f"{AT}/rules", json={"service": 190})
    hop = next(rule for rule in client.get(f"{AT}/rules").json()["rules"] if rule["kind"] == "hop")
    assert "data-science-programme" in [option["key"] for option in hop["options"]]
