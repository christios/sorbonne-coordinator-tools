"""What a syllabus must say before it can be submitted for review (November 2026 review).

The rules are the proposed required-fields checklist; drafts are never blocked.
"""

import os

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from sorbonne.api.syllabi import get_account_access, get_catalogue_store, get_store
from sorbonne.api.syllabus_outcome_mode import get_outcome_mode
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.account_access import AccountAccess
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_catalogue_store import SyllabusCatalogueStore
from sorbonne.services.syllabus_completeness import missing_for_submission
from sorbonne.services.syllabus_outcome_mode import SyllabusOutcomeMode
from sorbonne.services.syllabus_store import SyllabusStore, default_content
from sorbonne.services.syllabus_templates import DEFAULT_TEMPLATE_ID, FYS_TEMPLATE_ID
from tests.syllabus_samples import complete_fys_content, complete_scen_content

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)
AUTHOR = StaffUser(email="professor@sorbonne.ae", name="A Professor")
SCEN = {
    "templateId": DEFAULT_TEMPLATE_ID,
    "courseCode": "PHYS-118",
    "courseTitle": "Optics",
    "academicYear": "2026-2027",
}
FYS = {**SCEN, "templateId": FYS_TEMPLATE_ID}


def messages(missing: list[dict[str, str]]) -> list[str]:
    return [item["message"] for item in missing]


# The rules


def test_a_syllabus_that_says_everything_lacks_nothing() -> None:
    assert missing_for_submission(SCEN, complete_scen_content()) == []
    assert missing_for_submission(FYS, complete_fys_content()) == []


def test_a_new_syllabus_lists_what_it_still_needs_section_by_section_in_screen_order() -> None:
    missing = missing_for_submission({**SCEN, "courseCode": ""}, default_content())

    sections = [item["section"] for item in missing]
    assert sections == sorted(sections, key=[
        "identification", "contacts", "description", "learningOutcomes", "schedule", "teachingApproach", "assessment",
    ].index)
    assert "Give the course code." in messages(missing)
    assert "Choose the programme." in messages(missing)
    assert "Choose the academic coordinator." in messages(missing)
    assert "Add the course's graded activities." in messages(missing)


def test_a_new_syllabus_still_untitled_is_asked_for_its_course_title() -> None:
    assert messages(missing_for_submission({**SCEN, "courseTitle": "Untitled syllabus"}, complete_scen_content())) == [
        "Give the course title."
    ]


def test_the_weights_of_the_graded_activities_must_add_up_to_100() -> None:
    content = complete_scen_content()
    content["schedule"][2]["weight"] = "50"

    assert messages(missing_for_submission(SCEN, content)) == [
        "Make the graded activities' weights add up to 100% (they add up to 90%)."
    ]


def test_each_graded_activity_needs_a_week_its_outcomes_and_an_ai_policy() -> None:
    content = complete_scen_content()
    essay = content["schedule"][1]
    essay.update({"week": "", "cloIds": [], "aiPolicy": ""})

    assert messages(missing_for_submission(SCEN, content)) == [
        'Give "Essay" a week.',
        'Say which course learning outcomes "Essay" assesses.',
        'Choose the AI policy of "Essay".',
    ]


def test_other_needs_the_teachers_own_words() -> None:
    content = complete_scen_content()
    content["schedule"][1]["aiPolicy"] = "Other (Specify)"

    assert messages(missing_for_submission(SCEN, content)) == ['Describe the AI policy of "Essay".']

    content["schedule"][1]["aiOtherText"] = "Only for the bibliography."
    assert missing_for_submission(SCEN, content) == []


def test_the_details_of_an_ai_option_are_needed_only_when_an_activity_applies_it() -> None:
    content = complete_scen_content()
    content["assessment"].update({"aiVerificationMechanism": "", "aiAllowedUses": []})

    assert messages(missing_for_submission(SCEN, content)) == [
        "Say how the use of AI is checked where it is prohibited.",
        "Tick the uses of AI permitted as a support tool.",
    ]

    for activity in content["schedule"][1:]:
        activity["aiPolicy"] = "AI Required"
    assert missing_for_submission(SCEN, content) == []


def test_an_earlier_note_on_a_session_must_be_moved_into_a_graded_activity_or_cleared() -> None:
    content = complete_scen_content()
    content["schedule"][0]["assessments"] = "Quiz 1"

    assert messages(missing_for_submission(SCEN, content)) == [
        'Move the earlier notes into graded activities, or clear them (1 session): "Reflection".'
    ]


def test_sessions_are_listed_once_per_kind_of_gap_naming_the_first_few_by_their_topic() -> None:
    content = complete_scen_content()
    long_topic = "Chapter 3: Imaging\n- Recap\n- Combination of two lenses and a great deal more besides"
    content["schedule"][:1] = [
        {"id": f"s{number}", "topic": topic, "date": "", "details": "<p>Read the chapter.</p>"}
        for number, topic in enumerate(["Rays", long_topic, "", "Mirrors", "Prisms"], start=1)
    ]

    assert messages(missing_for_submission(SCEN, content)) == [
        "Give 1 session a topic.",
        'Give 5 sessions a week: "Rays", "Chapter 3: Imaging", "untitled" and 2 more.',
    ]

    for row in content["schedule"][:5]:
        row["date"] = "2027-01-11"
    content["schedule"][2]["topic"] = "Lenses"
    assert missing_for_submission(SCEN, content) == []


def test_an_activity_carried_over_from_an_older_syllabus_may_name_its_outcomes_as_text() -> None:
    content = complete_scen_content()
    content["schedule"][1].update({"cloIds": [], "clos": "Trace rays."})

    assert missing_for_submission(SCEN, content) == []


def test_an_unnamed_activity_is_called_what_the_schedule_calls_it() -> None:
    content = complete_scen_content()
    content["schedule"][2].update({"name": "", "type": "", "assessmentTypeId": ""})

    assert messages(missing_for_submission(SCEN, content)) == ['Choose the assessment type of "Graded activity 2".']


def test_every_plo_the_curriculum_mapping_expects_must_be_aligned_in_teacher_mode() -> None:
    expected = {"plo-1": "PLO 1", "plo-3": "PLO 3"}

    assert messages(missing_for_submission(SCEN, complete_scen_content(), expected_plos=expected)) == [
        "Align a course learning outcome to PLO 3: the curriculum mapping expects it."
    ]


def test_what_christian_ticked_required_on_10_november() -> None:
    content = complete_scen_content()
    del content["contacts"]["instructor"]["Academic rank / status"]
    content["learningOutcomes"]["clos"][0]["skillIds"] = []
    content["schedule"][0]["details"] = "<p><br></p>"

    assert messages(missing_for_submission(SCEN, content)) == [
        "Give the course instructor's academic rank / status.",
        "Choose the SCEN graduate competencies CLO 1 develops.",
        'Describe 1 session in its details: "Reflection".',
    ]


def test_a_directory_instructor_without_a_rank_is_for_an_administrator_to_fix() -> None:
    content = complete_scen_content()
    content["contacts"]["instructor"] = {"personId": "person-1", "Name": "A Professor", "Email": "p@sorbonne.ae"}

    assert messages(missing_for_submission(SCEN, content)) == [
        "Ask an administrator to add the course instructor's academic rank in People."
    ]

    content["contacts"]["instructor"]["Academic rank / status"] = "Professor"
    assert missing_for_submission(SCEN, content) == []


def test_a_course_whose_programme_has_no_plos_is_not_asked_to_align_its_clos() -> None:
    """A Foundation Year course, on the bachelor template since 10 Nov 2026: its programme has no PLOs."""
    content = complete_scen_content()
    content["learningOutcomes"]["clos"][0]["ploIds"] = []

    assert messages(missing_for_submission(SCEN, content)) == ["Align CLO 1 to a programme learning outcome."]
    assert missing_for_submission(SCEN, content, programme_has_plos=False) == []


def test_in_head_of_department_mode_a_teacher_is_not_asked_for_outcomes_they_cannot_write() -> None:
    content = complete_scen_content()
    content["learningOutcomes"]["clos"][0]["ploIds"] = []

    assert missing_for_submission(SCEN, content, outcome_mode="hod", expected_plos={"plo-3": "PLO 3"}) == []

    content["learningOutcomes"]["clos"] = []
    assert messages(missing_for_submission(SCEN, content, outcome_mode="hod")) == [
        "The Head of Department has not written this course's learning outcomes yet."
    ]


def test_a_blended_course_says_how_its_teaching_is_split() -> None:
    content = complete_scen_content()
    content["delivery"]["onlinePercent"] = "30"

    assert messages(missing_for_submission(SCEN, content)) == [
        "Make the face-to-face and online shares add up to 100%."
    ]


def test_a_syllabus_not_yet_converted_is_checked_on_its_assessment_items() -> None:
    content = complete_scen_content()
    content["schemaVersion"] = 1
    content["assessment"]["items"] = [
        {**card, "kind": None, "week": "", "date": "2027-03-01"} for card in content["schedule"] if card.get("kind")
    ]
    content["schedule"] = content["schedule"][:1]

    assert missing_for_submission(SCEN, content) == []


def test_a_foundation_year_syllabus_has_four_to_six_outcomes_and_fills_a_row_of_its_form() -> None:
    content = complete_fys_content()
    content["learningOutcomes"]["closText"] = "One.\nTwo."
    content["schedule"][1]["component"] = ""

    assert messages(missing_for_submission(FYS, content)) == [
        "Write between 4 and 6 course learning outcomes (there are 2).",
        'Choose the row of the assessment form "Quiz on forces" fills.',
    ]


def test_a_foundation_year_instructor_may_be_typed_in_and_methods_described_in_words() -> None:
    content = complete_fys_content()
    content["facultyDetails"] = {"staff": [], "staffText": "A Lecturer", "email": "lecturer@sorbonne.ae"}
    content["teachingMethodologies"] = {"methods": {}, "notes": "Lectures, 30 hours."}

    assert missing_for_submission(FYS, content) == []

    content["facultyDetails"]["email"] = ""
    content["teachingMethodologies"]["notes"] = ""
    assert messages(missing_for_submission(FYS, content)) == [
        "Give the course instructor's email.",
        "Describe the teaching methods and hours.",
    ]


# Through the API


@pytest.fixture(autouse=True)
def against_the_test_database(monkeypatch: pytest.MonkeyPatch):
    app.dependency_overrides[get_store] = lambda: SyllabusStore(TEST_DATABASE_URL)
    app.dependency_overrides[get_catalogue_store] = lambda: SyllabusCatalogueStore(TEST_DATABASE_URL)
    app.dependency_overrides[get_outcome_mode] = lambda: SyllabusOutcomeMode(engine_for(TEST_DATABASE_URL))
    app.dependency_overrides[get_account_access] = lambda: AccountAccess(TEST_DATABASE_URL)
    monkeypatch.setattr(auth_gate, "user_for_request", lambda *_args, **_kwargs: AUTHOR)
    yield
    for dependency in (get_store, get_catalogue_store, get_outcome_mode, get_account_access):
        app.dependency_overrides.pop(dependency, None)
    with create_engine(TEST_DATABASE_URL).begin() as connection:
        connection.execute(text("DELETE FROM syllabus_field_history"))
        connection.execute(text("DELETE FROM syllabi"))
        connection.execute(text("DELETE FROM syllabus_outcome_mode"))
        connection.execute(text("DELETE FROM syllabus_catalogue_items WHERE id ~ '^[0-9a-f-]{36}$'"))


def write(client: TestClient, content: dict | None = None) -> dict:
    created = client.post(
        "/api/v1/syllabi", json={"courseTitle": "Optics", "courseCode": "PHYS-118", "academicYear": "2026-2027"}
    )
    assert created.status_code == status.HTTP_201_CREATED, created.text
    if content is None:
        return created.json()
    saved = client.patch(
        f"/api/v1/syllabi/{created.json()['id']}",
        json={"expectedRevision": created.json()["revision"], "content": content},
    )
    assert saved.status_code == status.HTTP_200_OK, saved.text
    return saved.json()


def test_the_editor_is_told_what_a_draft_still_lacks() -> None:
    client = TestClient(app)
    draft = write(client)

    answer = client.get(f"/api/v1/syllabi/{draft['id']}/completeness")

    assert answer.status_code == status.HTTP_200_OK
    assert answer.json()["complete"] is False
    assert {"section": "description", "message": "Write the course description."} in answer.json()["missing"]


def test_an_incomplete_syllabus_cannot_be_submitted_but_can_still_be_exported() -> None:
    client = TestClient(app)
    draft = write(client)

    refused = client.patch(f"/api/v1/syllabi/{draft['id']}/review", json={"submitted": True})

    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert refused.json()["detail"].startswith("This syllabus is not ready for review:")
    assert client.get(f"/api/v1/syllabi/{draft['id']}/export").status_code == status.HTTP_200_OK


def test_a_complete_syllabus_is_submitted_and_the_request_can_always_be_taken_back() -> None:
    client = TestClient(app)
    ready = write(client, complete_scen_content())

    assert client.get(f"/api/v1/syllabi/{ready['id']}/completeness").json() == {"complete": True, "missing": []}
    assert client.patch(f"/api/v1/syllabi/{ready['id']}/review", json={"submitted": True}).status_code == 200
    assert client.patch(f"/api/v1/syllabi/{ready['id']}/review", json={"submitted": False}).status_code == 200


def test_the_plos_the_curriculum_mapping_expects_come_from_the_catalogue() -> None:
    catalogue = SyllabusCatalogueStore(TEST_DATABASE_URL)
    programme = catalogue.create("programmes", label="Physics test programme", payload={})
    plo_1 = catalogue.create("plos", label="PLO 1", payload={"code": "PLO 1"}, parent_id=programme["id"])
    plo_2 = catalogue.create("plos", label="PLO 2", payload={"code": "PLO 2"}, parent_id=programme["id"])
    catalogue.create(
        "curriculum-mapping",
        label="PHYS 118",
        payload={"ploIds": [plo_1["id"], plo_2["id"]]},
        parent_id=programme["id"],
    )
    content = complete_scen_content()
    content["identification"]["catalogueProgrammeId"] = programme["id"]
    content["learningOutcomes"]["clos"][0]["ploIds"] = [plo_1["id"]]
    client = TestClient(app)
    syllabus = write(client, content)

    answer = client.get(f"/api/v1/syllabi/{syllabus['id']}/completeness").json()

    assert answer["missing"] == [
        {
            "section": "learningOutcomes",
            "message": "Align a course learning outcome to PLO 2: the curriculum mapping expects it.",
        }
    ]
