import os
from uuid import uuid4

from sorbonne.services.syllabus_catalogue_store import (
    CatalogueNotFound,
    CatalogueRevisionConflict,
    SyllabusCatalogueStore,
)


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def make_store() -> SyllabusCatalogueStore:
    return SyllabusCatalogueStore(TEST_DATABASE_URL)


def test_creates_lists_and_retires_a_person_without_removing_it_from_history() -> None:
    store = make_store()
    person = store.create(
        "people",
        label=f"Dr Catalogue {uuid4()}",
        payload={"email": "catalogue@example.test", "roles": ["instructor"]},
    )

    assert person["isRetired"] is False
    assert person["payload"]["roles"] == ["instructor"]
    assert any(item["id"] == person["id"] for item in store.list("people"))

    retired = store.retire("people", person["id"], expected_revision=person["revision"])

    assert retired["isRetired"] is True
    assert all(item["id"] != person["id"] for item in store.list("people"))
    assert store.get("people", person["id"])["isRetired"] is True


def test_rejects_stale_catalogue_updates() -> None:
    store = make_store()
    programme = store.create("programmes", label=f"Programme {uuid4()}", payload={})
    store.update(
        "programmes", programme["id"], expected_revision=programme["revision"], label="Updated programme", payload={}
    )

    try:
        store.update("programmes", programme["id"], expected_revision=programme["revision"], label="Stale", payload={})
    except CatalogueRevisionConflict:
        pass
    else:  # pragma: no cover - documents the required conflict boundary
        raise AssertionError("stale catalogue update must fail")


def test_keeps_legacy_syllabus_content_when_no_catalogue_reference_exists() -> None:
    store = make_store()
    content = {"contacts": {"instructor": {"Name": "Legacy Instructor"}}}

    assert store.resolve_people(content) == content


def test_seeded_programme_and_approved_plos_are_available_without_touching_syllabi() -> None:
    store = make_store()

    programme = next(
        item for item in store.list("programmes") if item["id"] == "programme-bsc-physics-quantum-technologies"
    )
    plos = store.list("plos", parent_id=programme["id"])

    assert programme["label"] == "Bachelor in Physics – Concentration in Quantum Technologies"
    assert [item["payload"]["code"] for item in plos] == [f"PLO {number}" for number in range(1, 7)]


def test_resolves_live_person_details_without_rewriting_manual_contact_content() -> None:
    store = make_store()
    person = store.create(
        "people",
        label=f"Dr Linked {uuid4()}",
        payload={
            "academicRank": "Associate Professor",
            "email": "linked@example.test",
            "affiliations": "Sorbonne University Abu Dhabi",
            "officeHours": "Tuesday · 10:00–12:00 · A6-117",
            "roles": ["instructor"],
        },
    )
    content = {"contacts": {"instructor": {"personId": person["id"], "Name": "Legacy name"}}}

    resolved = store.resolve_people(content)

    assert content["contacts"]["instructor"]["Name"] == "Legacy name"
    assert resolved["contacts"]["instructor"]["Name"] == person["label"]
    assert resolved["contacts"]["instructor"]["Email"] == "linked@example.test"


def test_raises_for_unknown_catalogue_entry() -> None:
    try:
        make_store().get("people", str(uuid4()))
    except CatalogueNotFound:
        pass
    else:  # pragma: no cover - documents the required not-found boundary
        raise AssertionError("unknown catalogue entry must fail")
