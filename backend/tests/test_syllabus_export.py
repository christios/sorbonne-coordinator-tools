import json
from pathlib import Path

from docx import Document

from sorbonne.api.syllabi import _export_filename
from sorbonne.services.syllabus_export import build_syllabus_docx, template_sections
from sorbonne.services.syllabus_projection import document_projection


EXPANDED_PLO_TABLE_ROW_COUNT = 8
CLO_TABLE_COLUMN_COUNT = 4
LEGACY_CONTACT = "Name: Mrs Sample Contact\\nContact details: s.contact@sorbonne.ae"


def test_builds_a_filled_template_with_repeatable_course_content(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Climate Change Law and Policy",
        "courseCode": "PublicAffairs585",
        "academicYear": "2026-2027",
        "content": {
            "identification": {
                "degreeLevelAndSemester": "Bachelor 3, Semester 2",
                "programmeTitle": "Bachelor in Public Affairs",
                "ects": "6",
                "contactHours": {"Lectures": "20", "Workshops": "30"},
                "prerequisiteItems": [{"id": "prereq-1", "text": "Introduction to public policy"}],
                "equipmentItems": [{"id": "equipment-1", "text": "Laptop"}],
            },
            "contacts": {
                "instructor": {
                    "Name": "M. Modele Syllabus",
                    "Academic rank / status": "Associate Professor",
                    "affiliations": [{"id": "affiliation-1", "name": "Sorbonne University Abu Dhabi"}],
                    "officeHours": [
                        {
                            "id": "office-hour-1",
                            "day": "Tuesday",
                            "startTime": "10:00",
                            "endTime": "12:00",
                            "location": "A6-117",
                        }
                    ],
                    "Email": "m.syllabus@sorbonne.ae",
                },
                "administrativeContact": {"name": "Mrs Sample Contact", "contactDetails": "s.contact@sorbonne.ae"},
            },
            "description": {"overview": "An applied course on climate governance."},
            "delivery": {"mode": "Blended Learning Delivery", "faceToFacePercent": "70", "onlinePercent": "30"},
            "learningOutcomes": {
                "plos": [{"id": "plo-1", "code": "PLO 1", "outcome": "Evaluate climate policy."}],
                "clos": [
                    {
                        "id": "clo-1",
                        "clo": "CLO 1: Analyse climate law.",
                        "plo": "PLO 1: Evaluate climate policy.",
                        "skills": "Critical reasoning",
                    }
                ],
            },
            "schedule": [
                {
                    "id": "session-1",
                    "sessionType": "CM",
                    "week": "1",
                    "topic": "Climate governance",
                    "details": "Institutions, actors, and implementation pathways.",
                    "preClass": "Read chapter 1",
                    "assessments": "Short quiz",
                }
            ],
            "bibliography": {
                "books": [
                    {
                        "id": "book-1",
                        "authors": "A. Author",
                        "title": "Climate Law",
                        "year": "2026",
                        "publisher": "Press",
                    }
                ],
                "websites": [
                    {
                        "id": "website-1",
                        "organisation": "UNFCCC",
                        "url": "https://unfccc.int",
                        "accessedDate": "2026-07-23",
                    }
                ],
                "journalArticles": [
                    {
                        "id": "article-1",
                        "authors": "B. Author",
                        "title": "Climate governance",
                        "journal": "Policy Review",
                        "year": "2026",
                        "doi": "https://doi.org/example",
                    }
                ],
            },
            "teachingApproach": {
                "methods": "Case studies",
                "engagement": "Seminar discussion",
                "feedback": "Written feedback",
            },
            "assessment": {
                "items": [
                    {
                        "id": "assessment-1",
                        "date": "2026-10-10",
                        "type": "Policy brief",
                        "weight": "40",
                        "clos": "CLO 1: Analyse climate law.",
                        "aiPolicy": "AI Prohibited",
                    }
                ],
                "aiPolicy": "AI Prohibited",
                "aiVerificationMechanism": "Oral follow-up discussion",
                "aiInstructions": "Cite all sources.",
                "methodologies": "Written policy analysis",
                "rubrics": [
                    {
                        "id": "rubric-1",
                        "assignment": "Policy brief",
                        "criteria": [
                            {
                                "id": "criterion-1",
                                "criterion": "Analysis",
                                "inadequate": "Limited",
                                "meets": "Sound",
                                "exceeds": "Excellent",
                            }
                        ],
                    }
                ],
                "lateSubmissionPolicy": "Late work is subject to the course policy.",
            },
            "documentControl": {
                "creationDate": "2026-07-23",
                "departmentName": "SCEN",
                "approvalDate": "2026-09-01",
                "versionNumber": "1.0",
                "approver": "Head of Department",
            },
        },
    }

    output = tmp_path / "syllabus.docx"
    build_syllabus_docx(syllabus, output)

    document = Document(output)
    assert document.tables[0].cell(0, 1).text == "2026-2027"
    assert document.tables[0].cell(1, 1).text == "Climate Change Law and Policy"
    assert document.tables[1].cell(0, 1).text == "M. Modele Syllabus"
    assert document.tables[5].cell(1, 1).text == "Evaluate climate policy."
    assert document.tables[6].cell(1, 0).text == "CLO 1: Analyse climate law."
    # Week leads and the session carries its kind, as the department writes it.
    assert document.tables[7].cell(0, 0).text == "Week"
    assert document.tables[7].cell(1, 0).text == "1"
    assert document.tables[7].cell(1, 1).text == "CM 1"
    assert document.tables[7].cell(1, 2).text == (
        "Climate governance\nInstitutions, actors, and implementation pathways."
    )
    assert (
        document.tables[7].cell(1, 3).text
        == "Pre-class learning activities:\nRead chapter 1\n\nAssessments:\nShort quiz"
    )
    assert "A. Author" in document.tables[8].cell(0, 1).text
    assert document.tables[9].cell(1, 1).text == "Policy brief"
    assert "☒" in document.tables[10].cell(1, 1).text
    assert "Oral follow-up discussion" in document.tables[10].cell(1, 1).text
    assert document.tables[11].cell(0, 0).text == "Assessment type: Policy brief"
    assert document.tables[13].cell(0, 1).text == "23/07/2026"


def test_expands_outcome_rows_and_accepts_legacy_string_lists(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Environmental Policy",
        "courseCode": "SCEN-220",
        "academicYear": "2026-2027",
        "content": {
            "learningOutcomes": {
                "plos": [f"PLO {index}: Outcome {index}" for index in range(1, 8)],
            }
        },
    }
    output = tmp_path / "expanded-syllabus.docx"

    build_syllabus_docx(syllabus, output)

    document = Document(output)
    assert len(document.tables[5].rows) == EXPANDED_PLO_TABLE_ROW_COUNT
    assert document.tables[5].cell(6, 1).text == "Outcome 6"
    assert document.tables[5].cell(7, 1).text == "Outcome 7"


def test_keeps_legacy_administrative_contact_text_readable(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Environmental Policy",
        "courseCode": "SCEN-220",
        "academicYear": "2026-2027",
        "content": {
            "contacts": {
                "administrativeContact": LEGACY_CONTACT
            }
        },
    }
    output = tmp_path / "legacy-contact-syllabus.docx"

    build_syllabus_docx(syllabus, output)

    document = Document(output)
    assert document.tables[2].cell(0, 1).text.strip() == LEGACY_CONTACT


def test_prints_the_delivery_split_for_a_face_to_face_course(tmp_path) -> None:
    """A face-to-face course records 100 / 0; the table must not come out blank."""
    syllabus = {
        "courseTitle": "Mechanics",
        "courseCode": "PHYS125",
        "academicYear": "2026-2027",
        "content": {
            "delivery": {"mode": "Face-to-Face Delivery", "faceToFacePercent": "100", "onlinePercent": "0"},
        },
    }
    output = tmp_path / "syllabus.docx"

    build_syllabus_docx(syllabus, output)

    delivery = Document(output).tables[4]
    assert delivery.cell(2, 0).text.strip() == "☒"
    assert delivery.cell(2, 1).text.strip() == "100%"
    assert delivery.cell(2, 2).text.strip() == "0%"


def test_reports_scen_and_suad_competencies_in_separate_columns(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Mechanics",
        "courseCode": "PHYS125",
        "academicYear": "2026-2027",
        "content": {
            "learningOutcomes": {
                "clos": [
                    {
                        "clo": "Solve mechanics problems.",
                        "plo": "PLO 1",
                        "skills": "SCEN-C6 Communication",
                        "suadSkills": "GradComp 4 — Critical reasoning",
                    }
                ]
            }
        },
    }
    output = tmp_path / "syllabus.docx"

    build_syllabus_docx(syllabus, output)

    table = Document(output).tables[6]
    assert len(table.columns) == CLO_TABLE_COLUMN_COUNT
    assert table.rows[0].cells[2].text.strip() == "SCEN Graduate Competencies"
    assert table.rows[0].cells[3].text.strip() == "SUAD Graduate Competencies"
    assert table.rows[1].cells[2].text.strip() == "SCEN-C6 Communication"
    assert table.rows[1].cells[3].text.strip() == "GradComp 4 — Critical reasoning"


def test_numbers_course_outcomes_that_are_not_numbered_already(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Mechanics",
        "courseCode": "PHYS125",
        "academicYear": "2026-2027",
        "content": {
            "learningOutcomes": {
                "clos": [{"clo": "Solve mechanics problems."}, {"clo": "CLO 2. Already numbered."}]
            }
        },
    }
    output = tmp_path / "syllabus.docx"

    build_syllabus_docx(syllabus, output)

    table = Document(output).tables[6]
    assert table.rows[1].cells[0].text.strip() == "CLO 1: Solve mechanics problems."
    assert table.rows[2].cells[0].text.strip() == "CLO 2. Already numbered."


def test_export_filename_leads_with_the_course_code() -> None:
    name = _export_filename(
        {"courseTitle": "Mechanics Physics 1", "courseCode": "PHYS125", "academicYear": "2026-2027"}
    )

    assert name == "PHYS125-Mechanics-Physics-1-2026-2027.docx"


def test_the_template_prints_the_sections_the_preview_claims_to_cover() -> None:
    """The export preview is a second rendering of one document, so it must not fall behind it.

    RENDERED in SyllabusExportPreview.tsx lists the headings the preview draws. If a
    section is added to the approved template and not to the preview, this fails rather
    than the preview quietly omitting it.
    """
    rendered = _rendered_preview_sections()

    for heading in template_sections("scen-en-v1"):
        assert any(heading.startswith(prefix) for prefix in rendered), f"the preview does not render {heading!r}"


def _rendered_preview_sections() -> list[str]:
    source = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "SyllabusExportPreview.tsx"
    ).read_text(encoding="utf-8")
    block = source.split("export const RENDERED = [", 1)[1].split("];", 1)[0]
    return [item.strip().strip('",') for item in block.replace("\n", " ").split(",") if item.strip().strip('",')]


def test_the_document_says_what_the_shared_fixture_expects(tmp_path) -> None:
    """The document is one of two renderings held against the same expectation.

    The preview is the other (syllabusProjection.test.ts). Comparing both to this
    fixture is what makes "the preview matches the template" checkable per cell.
    """
    fixture = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "syllabus-export-parity.json").read_text())
    expected = fixture.pop("expected")
    output = tmp_path / "syllabus.docx"

    build_syllabus_docx(fixture, output)

    assert document_projection(Document(output)) == expected


def test_a_session_written_with_formatting_reaches_the_document_with_it(tmp_path) -> None:
    """A professor who wrote a heading and a numbered list should get them, not one flat run."""
    syllabus = {
        "courseTitle": "Geometric optics",
        "courseCode": "PHYS-118",
        "academicYear": "2026-2027",
        "content": {
            "schedule": [
                {
                    "id": "session-1",
                    "sessionType": "CM",
                    "week": "1",
                    "topic": "The laws of geometric optics",
                    "details": (
                        "<h3>Part I</h3>"
                        "<p>Read <strong>chapter 1</strong> beforehand</p>"
                        "<ol><li>The nature of light</li><li>The speed of light</li></ol>"
                    ),
                }
            ]
        },
    }

    output = tmp_path / "schedule.docx"
    build_syllabus_docx(syllabus, output)
    cell = Document(str(output)).tables[7].rows[1].cells[2]
    lines = [paragraph.text for paragraph in cell.paragraphs if paragraph.text]

    assert lines == [
        "The laws of geometric optics",
        "Part I",
        "Read chapter 1 beforehand",
        "1. The nature of light",
        "2. The speed of light",
    ]
    heading = next(p for p in cell.paragraphs if p.text == "Part I")
    assert all(run.bold for run in heading.runs)
    emphasised = next(p for p in cell.paragraphs if p.text.startswith("Read "))
    assert [(run.text, bool(run.bold)) for run in emphasised.runs] == [
        ("Read ", False),
        ("chapter 1", True),
        (" beforehand", False),
    ]


def test_a_session_written_before_formatting_existed_still_reads_as_written(tmp_path) -> None:
    syllabus = {
        "courseTitle": "Geometric optics",
        "courseCode": "PHYS-118",
        "academicYear": "2026-2027",
        "content": {
            "schedule": [
                {"id": "session-1", "topic": "Ray tracing", "details": "Week 1\nTwo-hour session"}
            ]
        },
    }

    output = tmp_path / "legacy.docx"
    build_syllabus_docx(syllabus, output)
    cell = Document(str(output)).tables[7].rows[1].cells[2]

    assert [p.text for p in cell.paragraphs if p.text] == ["Ray tracing", "Week 1", "Two-hour session"]
