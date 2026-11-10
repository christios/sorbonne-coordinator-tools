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


def test_the_department_lists_the_academic_ranks_a_person_is_given() -> None:
    """Christian, 10 Nov 2026: a rank is chosen from a list kept in the catalogue."""
    store = make_store()
    rank = store.create("academic-ranks", label=f"Associate Professor {uuid4()}", payload={})

    assert any(item["id"] == rank["id"] for item in store.list("academic-ranks"))


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
    """Section 8 must say which session each paragraph describes. A syllabus whose schedule
    is still empty keeps the presets it ticked before November 2026."""
    store = make_store()
    lecture = store.create("teaching-presets", label=f"Lecture {uuid4()}", payload={"methods": "Instructor-led."})
    tutorial = store.create("teaching-presets", label=f"Tutorial {uuid4()}", payload={"methods": "Small group."})
    content = {"teachingApproach": {"teachingPresetIds": [lecture["id"], tutorial["id"]]}}

    resolved = store.resolve_teaching_approach(content)

    assert resolved["teachingApproach"]["methods"] == (
        f"{lecture['label']}: Instructor-led.\n\n{tutorial['label']}: Small group."
    )
    assert "methods" not in content["teachingApproach"]


def test_section_8_follows_from_the_kinds_of_session_in_the_course_schedule() -> None:
    """Christian, 10 Nov 2026: no teaching-approach section; the schedule says it."""
    store = make_store()
    tag = uuid4().hex[:6]
    lecture = store.create(
        "teaching-presets", label=f"Lectures / Cours magistraux {tag}", payload={"methods": "Instructor-led."}
    )
    store.create("teaching-presets", label=f"Problem-solving / TD {tag}", payload={"methods": "Exercises."})
    laboratory = store.create("teaching-presets", label=f"Laboratory / TP {tag}", payload={"methods": "Experiments."})
    project = store.create("teaching-presets", label=f"Project {tag}", payload={"methods": "Team work."})
    seminar = store.create(
        "teaching-presets", label=f"Discussion {tag}", payload={"methods": "Debate.", "sessionTypes": ["Seminar"]}
    )
    content = {
        "schemaVersion": 2,
        # A tick left over from before is ignored once the schedule says something.
        "teachingApproach": {"teachingPresetIds": [seminar["id"]]},
        "schedule": [
            {"id": "s1", "topic": "Rays"},  # no type: a lecture
            {"id": "s2", "sessionType": "TP", "topic": "Lenses"},
            {"id": "g1", "kind": "graded", "type": "Project", "week": "5"},
        ],
    }

    methods = store.resolve_teaching_approach(content)["teachingApproach"]["methods"]

    assert f"{lecture['label']}: Instructor-led." in methods
    assert f"{laboratory['label']}: Experiments." in methods
    assert f"{project['label']}: Team work." in methods
    assert "Exercises." not in methods
    assert "Debate." not in methods


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


def test_rubrics_follow_the_graded_activities_and_nothing_else() -> None:
    """November 2026 review: the rubric preview must be faithful to the graded activities.

    Older syllabi stored rubrics written by hand. One is shown only while an activity of
    that kind exists; with no activities, there is no rubric to show.
    """
    store = make_store()
    stored = [
        {"id": "r1", "assignment": "Lab report", "criteria": [{"criterion": "Method"}]},
        {"id": "r2", "assignment": "Essay", "criteria": [{"criterion": "Argument"}]},
    ]

    nothing_graded = store.resolve_rubrics({"assessment": {"items": [], "rubrics": stored}})
    assert nothing_graded["assessment"]["rubrics"] == []

    typed_by_hand = store.resolve_rubrics(
        {"assessment": {"items": [{"id": "a1", "type": " lab REPORT "}], "rubrics": stored}}
    )
    assert [rubric["assignment"] for rubric in typed_by_hand["assessment"]["rubrics"]] == ["Lab report"]


def test_a_catalogue_rubric_and_a_hand_written_one_can_sit_side_by_side() -> None:
    store = make_store()
    quiz = store.create(
        "assessment-types",
        label=f"Quiz {uuid4()}",
        payload={"criteria": [{"name": "Accuracy", "inadequate": "", "meets": "", "exceeds": ""}]},
    )
    content = {
        "assessment": {
            "items": [{"id": "a1", "assessmentTypeId": quiz["id"]}, {"id": "a2", "type": "Lab report"}],
            "rubrics": [{"id": "r1", "assignment": "Lab report", "criteria": []}],
        }
    }

    rubrics = store.resolve_rubrics(content)["assessment"]["rubrics"]

    assert [rubric["assignment"] for rubric in rubrics] == [quiz["label"], "Lab report"]


def test_the_ai_policies_are_the_templates_five_each_tied_to_its_row() -> None:
    """Migration 0091: every graded activity applies one of the Provost's five AI options."""
    policies = sorted(
        (item for item in make_store().list("ai-policies") if item["id"].startswith("ai-policy-")),
        key=lambda item: item["payload"]["templateRow"],
    )

    assert [(item["label"], item["payload"]["templateRow"]) for item in policies] == [
        ("AI Prohibited", 1),
        ("AI Permitted as a Support Tool", 2),
        ("Restricted AI Use", 3),
        ("AI Required", 4),
        ("Other (Specify)", 5),
    ]
    support = policies[1]["payload"]
    assert "Language editing (grammar, spelling, style, and readability)" in support["permittedUses"]
    assert support["description"].startswith("Students may use generative artificial intelligence")


def test_in_head_of_department_mode_a_syllabus_shows_its_courses_outcomes_from_the_mapping() -> None:
    """November 2026 review: the HoD writes a course's CLOs once; every syllabus shows them."""
    store = make_store()
    programme = store.create("programmes", label=f"Physics {uuid4()}", payload={})
    plo = store.create("plos", label="PLO 1", parent_id=programme["id"], payload={"code": "PLO 1", "outcome": "Model."})
    competency = store.create("competencies", label=f"C1 {uuid4()}", payload={"code": "C1", "outcome": "Reason."})
    store.create(
        "curriculum-mapping",
        label="PHYS 118",
        parent_id=programme["id"],
        payload={
            "ploIds": [plo["id"]],
            "clos": [{"id": "hod-clo-1", "clo": "Trace rays.", "ploIds": [plo["id"]], "skillIds": [competency["id"]]}],
        },
    )
    content = {
        "identification": {"catalogueProgrammeId": programme["id"]},
        "learningOutcomes": {
            "clos": [{"id": "teacher-clo", "clo": "The teacher's own."}],
            # The competencies are the teacher's in either mode (Christian, 10 Nov 2026).
            "cloCompetencies": {"hod-clo-1": [competency["id"]]},
        },
        "assessment": {"items": [{"id": "a1", "cloIds": ["teacher-clo"], "catalogueCloIds": ["hod-clo-1"]}]},
    }

    hod = store.resolve_outcomes(content, course_code="PHYS-118", mode="hod")
    teacher = store.resolve_outcomes(content, course_code="PHYS-118", mode="teacher")

    assert hod["learningOutcomes"]["clos"] == [
        {
            "id": "hod-clo-1",
            "clo": "Trace rays.",
            "outcome": "Trace rays.",
            "plo": "PLO 1: Model.",
            "ploIds": plo["id"],
            "skills": "C1: Reason.",
            "skillIds": competency["id"],
        }
    ]
    assert hod["assessment"]["items"][0]["cloIds"] == ["hod-clo-1"]
    # Competencies the Head of Department once set in the mapping no longer count.
    content["learningOutcomes"]["cloCompetencies"] = {}
    unpicked = store.resolve_outcomes(content, course_code="PHYS-118", mode="hod")
    assert unpicked["learningOutcomes"]["clos"][0]["skillIds"] == ""
    # The teacher's outcomes are kept for the day the department switches back.
    assert content["learningOutcomes"]["clos"][0]["id"] == "teacher-clo"
    assert teacher is content


def test_in_head_of_department_mode_a_course_the_mapping_has_no_outcomes_for_shows_none() -> None:
    store = make_store()
    programme = store.create("programmes", label=f"Physics {uuid4()}", payload={})

    resolved = store.resolve_outcomes(
        {"identification": {"catalogueProgrammeId": programme["id"]}, "learningOutcomes": {"clos": [{"id": "x"}]}},
        course_code="PHYS-999",
        mode="hod",
    )

    assert resolved["learningOutcomes"]["clos"] == []


def test_a_foundation_year_syllabus_finds_its_outcomes_under_the_programme_of_that_name() -> None:
    store = make_store()
    programme = store.create("programmes", label="Foundation Year in Sciences", payload={})
    store.create(
        "curriculum-mapping",
        label="MATH 001",
        parent_id=programme["id"],
        payload={"ploIds": [], "clos": [{"id": "fy-1", "clo": "Solve linear equations.", "ploIds": []}]},
    )

    resolved = store.resolve_outcomes(
        {"learningOutcomes": {"closText": "The teacher's own"}},
        course_code="MATH-001",
        mode="hod",
        programme_title="Foundation Year in Sciences",
    )

    assert [clo["outcome"] for clo in resolved["learningOutcomes"]["clos"]] == ["Solve linear equations."]
