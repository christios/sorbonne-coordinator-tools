import os
from uuid import uuid4

from sqlalchemy import text

from sorbonne.services.teacher_store import TeacherStore
import importlib.util as _importlib_util
from pathlib import Path as _Path

from sorbonne.services.teacher_store import _academic_year, _sequence_rank, course_title_case

_spec = _importlib_util.spec_from_file_location(
    "sweep_titles",
    _Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0052_sweep_bound_syllabus_titles.py",
)
_module = _importlib_util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
corrected_title = _module.corrected_title


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_test",
)


def _portal_course(store: TeacherStore, crn: str, term: str, code: str, title: str, status: str = "in_portal") -> None:
    """A row as a portal sync of Courses leaves it."""
    with store.engine.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO portal_courses (term_code, crn, course_code, title, sequence, credits, department,
                                               level, college, contact_hours, status, first_seen_at, last_seen_at)
                   VALUES (:term, :crn, :code, :title, '1', '4', 'PHY', 'L1', 'P4', '30', :status,
                           '2026-09-01T00:00:00+00:00', '2026-09-20T00:00:00+00:00')"""
            ),
            {"term": term, "crn": crn, "code": code, "title": title, "status": status},
        )


def _uploaded_course(store: TeacherStore, crn: str, term: str, code: str, title: str) -> None:
    """A row the retired spreadsheet upload left behind."""
    with store.engine.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO course_catalogue_entries (id, crn, term, course_code, course_title, sequence, credit,
                                                         department, level, college, contact_hours, is_obsolete,
                                                         imported_at, obsolete_at)
                   VALUES (:id, :crn, :term, :code, :title, '1', '4', 'PHY', 'L1', 'P4', '30', FALSE,
                           '2025-09-01T00:00:00+00:00', NULL)"""
            ),
            {"id": str(uuid4()), "crn": crn, "term": term, "code": code, "title": title},
        )


def test_the_course_list_is_the_portal_s_courses() -> None:
    """What a requisition picks from is what the Courses page shows, kept current by every sync."""
    store = TeacherStore(TEST_DATABASE_URL)
    crn = f"CRN-{uuid4()}"
    _portal_course(store, crn, "262710", "PHY-118", "Geometric Optics")

    [entry] = store.list_course_catalogue(query=crn)

    assert entry == {
        **entry,
        "crn": crn,
        "term": "262710",
        "courseCode": "PHY-118",
        "courseTitle": "Geometric Optics",
        "level": "L1",
        "contactHours": "30",
        "isObsolete": False,
        "obsoleteAt": None,
    }
    assert "2026-2027" in store.list_academic_years()
    by_code = store.list_courses_by_code(query="PHY-118")
    assert any(crn in course["crns"] for course in by_code)


def test_a_section_the_portal_has_dropped_is_no_longer_offered() -> None:
    store = TeacherStore(TEST_DATABASE_URL)
    crn = f"CRN-{uuid4()}"
    _portal_course(store, crn, "262710", "PHY-119", "Withdrawn", status="not_in_portal")

    assert store.list_course_catalogue(query=crn) == []
    assert store.list_course_catalogue(query=crn, include_obsolete=True)[0]["isObsolete"] is True


def test_an_earlier_upload_stays_for_terms_the_portal_has_not_synced() -> None:
    """A past year's syllabuses keep their courses; where both know a section, the portal's word wins."""
    store = TeacherStore(TEST_DATABASE_URL)
    old = f"CRN-{uuid4()}"
    both = f"CRN-{uuid4()}"
    _uploaded_course(store, old, "242510", "PHY-100", "Mechanics")
    _uploaded_course(store, both, "262710", "PHY-120", "Optics (as uploaded)")
    _portal_course(store, both, "262710", "PHY-120", "Optics")

    assert [entry["courseTitle"] for entry in store.list_course_catalogue(query=old)] == ["Mechanics"]
    assert [entry["courseTitle"] for entry in store.list_course_catalogue(query=both)] == ["Optics"]


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
