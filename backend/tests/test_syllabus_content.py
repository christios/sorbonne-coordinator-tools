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


from sorbonne.services.syllabus_content import convert_to_schedule_cards, course_ai_fallback  # noqa: E402


def a_syllabus_written_before_november_2026() -> dict:
    return {
        "schedule": [
            {"id": "s2", "week": "2", "topic": "Mirrors", "deadline": "End of week 2", "assessments": "Quiz 1"},
            {"id": "s1", "week": "1", "topic": "Rays"},
        ],
        "assessment": {
            "scheduleBy": "date",
            "aiPolicy": "AI Prohibited",
            "items": [
                {"id": "a1", "name": "Quiz 1", "week": "2", "date": "2026-09-14", "weight": "20", "cloIds": ["c1"]},
                {"id": "a2", "name": "Final", "date": "2026-12-10", "weight": "50", "aiPolicy": "AI Required"},
            ],
        },
    }


def test_converting_puts_each_graded_activity_in_the_schedule_and_keeps_everything_it_had() -> None:
    before = a_syllabus_written_before_november_2026()

    after, report = convert_to_schedule_cards(before)

    assert after["schemaVersion"] == 2
    assert [card["id"] for card in after["schedule"]] == ["s2", "s1", "a1", "a2"]
    quiz = after["schedule"][2]
    assert quiz["kind"] == "graded"
    assert quiz["week"] == "2" and quiz["date"] == "2026-09-14" and quiz["cloIds"] == ["c1"]
    # The course-wide policy it used to inherit is now its own.
    assert quiz["aiPolicy"] == "AI Prohibited"
    assert after["schedule"][3]["aiPolicy"] == "AI Required"
    # Nothing the syllabus had is lost: the old list stays readable for a rollback.
    assert after["assessment"]["items"] == before["assessment"]["items"]
    assert after["assessment"]["aiPolicy"] == "AI Prohibited"
    assert after["schedule"][0]["assessments"] == "Quiz 1"
    assert before.get("schemaVersion") is None
    assert report == {
        "gradedActivities": 2,
        "withoutWeek": ["Final"],
        "inheritedAiPolicy": 1,
        "earlierNotes": 1,
    }


def test_converting_twice_changes_nothing() -> None:
    once, _ = convert_to_schedule_cards(a_syllabus_written_before_november_2026())

    twice, report = convert_to_schedule_cards(once)

    assert twice == once
    assert report == {"gradedActivities": 0, "withoutWeek": [], "inheritedAiPolicy": 0, "earlierNotes": 0}


def test_a_converted_syllabus_no_longer_falls_back_on_the_old_course_wide_ai_policy() -> None:
    before = a_syllabus_written_before_november_2026()
    after, _ = convert_to_schedule_cards(before)

    assert course_ai_fallback(before) == "AI Prohibited"
    assert course_ai_fallback(after) == ""
