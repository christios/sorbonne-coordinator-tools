from pathlib import Path

import pytest

from sorbonne.services.roster_converter import convert_course_roster_pdf


SAMPLE_PDF = Path("/Users/chriscay/Downloads/PHYS 0 -GA.pdf")
MATH_SAMPLE_PDF = Path("/Users/chriscay/Downloads/MATH 0008- GA.pdf")


@pytest.mark.skipif(not SAMPLE_PDF.exists(), reason="sample Course Class Roster PDF is not available")
def test_converts_course_class_roster_pdf() -> None:
    result = convert_course_roster_pdf(SAMPLE_PDF.read_bytes(), source_filename=SAMPLE_PDF.name)

    assert result.page_count == 3
    assert len(result.rows) == 54
    assert result.course_info.course_code == "PHYS-015"
    assert result.course_info.crn == "23683"
    assert result.course_info.major is None
    assert result.rows[1].student_name == "Abdulhaleem Saeed Mohamed Ali Alnufaili"
    assert result.rows[-1].number == 54
    assert result.to_xlsx_bytes().startswith(b"PK")


@pytest.mark.skipif(not MATH_SAMPLE_PDF.exists(), reason="sample MATH Course Class Roster PDF is not available")
def test_converts_course_class_roster_with_decimal_absences() -> None:
    result = convert_course_roster_pdf(MATH_SAMPLE_PDF.read_bytes(), source_filename=MATH_SAMPLE_PDF.name)

    assert result.page_count == 3
    assert len(result.rows) == 54
    assert result.course_info.course_code == "MATH-008"
    assert result.course_info.crn == "23530"
    assert result.rows[0].hours_of_absences == 9.25
    assert result.rows[0].absence_percent == "15.42%"
    assert result.rows[-1].number == 54
