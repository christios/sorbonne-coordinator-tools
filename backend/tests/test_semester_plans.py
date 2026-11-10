"""A semester planned on a calendar before the registrar books it."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import semester_plans as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.semester_plans import PlanStore, teaching_mondays
from sorbonne.services.staff_auth import StaffUser
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/plans"
TERM = "262720"


SEMESTER = f"plan:{TERM}"


class Groups:
    """Groups & CRNs for the plan's semester, written the way that page keeps it."""

    def __init__(self, store: PlanStore) -> None:
        self.engine = store.engine

    def _insert(self, table: str, **values: object) -> str:
        columns = ", ".join(values)
        marks = ", ".join(f":{key}" for key in values)
        with self.engine.begin() as connection:
            connection.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({marks})"), values)  # noqa: S608
        return str(values.get("id", ""))

    def cohort(self, name: str) -> str:
        return self._insert(
            "student_cohorts", id=f"plan-test-{name}", name=name, created_at="2026-11-05", updated_at="2026-11-05"
        )

    def set(self, cohort: str, code: str, **fields: object) -> str:
        return self._insert(
            "cohort_scopes", id=f"{cohort}-{code}", cohort_id=cohort, code=code, term_id=SEMESTER, **fields
        )

    def course(self, scope: str, code: str, name: str = "", component: str = "", **fields: object) -> str:
        return self._insert(
            "scope_courses", id=f"{scope}-{code}", scope_id=scope, code=code, name=name, component=component, **fields
        )

    def group(self, scope: str, label: str, **fields: object) -> str:
        return self._insert("scope_groups", id=f"{scope}-g{label}", scope_id=scope, label=label, **fields)

    def major(self, group: str, program: str) -> str:
        return self._insert("group_majors", id=f"{group}-{program}", group_id=group, program=program)

    def cell(self, group: str, course: str, crn: str = "", **fields: object) -> None:
        self._insert("group_crns", group_id=group, course_id=course, crn=crn, **fields)

    def change(self, sql: str, **values: object) -> None:
        with self.engine.begin() as connection:
            connection.execute(text(sql), values)


@pytest.fixture
def plans() -> PlanStore:
    store = PlanStore(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM plan_terms"))
        connection.execute(text("DELETE FROM term_links WHERE term_id LIKE 'plan:%'"))
        connection.execute(text("DELETE FROM term_weeks WHERE term_id LIKE 'plan:%'"))
        connection.execute(text("DELETE FROM student_cohorts WHERE id LIKE 'plan-test-%'"))
    return store


@pytest.fixture
def groups(plans: PlanStore) -> Groups:
    return Groups(plans)


@pytest.fixture
def client(plans: PlanStore) -> TestClient:
    app.dependency_overrides[api.get_plans] = lambda: plans
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_plans, None)


@pytest.fixture
def section(client: TestClient, groups: Groups) -> dict:
    """Second semester 2026-27: Week 1 is 11 January 2027, the week of 15 February is a break.

    Foundation Year's lecture group A is taught Elements of Calculus, CRN 22229, by Bilal Maaz.
    """
    assert client.post(AT, json={"termCode": TERM, "name": "Semester 2 2026-27"}).status_code == 201
    settled = client.put(
        f"{AT}/{TERM}/settings",
        json={
            "name": "Semester 2 2026-27",
            "weekOne": "2027-01-13",
            "weeks": 14,
            "without": ["2027-02-17"],
            "holidays": [{"date": "2027-01-19", "label": "A holiday"}],
        },
    )
    assert settled.status_code == 200, settled.text
    fys = groups.cohort("FYS-S2")
    lectures = groups.set(fys, "CM")
    calculus = groups.course(lectures, "math-002", "Elements of Calculus", "CM")
    groups.cell(groups.group(lectures, "A"), calculus, "22229", teacher="Bilal Maaz", hours="60", duration="1.5")
    return next(each for each in client.get(f"{AT}/{TERM}").json()["sections"] if each["crn"] == "22229")


def place(client: TestClient, section: dict, **fields) -> dict:
    body = {
        "sectionId": section["id"],
        "weekday": 2,
        "startsAt": "08:30",
        "endsAt": "10:00",
        "room": "5.111",
        "weeks": [1, 2, 3],
        **fields,
    }
    made = client.post(f"{AT}/{TERM}/series", json=body)
    assert made.status_code == 201, made.text
    return made.json()


def classes(client: TestClient) -> list[tuple[str, str, str]]:
    plan = client.get(f"{AT}/{TERM}").json()
    return [(entry["meetsOn"], entry["startsAt"], entry["room"]) for entry in plan["classes"]]


def test_teaching_weeks_count_from_the_week_of_week_one_and_skip_the_breaks():
    mondays = teaching_mondays("2027-01-13", ["2027-02-15"], 14)
    assert mondays[1].isoformat() == "2027-01-11"
    assert mondays[5].isoformat() == "2027-02-08"
    # The break week takes no number: Week 6 is the week after it.
    assert mondays[6].isoformat() == "2027-02-22"


def test_a_series_is_dated_from_the_semesters_weeks_and_a_holiday_takes_its_class_away(client, section):
    place(client, section)
    plan = client.get(f"{AT}/{TERM}").json()
    assert [entry["meetsOn"] for entry in plan["classes"]] == ["2027-01-12", "2027-01-26"]
    assert [(entry["meetsOn"], entry["holiday"]) for entry in plan["skipped"]] == [("2027-01-19", "A holiday")]
    # The section's own teacher, since the series names nobody else.
    assert {entry["teacherName"] for entry in plan["classes"]} == {"Bilal Maaz"}
    assert plan["sections"][0]["courseCode"] == "MATH-002"


def test_moving_week_one_moves_every_class(client, section):
    place(client, section, weeks=[1])
    settled = client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "2027-01-20", "weeks": 14})
    assert settled.json()["classes"][0]["meetsOn"] == "2027-01-19"


def test_one_class_of_a_series_moves_on_its_own_and_moving_it_back_undoes_it(client, section):
    series = place(client, section)
    moved = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 3, "revision": series["revision"], "changes": {"weekday": 4, "room": "5.104"}},
    )
    assert moved.status_code == 200, moved.text
    assert classes(client) == [("2027-01-12", "08:30", "5.111"), ("2027-01-28", "08:30", "5.104")]
    assert client.get(f"{AT}/{TERM}").json()["classes"][1]["moved"] is True

    back = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={
            "scope": "one",
            "week": 3,
            "revision": moved.json()["revision"],
            "changes": {"weekday": 2, "room": "5.111"},
        },
    )
    assert back.json()["moves"] == []


def test_this_and_following_cuts_the_series_in_two(client, section):
    series = place(client, section, weeks=[1, 2, 3, 4, 5])
    client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 4, "revision": 1, "changes": {"room": "4.021"}},
    )
    later = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "following", "week": 3, "revision": 2, "changes": {"startsAt": "10:15", "endsAt": "11:45"}},
    )
    assert later.status_code == 200, later.text
    assert later.json()["weeks"] == [3, 4, 5]
    plan = client.get(f"{AT}/{TERM}").json()
    assert sorted(each["weeks"] for each in plan["series"]) == [[1, 2], [3, 4, 5]]
    # The week moved on its own was in the part that changed, so it follows the change.
    assert [entry["room"] for entry in plan["classes"] if entry["week"] == 4] == ["5.111"]
    assert [entry["startsAt"] for entry in plan["classes"]] == ["08:30", "10:15", "10:15", "10:15"]


def test_changing_the_whole_series_puts_the_weeks_moved_on_their_own_back_in_line(client, section):
    series = place(client, section)
    client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "one", "week": 2, "revision": 1, "changes": {"weekday": 3}},
    )
    every = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 2, "changes": {"weekday": 5}},
    )
    assert every.json()["moves"] == []
    assert {entry["weekday"] for entry in client.get(f"{AT}/{TERM}").json()["classes"]} == {5}


def test_a_change_made_against_an_old_revision_is_refused_and_says_so(client, section):
    series = place(client, section)
    first = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 1, "changes": {"room": "5.104"}},
    )
    assert first.status_code == 200
    late = client.patch(
        f"{AT}/{TERM}/series/{series['id']}",
        json={"scope": "all", "revision": 1, "changes": {"room": "4.021"}},
    )
    assert late.status_code == status.HTTP_409_CONFLICT
    assert "since you opened it" in late.json()["detail"]


def test_deleting_one_the_following_or_all_classes(client, section):
    series = place(client, section, weeks=[1, 2, 3, 4])
    path = f"{AT}/{TERM}/series/{series['id']}"
    assert client.delete(path, params={"scope": "one", "week": 2, "revision": 1}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"][0]["weeks"] == [1, 3, 4]
    assert client.delete(path, params={"scope": "following", "week": 3, "revision": 2}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"][0]["weeks"] == [1]
    assert client.delete(path, params={"scope": "all", "revision": 3}).status_code == 204
    assert client.get(f"{AT}/{TERM}").json()["series"] == []


def test_a_class_is_checked_before_it_is_placed(client, section):
    refused = client.post(
        f"{AT}/{TERM}/series",
        json={"sectionId": section["id"], "weekday": 2, "startsAt": "10:00", "endsAt": "09:00", "weeks": [1]},
    )
    assert refused.status_code == 422
    assert "ends after it starts" in refused.json()["detail"]
    beyond = client.post(
        f"{AT}/{TERM}/series",
        json={"sectionId": section["id"], "weekday": 2, "startsAt": "08:30", "endsAt": "10:00", "weeks": [15]},
    )
    assert "teaching weeks are 1 to 14" in beyond.json()["detail"]


def test_the_classes_to_place_are_each_group_of_a_set_taught_each_of_its_courses(client, groups, section):
    l2 = groups.cohort("L2-S2")
    tutorials = groups.set(l2, "TD")
    algebra = groups.course(tutorials, "MATH-224", "Algebra 2", "TD", hours="30")
    waves = groups.course(tutorials, "PHYS-213", "Waves", "TD")
    maths = groups.group(tutorials, "Mathematics")
    physics = groups.group(tutorials, "Physics")
    # The mathematicians are not taught Waves; the physicists' Algebra is handed over halfway.
    groups.cell(maths, waves, not_taught=True, major_id=groups.major(maths, "MATH"))
    groups.cell(physics, algebra, "24001", teacher="Samar Ghantous", part=1)
    groups.cell(physics, algebra, "24002", teacher="Rana Shabaneh", part=2)
    groups.cell(physics, waves, "24003", retired=True)

    plan = client.get(f"{AT}/{TERM}").json()
    l2_classes = [
        (each["courseCode"], each["groupLabel"], each["crn"], each["teacherName"], each["hours"], each["programmes"])
        for each in plan["sections"]
        if each["programmes"] == ["L2-S2"]
    ]
    assert l2_classes == [
        # A class before it has a CRN, with the hours its course asks for.
        ("MATH-224", "TD Mathematics", "", "", 30.0, ["L2-S2"]),
        # Each half of a handed-over section, with its own CRN and teacher.
        ("MATH-224", "TD Physics", "24001", "Samar Ghantous", 30.0, ["L2-S2"]),
        ("MATH-224", "TD Physics", "24002", "Rana Shabaneh", 30.0, ["L2-S2"]),
    ]
    # Each class says whose majors it is for: the sub-rows it teaches.
    maths_algebra = next(each for each in plan["sections"] if each["groupLabel"] == "TD Mathematics")
    assert maths_algebra["places"][0]["majors"] == ["MATH"]
    # Read again, nothing is added twice.
    assert len(client.get(f"{AT}/{TERM}").json()["sections"]) == len(plan["sections"])
    calculus = next(each for each in plan["sections"] if each["crn"] == "22229")
    assert (calculus["teacherName"], calculus["hours"], calculus["duration"]) == ("Bilal Maaz", 60.0, "1.5")


def test_one_crn_carried_by_two_cohorts_is_one_class_taught_to_both(client, groups, section):
    l1 = groups.cohort("L1-S2")
    lectures = groups.set(l1, "CM")
    calculus = groups.course(lectures, "MATH-002", "Elements of Calculus", "CM")
    groups.cell(groups.group(lectures, "1"), calculus, "22229")
    shared = [each for each in client.get(f"{AT}/{TERM}").json()["sections"] if each["crn"] == "22229"]
    assert len(shared) == 1
    assert shared[0]["programmes"] == ["FYS-S2", "L1-S2"]
    assert [place["cohort"] for place in shared[0]["places"]] == ["FYS-S2", "L1-S2"]


def test_a_crn_entered_later_keeps_the_class_where_it_was_placed(client, groups, section):
    l3 = groups.cohort("L3-S2")
    lab = groups.set(l3, "TP")
    optics = groups.course(lab, "PHYS-310", "Optics", "TP")
    group = groups.group(lab, "1")
    waiting = next(each for each in client.get(f"{AT}/{TERM}").json()["sections"] if each["courseCode"] == "PHYS-310")
    place(client, waiting)
    groups.cell(group, optics, "24500", teacher="Ahmed Menaa")
    plan = client.get(f"{AT}/{TERM}").json()
    now = next(each for each in plan["sections"] if each["courseCode"] == "PHYS-310")
    assert (now["id"], now["crn"], now["teacherName"]) == (waiting["id"], "24500", "Ahmed Menaa")
    assert {entry["sectionId"] for entry in plan["classes"]} >= {waiting["id"]}


def test_the_semester_cannot_end_before_a_week_classes_are_planned_in(client, section):
    place(client, section, weeks=[12])
    shorter = client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "2027-01-13", "weeks": 10})
    assert shorter.status_code == 422
    assert "week 12" in shorter.json()["detail"]


def test_a_class_no_longer_on_groups_and_crns_leaves_or_waits_to_be_taken_off(client, groups, section):
    fys = "plan-test-FYS-S2"
    tutorials = groups.set(fys, "TD")
    groups.course(tutorials, "MATH-006", "Calculus tutorials", "TD")
    groups.group(tutorials, "1")
    assert len(client.get(f"{AT}/{TERM}").json()["sections"]) == 2
    # Still on Groups & CRNs, it is not the plan's to take off.
    refused = client.delete(f"{AT}/{TERM}/sections/{section['id']}")
    assert refused.status_code == 422

    place(client, section)
    groups.change("DELETE FROM cohort_scopes WHERE cohort_id = :c", c=fys)
    plan = client.get(f"{AT}/{TERM}").json()
    # Never placed: gone with it. Placed: kept, said to be gone, and not placed again.
    assert [(each["crn"], each["gone"]) for each in plan["sections"]] == [("22229", True)]
    assert len(plan["classes"]) == 2
    again = client.post(
        f"{AT}/{TERM}/series",
        json={"sectionId": section["id"], "weekday": 3, "startsAt": "08:30", "endsAt": "10:00", "weeks": [4]},
    )
    assert "no longer on Groups & CRNs" in again.json()["detail"]
    assert client.delete(f"{AT}/{TERM}/sections/{section['id']}").status_code == 204
    plan = client.get(f"{AT}/{TERM}").json()
    assert plan["sections"] == [] and plan["series"] == [] and plan["classes"] == []


def test_a_plan_is_a_semester_of_the_app_linked_to_its_portal_term_with_its_weeks(client, plans, section):
    plan = client.get(f"{AT}/{TERM}").json()
    assert plan["semesterId"] == "plan:262720"
    with plans.engine.connect() as connection:
        link = connection.execute(
            text("SELECT portal_term_code FROM term_links WHERE term_id = 'plan:262720'")
        ).scalar()
        weeks = connection.execute(
            text("SELECT week_one, without FROM term_weeks WHERE term_id = 'plan:262720'")
        ).one()
    # Linked, so its cohorts' sets can be added and checked against the registrar…
    assert link == TERM
    # …and counted in the plan's weeks wherever the app says "Week 5".
    assert weeks[0] == "2027-01-13"
    assert weeks[1] == '["2027-02-15"]'

    client.put(f"{AT}/{TERM}/settings", json={"name": "S2", "weekOne": "", "weeks": 14})
    with plans.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM term_weeks WHERE term_id = 'plan:262720'")).scalar() == 0


def test_a_semester_made_here_is_deleted_with_its_classes_once_no_cohort_has_anything_in_it(client, plans, section):
    place(client, section)
    # The set FYS-S2 holds there keeps it.
    refused = client.delete(f"{AT}/{TERM}")
    assert refused.status_code == 422
    assert refused.json()["detail"] == (
        "Semester 2 2026-27 holds 1 set. Take them out of it on Group schema and Cohorts before deleting it."
    )

    with plans.engine.begin() as connection:
        connection.execute(text("DELETE FROM cohort_scopes WHERE term_id = :t"), {"t": SEMESTER})
        connection.execute(
            text("INSERT INTO semester_short_names (term_id, short_name) VALUES (:t, 'S2')"), {"t": SEMESTER}
        )
    assert client.delete(f"{AT}/{TERM}").status_code == 204

    assert client.get(f"{AT}/{TERM}").status_code == 404
    assert client.get(AT).json()["plans"] == []
    with plans.engine.connect() as connection:
        for table in ("term_links", "term_weeks", "semester_short_names", "plan_series"):
            column = "term_code" if table == "plan_series" else "term_id"
            held = connection.execute(
                text(f"SELECT count(*) FROM {table} WHERE {column} = :t"),  # noqa: S608 - fixed names
                {"t": TERM if table == "plan_series" else SEMESTER},
            ).scalar()
            assert held == 0, table


HUB = "plan-test-hub-s1"
AUTUMN = "262710"


@pytest.fixture
def hub_semester(plans: PlanStore, groups: Groups):
    """Semester 1 as the Student Hub held it: linked to 262710, its weeks, pay day, short name, a set and a student."""
    with plans.engine.begin() as connection:
        for table in ("term_links", "term_weeks", "term_pay_cycles", "semester_short_names"):
            connection.execute(
                text(f"DELETE FROM {table} WHERE term_id IN (:hub, :new)"),  # noqa: S608 - fixed names
                {"hub": HUB, "new": f"plan:{AUTUMN}"},
            )
        connection.execute(
            text("INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, :c)"), {"t": HUB, "c": AUTUMN}
        )
        connection.execute(
            text("""INSERT INTO term_weeks (term_id, week_one, without) VALUES (:t, '2026-08-31', '["2026-10-12"]')"""),
            {"t": HUB},
        )
        connection.execute(
            text("INSERT INTO term_pay_cycles (term_id, opens_on, updated_at) VALUES (:t, 20, now())"), {"t": HUB}
        )
        connection.execute(text("INSERT INTO semester_short_names (term_id, short_name) VALUES (:t, 'S1')"), {"t": HUB})
    l1 = groups.cohort("L1")
    groups._insert("cohort_scopes", id=f"{l1}-TD", cohort_id=l1, code="TD", term_id=HUB)
    with plans.engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO students (student_id, status, first_seen_at, last_seen_at, updated_at)
                    VALUES ('PLANTEST1', 'in_portal', 'now', 'now', 'now') ON CONFLICT (student_id) DO NOTHING""")
        )
        connection.execute(
            text("INSERT INTO cohort_members (cohort_id, term_id, student_id) VALUES (:c, :t, 'PLANTEST1')"),
            {"c": l1, "t": HUB},
        )
    yield HUB
    with plans.engine.begin() as connection:
        for table in ("term_links", "term_weeks", "term_pay_cycles", "semester_short_names"):
            connection.execute(
                text(f"DELETE FROM {table} WHERE term_id IN (:hub, :new)"),  # noqa: S608 - fixed names
                {"hub": HUB, "new": f"plan:{AUTUMN}"},
            )
        connection.execute(text("DELETE FROM student_cohorts WHERE id LIKE 'plan-test-%'"))
        connection.execute(text("DELETE FROM students WHERE student_id = 'PLANTEST1'"))


def test_a_semester_from_the_student_hub_is_moved_into_coordinator_tools_with_everything_kept_about_it(
    client, plans, hub_semester
):
    moved = client.post(f"{AT}/adopt", json={"termId": hub_semester, "name": "Semester 1 2026-27"})
    assert moved.status_code == 201, moved.text
    plan = moved.json()
    assert (plan["semesterId"], plan["name"]) == ("plan:262710", "Semester 1 2026-27")
    # Week 1 and its breaks come with it; how many teaching weeks it has is left to be said.
    assert (plan["weekOne"], plan["without"], plan["weeks"]) == ("2026-08-31", ["2026-10-12"], 0)

    with plans.engine.connect() as connection:
        for table in PlanStore._FILED_BY_SEMESTER:
            count = f"SELECT count(*) FROM {table} WHERE term_id = :t"  # noqa: S608 - fixed names
            left = connection.execute(text(count), {"t": hub_semester}).scalar()
            here = connection.execute(text(count), {"t": "plan:262710"}).scalar()
            assert (table, left, here) == (table, 0, 1)
        link = "SELECT portal_term_code FROM term_links WHERE term_id = 'plan:262710'"
        assert connection.execute(text(link)).scalar() == AUTUMN

    # Once moved it is made here, and is not moved twice.
    again = client.post(f"{AT}/adopt", json={"termId": hub_semester, "name": "Semester 1 2026-27"})
    assert again.status_code == 422
    assert client.post(f"{AT}/adopt", json={"termId": "plan:262710"}).status_code == 422


def test_a_new_semester_is_refused_a_portal_term_a_hub_semester_goes_by(client, hub_semester):
    refused = client.post(AT, json={"termCode": AUTUMN, "name": "Semester 1 again"})
    assert refused.status_code == 422
    assert refused.json()["detail"] == "Another semester is 262710 already."


def test_only_an_administrator_moves_a_semester_into_coordinator_tools(client, hub_semester, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )
    assert client.post(f"{AT}/adopt", json={"termId": hub_semester, "name": "S1"}).status_code == 403


def test_a_class_names_its_teacher_by_record_when_one_was_chosen(client: TestClient, groups: Groups):
    """What a teacher's wishes follow: the Active teachers record, not a name that may be spelled twice."""
    groups.change("DELETE FROM active_teachers WHERE id IN ('plan-test-lama', 'plan-test-omar')")
    groups.change(
        """INSERT INTO active_teachers (id, full_name, added_at)
           VALUES ('plan-test-lama', 'Lama Tarsissi', 'x'), ('plan-test-omar', 'Omar ElDakkak', 'x')"""
    )
    assert client.post(AT, json={"termCode": TERM, "name": "Semester 2 2026-27"}).status_code == 201
    lectures = groups.set(groups.cohort("L1-T"), "CM")
    analysis = groups.course(lectures, "math-160", "Analysis", "CM")
    groups.cell(groups.group(lectures, "1"), analysis, "30001", teacher_id="plan-test-lama")
    groups.cell(groups.group(lectures, "2"), analysis, "30002", teacher="Somebody Typed")
    # The registrar's spelling beside the record of the same person.
    groups.cell(groups.group(lectures, "3"), analysis, "30003", teacher="Omar El Dakkak", teacher_id="plan-test-omar")
    # One person named, another's record chosen: the plan shows the name, so wishes follow it.
    groups.cell(groups.group(lectures, "4"), analysis, "30004", teacher="Lama Tarsissi", teacher_id="plan-test-omar")

    sections = {each["crn"]: each for each in client.get(f"{AT}/{TERM}").json()["sections"]}
    assert (sections["30001"]["teacherName"], sections["30001"]["teacherId"]) == ("Lama Tarsissi", "plan-test-lama")
    # Typed on the row, and nobody in Active teachers goes by it: a name, nobody's record.
    assert (sections["30002"]["teacherName"], sections["30002"]["teacherId"]) == ("Somebody Typed", "")
    assert (sections["30003"]["teacherName"], sections["30003"]["teacherId"]) == ("Omar El Dakkak", "plan-test-omar")
    assert (sections["30004"]["teacherName"], sections["30004"]["teacherId"]) == ("Lama Tarsissi", "plan-test-lama")
    groups.change("DELETE FROM active_teachers WHERE id IN ('plan-test-lama', 'plan-test-omar')")


def test_a_period_binding_everybody_is_kept_beside_the_holidays(client: TestClient):
    assert client.post(AT, json={"termCode": TERM, "name": "Semester 2 2026-27"}).status_code == 201
    ramadan = {"label": "Ramadan", "from": "2027-02-08", "to": "2027-03-09", "blockFrom": "15:00", "blockTo": "19:00"}
    settled = client.put(f"{AT}/{TERM}/settings", json={"name": "Semester 2 2026-27", "periods": [ramadan]})
    assert settled.status_code == 200, settled.text
    assert settled.json()["periods"] == [{**ramadan, "days": [1, 2, 3, 4, 5, 6, 7]}]
    # A page that does not edit periods leaves them be.
    again = client.put(f"{AT}/{TERM}/settings", json={"name": "Semester 2 2026-27", "weeks": 14}).json()
    assert [period["label"] for period in again["periods"]] == ["Ramadan"]
    # Hours with no classes are a stretch of the day, earliest first.
    backwards = client.put(
        f"{AT}/{TERM}/settings",
        json={"name": "Semester 2 2026-27", "periods": [{**ramadan, "blockFrom": "19:00", "blockTo": "15:00"}]},
    )
    assert backwards.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
