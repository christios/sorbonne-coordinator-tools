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


from sorbonne.services.syllabus_content import document_schedule  # noqa: E402


def test_an_older_syllabus_prints_its_schedule_as_it_always_has() -> None:
    content = {"schedule": [{"id": "s2", "week": "2", "sessionType": "TD"}, {"id": "s1", "week": "1"}]}

    assert [(row["id"], row["session"]) for row in document_schedule(content)] == [("s2", "TD 1"), ("s1", "CM 1")]


def test_a_graded_activity_prints_with_the_last_session_of_its_week_or_on_a_row_of_its_own() -> None:
    content = {
        "schemaVersion": 2,
        "schedule": [
            {"id": "s3", "week": "3", "topic": "Interference"},
            {"id": "s1", "week": "1", "topic": "Rays", "sessionType": "CM"},
            {"id": "s1b", "week": "1", "topic": "Ray exercises", "sessionType": "TD", "assessments": "Bring a ruler"},
            {"id": "q1", "kind": "graded", "week": "1", "name": "Quiz 1", "date": "2026-09-10"},
            {"id": "q2", "kind": "graded", "week": "1", "name": "Lab report"},
            {"id": "m1", "kind": "graded", "week": "2", "name": "Midterm", "date": "2026-09-17"},
            {"id": "x1", "kind": "graded", "name": "Final"},
        ],
    }

    rows = document_schedule(content)

    assert [(row.get("id"), row["week"], row["session"]) for row in rows] == [
        ("s1", "1", "CM 1"),
        ("s1b", "1", "TD 1"),
        (None, "2", ""),
        ("s3", "3", "CM 2"),
        (None, "", ""),
    ]
    assert rows[1]["assessments"] == "Bring a ruler\nQuiz 1\nLab report"
    assert rows[1]["deadline"] == "10/09/2026"
    assert (rows[2]["topic"], rows[2]["assessments"], rows[2]["deadline"]) == ("Midterm", "Midterm", "17/09/2026")
    assert rows[4]["topic"] == "Final"


from sorbonne.services.syllabus_content import convert_fys_to_schedule_cards  # noqa: E402


def test_a_foundation_year_syllabus_gets_cards_from_the_rows_it_had_and_keeps_its_free_text() -> None:
    before = {
        "schedule": {"scheduleText": "Week 1: functions"},
        "assessment": {
            "continuous": [{"id": "c1", "component": "In class presentation", "description": "Talk", "weight": "15"}],
            "final": [{"id": "f1", "description": "Exam", "weight": "50%"}],
            "laboratory": [],
            "finalText": "Two hours, closed book.",
        },
    }

    after, report = convert_fys_to_schedule_cards(before)

    assert after["schemaVersion"] == 2
    assert after["earlierSchedule"] == {"scheduleText": "Week 1: functions"}
    assert [(card["component"], card["description"], card["weight"]) for card in after["schedule"]] == [
        ("continuous:In class presentation", "Talk", "15"),
        ("final", "Exam", "50"),
    ]
    assert after["assessment"]["finalText"] == "Two hours, closed book."
    assert report["gradedActivities"] == 2 and report["earlierNotes"] == 2
