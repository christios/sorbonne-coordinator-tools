from sorbonne.services.syllabus_content import graded_activities, schema_version


def test_graded_activities_are_the_assessment_list_on_a_syllabus_written_before_november_2026() -> None:
    content = {
        "assessment": {"items": [{"id": "a1", "type": "Quiz"}, "a stray string"]},
        "schedule": [{"id": "s1", "kind": "graded"}],
    }

    assert schema_version(content) == 1
    assert graded_activities(content) == [{"id": "a1", "type": "Quiz"}]


def test_graded_activities_are_the_schedule_cards_once_the_schedule_holds_them() -> None:
    content = {
        "schemaVersion": 2,
        "assessment": {"items": [{"id": "old", "type": "Kept for rollback, not read"}]},
        "schedule": [{"id": "s1", "topic": "Optics"}, {"id": "g1", "kind": "graded", "type": "Quiz"}],
    }

    assert graded_activities(content) == [{"id": "g1", "kind": "graded", "type": "Quiz"}]


def test_a_syllabus_with_nothing_graded_has_no_graded_activities() -> None:
    assert graded_activities({}) == []
    assert graded_activities({"assessment": "legacy text"}) == []
