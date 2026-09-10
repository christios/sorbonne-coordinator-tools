import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text

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


@pytest.fixture(autouse=True)
def forget_what_the_tests_made() -> None:
    """Take the rows these tests create back out again.

    They never did, and it went unnoticed for as long as the pile stayed small: `list`
    returns at most a hundred items, so once three hundred abandoned programmes had built
    up over many runs the SEEDED one fell off the end and a test about seed data started
    failing for reasons nothing to do with seed data.

    Only the ids these tests make — uuids. The seeded rows have readable ids and are the
    fixture, not the litter.
    """
    yield
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(
            text("DELETE FROM syllabus_catalogue_items WHERE id ~ '^[0-9a-f-]{36}$'")
        )


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


def test_fills_the_export_plo_table_from_the_linked_programme() -> None:
    """A syllabus owned by a programme carries no PLO text of its own."""
    store = make_store()
    programme = store.create("programmes", label=f"Programme {uuid4()}", payload={})
    store.create(
        "plos",
        label="PLO 1",
        parent_id=programme["id"],
        payload={"code": "PLO 1", "outcome": "Model and solve physics problems."},
    )
    content = {
        "identification": {"cataloguePloProgrammeId": programme["id"]},
        "learningOutcomes": {"plos": [], "clos": [{"clo": "CLO 1"}]},
    }

    resolved = store.resolve_plos(content)

    assert resolved["learningOutcomes"]["plos"] == [
        {
            "id": resolved["learningOutcomes"]["plos"][0]["id"],
            "code": "PLO 1",
            "outcome": "Model and solve physics problems.",
        }
    ]
    assert resolved["learningOutcomes"]["clos"] == [{"clo": "CLO 1"}]
    assert content["learningOutcomes"]["plos"] == []


def test_leaves_plos_alone_when_the_syllabus_has_no_programme() -> None:
    store = make_store()
    content = {"learningOutcomes": {"plos": [{"id": "local", "legacyText": "PLO 1: Local outcome."}]}}

    assert store.resolve_plos(content) == content


def test_labels_each_teaching_approach_by_the_kind_of_session() -> None:
    """Section 8 must say which session each paragraph describes."""
    store = make_store()
    lecture = store.create("teaching-presets", label=f"Lecture {uuid4()}", payload={"methods": "Instructor-led."})
    tutorial = store.create("teaching-presets", label=f"Tutorial {uuid4()}", payload={"methods": "Small group."})
    content = {"teachingApproach": {"teachingPresetIds": [lecture["id"], tutorial["id"]]}}

    resolved = store.resolve_teaching_approach(content)

    assert resolved["teachingApproach"]["methods"] == (
        f"{lecture['label']}: Instructor-led.\n\n{tutorial['label']}: Small group."
    )
    assert "methods" not in content["teachingApproach"]


def test_attaches_the_approved_rubric_for_each_assessment_type_used() -> None:
    """A course does not write rubrics; it uses the ones for the types it assesses."""
    store = make_store()
    assessment_type = store.create(
        "assessment-types",
        label=f"Quiz {uuid4()}",
        payload={"criteria": [{"name": "Accuracy", "inadequate": "Poor.", "meets": "Sound.", "exceeds": "Excellent."}]},
    )
    content = {
        "assessment": {
            "items": [
                {"id": "a1", "assessmentTypeId": assessment_type["id"]},
                {"id": "a2", "assessmentTypeId": assessment_type["id"]},
            ]
        }
    }

    rubrics = store.resolve_rubrics(content)["assessment"]["rubrics"]

    assert [rubric["assignment"] for rubric in rubrics] == [assessment_type["label"]]
    assert rubrics[0]["criteria"] == [
        {"criterion": "Accuracy", "inadequate": "Poor.", "meets": "Sound.", "exceeds": "Excellent."}
    ]
