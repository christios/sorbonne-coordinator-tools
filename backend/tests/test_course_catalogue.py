import os
from uuid import uuid4

from sorbonne.services.teacher_store import TeacherStore
import importlib.util as _importlib_util
from pathlib import Path as _Path

from sorbonne.services.teacher_store import _academic_year, _sequence_rank, course_title_case

_spec = _importlib_util.spec_from_file_location(
    "sweep_titles",
    _Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0050_sweep_bound_syllabus_titles.py",
)
_module = _importlib_util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
corrected_title = _module.corrected_title


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
        {
            "crn": first_crn,
            "term": "262710",
            "courseCode": "PHY-101",
            "courseTitle": "Physics",
            "sequence": "1",
            "credit": "4",
            "department": "PHY",
            "level": "L1",
            "college": "P4",
            "contactHours": "30",
        },
        {
            "crn": second_crn,
            "term": "262710",
            "courseCode": "MAT-101",
            "courseTitle": "Mathematics",
            "sequence": "1",
            "credit": "4",
            "department": "MAT",
            "level": "L1",
            "college": "P4",
            "contactHours": "30",
        },
    ]
    store.import_course_catalogue(rows)

    result = store.import_course_catalogue([rows[0]])

    assert result["retained"] == 1
    assert result["obsoleted"] == 1
    assert {entry["crn"] for entry in store.list_course_catalogue(query=first_crn)} == {first_crn}
    assert store.list_course_catalogue(query=second_crn) == []
    assert store.list_course_catalogue(query=second_crn, include_obsolete=True)[0]["isObsolete"] is True


def test_reads_the_academic_year_out_of_the_portal_term_code() -> None:
    """Nothing the portal sends says the year in words; the term code carries it."""
    assert _academic_year("262710") == "2026-2027"
    assert _academic_year("252620") == "2025-2026"
    assert _academic_year("") == ""
    assert _academic_year("not-a-term") == ""


def test_raises_a_course_title_without_disturbing_what_is_already_capitalised() -> None:
    """A syllabus takes its title from here, so the registrar's inconsistency shows."""
    assert course_title_case("Geometric optics") == "Geometric Optics"
    assert course_title_case("AI and critical thinking") == "AI and Critical Thinking"
    # Acronyms and deliberate capitals are the registrar's, and are left alone.
    assert course_title_case("AI Law & Governance") == "AI Law & Governance"
    assert course_title_case("CAO-DAO") == "CAO-DAO"
    assert course_title_case("ADGM M2") == "ADGM M2"


def test_sweeps_only_a_bound_title_that_differs_by_capitalisation() -> None:
    """A coordinator's own wording must survive the sweep untouched."""
    assert corrected_title("geometric OPTICS", "Geometric optics") == "Geometric Optics"
    # Already right, so nothing to write.
    assert corrected_title("Geometric Optics", "Geometric optics") == ""
    # A different title is the coordinator's, however the catalogue words it.
    assert corrected_title("Optics for Engineers", "Geometric optics") == ""
    assert corrected_title("", "Geometric optics") == ""



def test_the_course_takes_its_name_from_the_portal_s_lowest_numbered_row() -> None:
    """The portal numbers a course's rows; the lowest is the course, the rest its sections."""
    rows = [("1", "Geometric Optics -CM"), ("0", "Geometric Optics"), ("4", "Geometric Optics -TD")]
    assert min(rows, key=lambda row: _sequence_rank(*row))[1] == "Geometric Optics"

    # Where several rows share the lowest number, the shortest name is the course's.
    shared = [("0", "Economie Publique GR1"), ("0", "Economie Publique"), ("0", "Economie Publique GR2")]
    assert min(shared, key=lambda row: _sequence_rank(*row))[1] == "Economie Publique"

    # A course whose rows start at 1 still resolves.
    from_one = [("2", "GESTION TD Gr1"), ("1", "GESTION")]
    assert min(from_one, key=lambda row: _sequence_rank(*row))[1] == "GESTION"
