"""Programme codes the department treats as one — "MATS means MATH".

Admissions recoded L2's Mathematics from MATH to MATS in September 2026. Everything that
decides who is taught with whom compares programme codes, so the department needs one
place to say two codes are the same students, kept by an administrator in Settings.
"""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import programme_codes as api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.enrolment_resolution import program_code
from sorbonne.services.programme_codes import InvalidProgrammeCode, ProgrammeCodes
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.student_database import _crn_programs
from tests.conftest import TEST_DATABASE_URL

AT = "/api/v1/programme-codes"


@pytest.fixture
def codes() -> ProgrammeCodes:
    store = ProgrammeCodes(engine_for(TEST_DATABASE_URL))
    with store.engine.begin() as connection:
        connection.execute(text("DELETE FROM programme_codes"))
    return store


@pytest.fixture
def client(codes: ProgrammeCodes) -> TestClient:
    app.dependency_overrides[api.get_codes] = lambda: codes
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_codes, None)


def test_an_administrator_says_once_that_two_codes_are_the_same(client: TestClient):
    saved = client.put(f"{AT}/MATS", json={"sameAs": "MATH - Mathematics"})

    assert saved.status_code == status.HTTP_200_OK, saved.text
    [row] = client.get(AT).json()["codes"]
    # Kept as codes, uppercase, and signed.
    assert (row["code"], row["sameAs"], row["createdBy"]) == ("MATS", "MATH", "coordinator@sorbonne.ae")

    # Said again, it replaces rather than piles up; taken off, it is gone.
    client.put(f"{AT}/mats", json={"sameAs": "MATH"})
    assert len(client.get(AT).json()["codes"]) == 1
    assert client.delete(f"{AT}/MATS").status_code == status.HTTP_200_OK
    assert client.get(AT).json()["codes"] == []
    assert client.delete(f"{AT}/MATS").status_code == status.HTTP_404_NOT_FOUND


def test_only_an_administrator_changes_the_list_and_anybody_reads_it(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    assert client.get(AT).status_code == status.HTTP_200_OK
    assert client.put(f"{AT}/MATS", json={"sameAs": "MATH"}).status_code == status.HTTP_403_FORBIDDEN
    assert client.delete(f"{AT}/MATS").status_code == status.HTTP_403_FORBIDDEN


def test_a_code_means_another_in_one_step_never_through_a_third(codes: ProgrammeCodes):
    codes.set("MATS", "MATH")

    # MATX → MATS would mean MATH through MATS: point it at MATH instead.
    with pytest.raises(InvalidProgrammeCode, match="MATS already means MATH"):
        codes.set("MATX", "MATS")
    # And MATH cannot start meaning something else while MATS leans on it.
    with pytest.raises(InvalidProgrammeCode, match="MATS already means MATH"):
        codes.set("MATH", "MATHS")
    with pytest.raises(InvalidProgrammeCode, match="already means itself"):
        codes.set("MATH", "math")
    with pytest.raises(InvalidProgrammeCode, match="not a programme code"):
        codes.set("MA TS!", "MATH")


def test_refusals_reach_the_page_in_words(client: TestClient):
    refused = client.put(f"{AT}/MATH", json={"sameAs": "MATH"})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "already means itself" in refused.json()["detail"]


def test_a_code_is_filed_under_the_one_it_means():
    same_as = {"mats": "math"}

    assert program_code("MATS - MAth", same_as) == "math"
    assert program_code("MATH - Mathematics", same_as) == "math"
    # Without the list, the two are two programmes — which is the trouble it fixes.
    assert program_code("MATS - MAth") != program_code("MATH - Mathematics")


def test_rows_written_either_side_of_a_recode_are_one_programme_to_the_clash_check():
    """A MATS row and a MATH row taking one shared CRN are the same students.

    Counted as two programmes, the CRN would name none — and read downstream as a class
    that may share students with anything, so its clashes with the other programme's
    classes would be reported where there are none.
    """
    cell = {"group_id": "g1", "part": 1, "retired": False}
    cells = [
        {**cell, "course_id": "c1", "major_id": "", "crn": "24100", "not_taught": False},
        {**cell, "course_id": "c2", "major_id": "m-phys", "crn": "", "not_taught": True},
    ]
    majors_of = {
        "g1": [
            {"id": "m-old", "program": "MATH - Mathematics"},
            {"id": "m-new", "program": "MATS - MAth"},
            {"id": "m-phys", "program": "PHYS - Physics"},
        ]
    }
    code_of = {"c1": "MATH-330", "c2": "PHYS-118"}

    assert _crn_programs(cells, code_of, majors_of) == {}
    assert _crn_programs(cells, code_of, {"g1": majors_of["g1"][:2]}, {"mats": "math"}) == {"24100": "math"}
