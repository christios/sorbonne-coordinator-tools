from docx import Document

from sorbonne.services.requisition_export import build_requisition_docx


def test_builds_an_editable_teaching_requisition_with_total_hours(tmp_path) -> None:
    requisition = {
        "employeeName": "Dr Amira Example",
        "academicYear": "2026-2027",
        "content": {
            "department": "Department of Sciences and Engineering",
            "program": "Bachelor in Physics",
            "jobTitle": "Part Time Lecturer",
            "classType": "TD",
            "employeeType": "PT",
            "contractFrom": "2026-08-31",
            "contractTo": "2026-12-31",
            "courses": [
                {
                    "subjectCode": "PHY",
                    "courseNumber": "101",
                    "level": "L1",
                    "title": "Mechanics",
                    "hours": "24",
                },
                {
                    "subjectCode": "PHY",
                    "courseNumber": "102",
                    "level": "L1",
                    "title": "Waves",
                    "hours": "12 TD",
                },
            ],
        },
    }

    output = tmp_path / "requisition.docx"
    build_requisition_docx(requisition, output)

    document = Document(output)
    assert document.tables[0].cell(1, 1).text == "Dr Amira Example"
    assert document.tables[0].cell(8, 1).text == "36"
    assert document.tables[1].cell(1, 3).text == "Mechanics"
    assert document.tables[1].cell(2, 4).text == "12 TD"
    assert "HR / Finance / approval fields are intentionally left blank" in document.paragraphs[-1].text
