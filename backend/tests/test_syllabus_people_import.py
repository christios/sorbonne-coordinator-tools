import os
from typing import Any

import pytest
from sqlalchemy import create_engine, text

from sorbonne.services.syllabus_catalogue_store import SyllabusCatalogueStore
from sorbonne.services.syllabus_people_import import import_teachers


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


class FakePortal:
    """Stands in for Students and Timetables: only the one list matters here."""

    def __init__(self, teachers: list[dict[str, Any]]) -> None:
        self.teachers = teachers

    def list_active_teachers(self) -> list[dict[str, Any]]:
        return self.teachers


def make_store() -> SyllabusCatalogueStore:
    return SyllabusCatalogueStore(TEST_DATABASE_URL)


@pytest.fixture(autouse=True)
def forget_what_the_tests_made() -> None:
    yield
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_catalogue_items WHERE id ~ '^[0-9a-f-]{36}$'"))


def teacher(name: str, **extra: Any) -> dict[str, Any]:
    return {"fullName": name, "portalTeacherId": f"A{abs(hash(name)) % 10**8:08d}", **extra}


def test_brings_everyone_teaching_into_the_directory() -> None:
    store = make_store()
    portal = FakePortal([teacher("Amina Menaa", email="amina.menaa@sorbonne.ae", category="Lecturer")])

    result = import_teachers(store, portal)

    assert result["added"] == ["Amina Menaa"]
    person = next(item for item in store.list("people", query="Amina Menaa") if item["label"] == "Amina Menaa")
    assert person["payload"]["roles"] == ["instructor"]
    assert person["payload"]["email"] == "amina.menaa@sorbonne.ae"
    assert person["payload"]["academicRank"] == "Lecturer"


def test_running_it_again_adds_nobody() -> None:
    store = make_store()
    portal = FakePortal([teacher("Bilal Maaz", email="bilal.maaz@sorbonne.ae")])

    import_teachers(store, portal)
    again = import_teachers(store, portal)

    assert again["added"] == []
    assert again["unchanged"] == ["Bilal Maaz"]


def test_a_rank_typed_here_outranks_the_registrar() -> None:
    store = make_store()
    store.create(
        "people",
        label="Cecile Paillot",
        payload={"academicRank": "Professeur des universités", "email": "", "roles": ["coordinator"]},
    )
    portal = FakePortal([teacher("Cécile Paillot", email="cecile.paillot@sorbonne.ae", category="Lecturer")])

    result = import_teachers(store, portal)

    assert result["added"] == []
    person = next(item for item in store.list("people", query="Cecile") if item["label"] == "Cecile Paillot")
    assert person["payload"]["academicRank"] == "Professeur des universités"
    assert person["payload"]["email"] == "cecile.paillot@sorbonne.ae"
    assert sorted(person["payload"]["roles"]) == ["coordinator", "instructor"]


def test_a_retired_person_stays_retired_and_is_not_added_twice() -> None:
    store = make_store()
    payload = {"roles": ["instructor"], "portalTeacherId": "A00001111"}
    person = store.create("people", label="Hani Sayes", payload=payload)
    store.retire("people", person["id"], expected_revision=person["revision"])
    portal = FakePortal([{"fullName": "Hani Sayes", "portalTeacherId": "A00001111", "email": "hani@sorbonne.ae"}])

    result = import_teachers(store, portal)

    assert result["added"] == []
    assert result["retired"] == ["Hani Sayes"]
    assert [item for item in store.list("people", query="Hani Sayes")] == []


def test_leaves_a_coordinator_who_is_not_teaching_alone() -> None:
    store = make_store()
    store.create("people", label="Valerie Le Guyon", payload={"roles": ["coordinator"], "email": "v@sorbonne.ae"})
    portal = FakePortal([teacher("Jad Tarsissi", email="jad@sorbonne.ae")])

    import_teachers(store, portal)

    person = next(item for item in store.list("people", query="Valerie") if item["label"] == "Valerie Le Guyon")
    assert person["payload"]["roles"] == ["coordinator"]
    assert person["revision"] == 1
