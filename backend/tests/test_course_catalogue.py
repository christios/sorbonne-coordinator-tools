import os
from uuid import uuid4

from sorbonne.services.teacher_store import TeacherStore


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def test_import_keeps_changed_crns_as_obsolete_historical_entries() -> None:
    store = TeacherStore(TEST_DATABASE_URL)
    crn = f"CRN-{uuid4()}"

    first = store.import_course_catalogue(
        [
            {
                "crn": crn,
                "term": "262710",
                "courseCode": "APLL-500",
                "courseTitle": "Didactique du français",
                "sequence": "1",
                "credit": "4",
                "department": "FRCL",
                "level": "M1",
                "college": "P4",
                "contactHours": "30",
            }
        ]
    )

    assert first["imported"] == 1
    assert first["retained"] == 0
    active_before_change = store.list_course_catalogue(query=crn)
    assert len(active_before_change) == 1
    assert active_before_change[0] == {
        **active_before_change[0],
        "crn": crn,
        "courseCode": "APLL-500",
        "courseTitle": "Didactique du français",
        "isObsolete": False,
        "obsoleteAt": None,
    }

    changed = store.import_course_catalogue(
        [
            {
                "crn": crn,
                "term": "262710",
                "courseCode": "APLL-500",
                "courseTitle": "Didactique du français — updated",
                "sequence": "1",
                "credit": "4",
                "department": "FRCL",
                "level": "M1",
                "college": "P4",
                "contactHours": "30",
            }
        ]
    )

    assert changed["imported"] == 1
    assert changed["retained"] == 0
    assert changed["obsoleted"] == 1
    active = store.list_course_catalogue(query=crn)
    assert len(active) == 1
    assert active[0]["courseTitle"] == "Didactique du français — updated"
    history = store.list_course_catalogue(query=crn, include_obsolete=True)
    assert len(history) == 2
    assert {entry["isObsolete"] for entry in history} == {False, True}


def test_import_marks_courses_absent_from_the_next_catalogue_as_obsolete() -> None:
    store = TeacherStore(TEST_DATABASE_URL)
    first_crn = f"CRN-{uuid4()}"
    second_crn = f"CRN-{uuid4()}"
    rows = [
        {"crn": first_crn, "term": "262710", "courseCode": "PHY-101", "courseTitle": "Physics", "sequence": "1", "credit": "4", "department": "PHY", "level": "L1", "college": "P4", "contactHours": "30"},
        {"crn": second_crn, "term": "262710", "courseCode": "MAT-101", "courseTitle": "Mathematics", "sequence": "1", "credit": "4", "department": "MAT", "level": "L1", "college": "P4", "contactHours": "30"},
    ]
    store.import_course_catalogue(rows)

    result = store.import_course_catalogue([rows[0]])

    assert result["retained"] == 1
    assert result["obsoleted"] == 1
    assert {entry["crn"] for entry in store.list_course_catalogue(query=first_crn)} == {first_crn}
    assert store.list_course_catalogue(query=second_crn) == []
    assert store.list_course_catalogue(query=second_crn, include_obsolete=True)[0]["isObsolete"] is True
