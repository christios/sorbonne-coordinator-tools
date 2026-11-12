"""The department's programmes — Settings → Programmes: names, codes, course codes, courses."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import course_programs as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.course_programs import CoursePrograms
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/course-programs"


@pytest.fixture
def programs() -> CoursePrograms:
    store = CoursePrograms(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        for table in (
            "course_programs",
            "programme_course_prefixes",
            "programme_names",
            "programme_codes",
            "student_cohorts",
        ):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608
    return store


def cohort(programs: CoursePrograms, identifier: str, majors: str) -> None:
    with programs.engine.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO student_cohorts (id, name, term, major_codes, created_at, updated_at)
                   VALUES (:id, :id, '2026-27', :majors, '', '')"""
            ),
            {"id": identifier, "majors": majors},
        )


@pytest.fixture
def client(programs: CoursePrograms) -> TestClient:
    app.dependency_overrides[api.get_programs] = lambda: programs
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_programs, None)


def test_the_programmes_are_the_students_with_a_recode_filed_under_the_code_it_means(
    client: TestClient, programs: CoursePrograms
):
    # A new department, with no cohort yet: no programme, nothing to narrow to.
    assert client.get(AT).json() == {"programmes": [], "courses": {}}

    cohort(programs, "l1", '["MATH - Mathematics", "PHYS - Physics"]')
    cohort(programs, "l2", '["MATS", "PHYS"]')
    with programs.engine.begin() as connection:
        connection.execute(text("INSERT INTO programme_codes (code, same_as) VALUES ('MATS', 'MATH')"))

    state = client.get(AT).json()
    # MATS is MATH's students, so it is not a programme of its own: it is a code MATH is written as.
    assert state["programmes"] == [
        {
            "code": "MATH",
            "name": "Mathematics",
            "officialName": "",
            "registrarName": "Mathematics",
            "aliases": ["MATS"],
            "prefixes": [],
        },
        {
            "code": "PHYS",
            "name": "Physics",
            "officialName": "",
            "registrarName": "Physics",
            "aliases": [],
            "prefixes": [],
        },
    ]


def test_a_programme_has_the_official_name_the_department_writes(client: TestClient, programs: CoursePrograms):
    cohort(programs, "l1", '["MATH - Mathematics"]')

    state = client.put(
        f"{AT}/programmes/math/name", json={"officialName": "  Bachelor of Science in  Mathematics "}
    ).json()
    [maths] = state["programmes"]
    # Kept beside the registrar's short name, which the filters go on using.
    assert (maths["name"], maths["officialName"], maths["registrarName"]) == (
        "Mathematics",
        "Bachelor of Science in Mathematics",
        "Mathematics",
    )
    cleared = client.put(f"{AT}/programmes/MATH/name", json={"officialName": ""}).json()
    assert cleared["programmes"][0]["officialName"] == ""
    assert client.put(f"{AT}/programmes/CHEM/name", json={"officialName": "Chemistry"}).status_code == 422


def test_course_codes_are_grouped_under_a_programme_and_one_course_put_by_hand(
    client: TestClient, programs: CoursePrograms
):
    cohort(programs, "l1", '["MATH - Mathematics", "PHYS - Physics"]')

    client.put(f"{AT}/programmes/MATH", json={"prefixes": ["math", " CPSC- "]})
    state = client.put(f"{AT}/programmes/phys", json={"prefixes": ["PHYS"]}).json()
    # One prefix a row, read in order.
    assert [(entry["code"], entry["prefixes"]) for entry in state["programmes"]] == [
        ("MATH", ["CPSC", "MATH"]),
        ("PHYS", ["PHYS"]),
    ]
    # Taken off a programme, a prefix is free for another.
    client.put(f"{AT}/programmes/MATH", json={"prefixes": ["MATH"]})
    state = client.put(f"{AT}/programmes/PHYS", json={"prefixes": ["PHYS", "CPSC"]}).json()
    assert [entry["prefixes"] for entry in state["programmes"]] == [["MATH"], ["CPSC", "PHYS"]]

    # A code counts as one programme only, and only the department's programmes have codes.
    taken = client.put(f"{AT}/programmes/MATH", json={"prefixes": ["MATH", "CPSC"]})
    assert taken.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert taken.json()["detail"] == "CPSC already counts as PHYS."
    assert client.put(f"{AT}/programmes/CHEM", json={"prefixes": ["CHEM"]}).status_code == 422
    assert client.put(f"{AT}/programmes/MATH", json={"prefixes": ["MA TH"]}).status_code == 422

    # The Foundation Year's Mathematics Readiness, with MATH; Philosophy of AI, with none.
    client.put(f"{AT}/courses/scen-102", json={"programme": "math"})
    state = client.put(f"{AT}/courses/MATH-113", json={"programme": "NONE"}).json()
    assert state["courses"] == {"MATH-113": "NONE", "SCEN-102": "MATH"}
    assert client.put(f"{AT}/courses/SCEN-101", json={"programme": "CHEM"}).status_code == 422
    assert client.delete(f"{AT}/courses/MATH-113").json()["courses"] == {"SCEN-102": "MATH"}


def test_only_an_administrator_changes_them_and_anybody_reads_them(
    client: TestClient, programs: CoursePrograms, monkeypatch
):
    cohort(programs, "l1", '["MATH - Mathematics"]')
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    assert client.get(AT).status_code == status.HTTP_200_OK
    assert client.put(f"{AT}/programmes/MATH", json={"prefixes": ["MATH"]}).status_code == status.HTTP_403_FORBIDDEN
    assert client.put(f"{AT}/courses/SCEN-102", json={"programme": "MATH"}).status_code == status.HTTP_403_FORBIDDEN
    assert client.delete(f"{AT}/courses/SCEN-102").status_code == status.HTTP_403_FORBIDDEN
    assert client.put(f"{AT}/programmes/MATH/name", json={"officialName": "X"}).status_code == status.HTTP_403_FORBIDDEN
