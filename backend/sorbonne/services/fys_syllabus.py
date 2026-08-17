"""Foundation Year syllabus content and SCEN comparison normalisation."""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

INSTRUCTOR_AVAILABILITY_FIELD = (
    "Office Hours and Location Students are kindly asked to observe these office hours "
    "or to make an appointment for a different time"
)


def default_fys_content() -> dict[str, Any]:
    return {
        "courseDetails": {
            "foundationYear": "Sciences",
            "semester": "",
            "courseWeight": "",
            "totalContactHours": "",
            "contactHours": {},
            "prerequisites": "",
        },
        "facultyDetails": {
            "staff": [],
            "staffText": "",
            "email": "",
            "institution": "",
            "officeHours": "",
            "officePhone": "",
        },
        "signatures": {"courseInstructorName": "", "hodName": "", "hodApprovalDate": ""},
        "delivery": {"mode": "Blended Learning Delivery", "faceToFacePercent": "100", "onlinePercent": "0"},
        "description": {"overview": ""},
        "learningOutcomes": {"clos": [], "closText": ""},
        "requiredMaterials": {
            "textbooks": "",
            "supplementalResources": "",
            "books": [],
            "websites": [],
            "journalArticles": [],
            "equipment": "",
        },
        "teachingMethodologies": {"methods": {}, "notes": ""},
        "assessment": {
            "continuous": [],
            "final": [],
            "laboratory": [],
            "continuousText": "",
            "finalText": "",
            "laboratoryText": "",
        },
        "schedule": [],
    }


def convert_scen_to_fys(content: dict[str, Any]) -> dict[str, Any]:
    target = default_fys_content()
    identification = record(content.get("identification"))
    target["courseDetails"] = {
        **target["courseDetails"],
        "foundationYear": text(identification.get("programmeTitle")),
        "semester": text(identification.get("degreeLevelAndSemester")),
        "contactHours": {
            "Lectures": text(record(identification.get("contactHours")).get("Lectures")),
            "Tutorials / Labs": text(record(identification.get("contactHours")).get("Tutorials"))
            or text(record(identification.get("contactHours")).get("Laboratory")),
            "Other": text(record(identification.get("contactHours")).get("Other")),
        },
        "prerequisites": text(identification.get("prerequisites")),
    }
    target["requiredMaterials"]["equipment"] = text(identification.get("equipment"))
    instructor = record(record(content.get("contacts")).get("instructor"))
    target["facultyDetails"].update(
        {
            "staffText": instructor_name_and_status(instructor),
            "institution": affiliations(instructor),
            "officeHours": office_hours(instructor),
            "email": text(instructor.get("Email")),
        }
    )
    document_control = record(content.get("documentControl"))
    target["signatures"].update(
        {
            "courseInstructorName": text(instructor.get("Name")),
            "hodName": text(document_control.get("approver")),
            "hodApprovalDate": text(document_control.get("approvalDate")),
        }
    )
    target["delivery"] = {**target["delivery"], **record(content.get("delivery"))}
    target["description"] = {"overview": text(record(content.get("description")).get("overview"))}
    target["learningOutcomes"]["clos"] = [
        {"id": str(uuid4()), "outcome": text(row.get("clo"))}
        for row in rows(record(content.get("learningOutcomes")).get("clos"))
    ]
    bibliography = record(content.get("bibliography"))
    target["requiredMaterials"].update(
        {key: bibliography.get(key, []) for key in ("books", "websites", "journalArticles")}
    )
    target["schedule"] = [
        {"id": str(uuid4()), "topic": text(row.get("topic"))} for row in rows(content.get("schedule"))
    ]
    target["assessment"]["continuous"] = [
        {
            "id": str(uuid4()),
            "description": text(row.get("type")),
            "weight": text(row.get("weight")),
            "clos": text(row.get("clos")),
        }
        for row in rows(record(content.get("assessment")).get("items"))
    ]
    return target


def cross_template_rows(
    left_template: str, left: dict[str, Any], right_template: str, right: dict[str, Any]
) -> list[dict[str, Any]]:
    left_scen = left_template == "scen-en-v1"
    scen, fys = (left, right) if left_scen else (right, left)
    scen_identification = record(scen.get("identification"))
    fys_details = record(fys.get("courseDetails"))
    scen_instructor = record(record(scen.get("contacts")).get("instructor"))
    fys_faculty = record(fys.get("facultyDetails"))
    mapped = [
        ("Academic context", text(scen_identification.get("programmeTitle")), text(fys_details.get("foundationYear"))),
        ("Semester", text(scen_identification.get("degreeLevelAndSemester")), text(fys_details.get("semester"))),
        ("Course description", value(scen, "description.overview"), value(fys, "description.overview")),
        ("Delivery mode", value(scen, "delivery.mode"), value(fys, "delivery.mode")),
        ("Face-to-face (%)", value(scen, "delivery.faceToFacePercent"), value(fys, "delivery.faceToFacePercent")),
        ("Online (%)", value(scen, "delivery.onlinePercent"), value(fys, "delivery.onlinePercent")),
        (
            "Prerequisites and co-requisites",
            text(scen_identification.get("prerequisites")),
            text(fys_details.get("prerequisites")),
        ),
        ("Equipment", text(scen_identification.get("equipment")), value(fys, "requiredMaterials.equipment")),
        (
            "Contact hours · Lectures",
            contact_hour(scen_identification, "Lectures"),
            contact_hour(fys_details, "Lectures"),
        ),
        (
            "Contact hours · Tutorials / labs",
            combined_contact_hours(scen_identification, "Tutorials", "Laboratory"),
            contact_hour(fys_details, "Tutorials / Labs"),
        ),
        ("Contact hours · Other", contact_hour(scen_identification, "Other"), contact_hour(fys_details, "Other")),
        (
            "Instructor name and status",
            instructor_name_and_status(scen_instructor),
            fys_staff_name_and_status(fys_faculty),
        ),
        ("Instructor affiliation / institution", affiliations(scen_instructor), text(fys_faculty.get("institution"))),
        ("Instructor office hours", office_hours(scen_instructor), text(fys_faculty.get("officeHours"))),
        ("Instructor email", text(scen_instructor.get("Email")), text(fys_faculty.get("email"))),
        ("Approval date", value(scen, "documentControl.approvalDate"), value(fys, "signatures.hodApprovalDate")),
        ("Approver / HoD", value(scen, "documentControl.approver"), value(fys, "signatures.hodName")),
    ]
    for index, (scen_row, fys_row) in enumerate(
        zip(
            rows(record(scen.get("learningOutcomes")).get("clos")),
            rows(record(fys.get("learningOutcomes")).get("clos")),
            strict=False,
        ),
        start=1,
    ):
        mapped.append((f"Course learning outcome {index}", text(scen_row.get("clo")), text(fys_row.get("outcome"))))
    for index, (scen_row, fys_row) in enumerate(
        zip(rows(scen.get("schedule")), rows(fys.get("schedule")), strict=False), start=1
    ):
        mapped.append((f"Course schedule · Topic {index}", text(scen_row.get("topic")), text(fys_row.get("topic"))))
    for label, key in (("books", "Books"), ("websites", "Websites"), ("journalArticles", "Journal articles")):
        mapped.append(
            (
                f"Supplemental {key.lower()}",
                without_ids(value(scen, f"bibliography.{label}")),
                without_ids(value(fys, f"requiredMaterials.{label}")),
            )
        )
    for index, (scen_row, fys_row) in enumerate(
        zip(assessment_rows(scen), assessment_rows(fys), strict=False), start=1
    ):
        mapped.extend(
            [
                (f"Assessment {index} · Description", text(scen_row.get("type")), text(fys_row.get("description"))),
                (f"Assessment {index} · Weight", text(scen_row.get("weight")), text(fys_row.get("weight"))),
                (f"Assessment {index} · CLOs", assessment_clos(scen_row), assessment_clos(fys_row)),
            ]
        )
    rows_out = [
        comparison_row(
            label, left_value if left_scen else right_value, right_value if left_scen else left_value, "mapped"
        )
        for label, left_value, right_value in mapped
    ]
    rows_out.extend(
        one_sided_rows(
            "SCEN only",
            scen,
            "left-only" if left_scen else "right-only",
            {
                "identification.programmeTitle",
                "identification.degreeLevelAndSemester",
                "identification.prerequisites",
                "identification.equipment",
                "identification.contactHours",
                "contacts.instructor.Name",
                "contacts.instructor.Academic rank / status",
                "contacts.instructor.Academic Rank / Status",
                "contacts.instructor.Email",
                "contacts.instructor.Affiliation(s)",
                "contacts.instructor.affiliations",
                "contacts.instructor.Office hours and location",
                "contacts.instructor.officeHours",
                "description.overview",
                "delivery",
                "learningOutcomes.clos",
                "schedule",
                "bibliography",
                "assessment.items",
                "documentControl.approvalDate",
                "documentControl.approver",
            },
        )
    )
    rows_out.extend(
        one_sided_rows(
            "FYS only",
            fys,
            "right-only" if left_scen else "left-only",
            {
                "description.overview",
                "delivery",
                "learningOutcomes.clos",
                "schedule",
                "requiredMaterials.books",
                "requiredMaterials.websites",
                "requiredMaterials.journalArticles",
                "requiredMaterials.equipment",
                "courseDetails.foundationYear",
                "courseDetails.semester",
                "courseDetails.prerequisites",
                "courseDetails.contactHours",
                "facultyDetails.staffText",
                "facultyDetails.institution",
                "facultyDetails.officeHours",
                "facultyDetails.email",
                "assessment.continuous",
                "assessment.final",
                "assessment.laboratory",
                "signatures.hodApprovalDate",
                "signatures.hodName",
            },
        )
    )
    rows_out.extend(schedule_metadata_rows(scen, fys, left_scen))
    rows_out.extend(outcome_alignment_rows(scen, left_scen))
    rows_out.extend(assessment_component_rows(fys, left_scen))
    return [row for row in rows_out if row["left"] not in (None, "") or row["right"] not in (None, "")]


def comparison_row(label: str, left: Any, right: Any, status: str) -> dict[str, Any]:
    return {
        "id": label.lower().replace(" ", "-"),
        "label": label,
        "left": left,
        "right": right,
        "status": status,
        "kind": "unchanged" if left == right else "changed",
    }


def one_sided_rows(prefix: str, content: dict[str, Any], status: str, excluded: set[str]) -> list[dict[str, Any]]:
    return [
        comparison_row(
            humanize(path), value if status == "left-only" else None, None if status == "left-only" else value, status
        )
        for path, value in flattened(content)
        if not any(path == excluded_path or path.startswith(f"{excluded_path}.") for excluded_path in excluded)
        and value not in ({}, [], "")
    ]


def value(content: dict[str, Any], path: str) -> Any:
    current: Any = content
    for key in path.split("."):
        current = current.get(key) if isinstance(current, dict) else None
    return current


def record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def rows(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def text_at(content: dict[str, Any], *keys: str) -> str:
    return next((text(content.get(key)) for key in keys if text(content.get(key))), "")


def contact_hour(details: dict[str, Any], label: str) -> str:
    return text(record(details.get("contactHours")).get(label))


def combined_contact_hours(details: dict[str, Any], *labels: str) -> str:
    return " + ".join(value for label in labels if (value := contact_hour(details, label)))


def instructor_name_and_status(instructor: dict[str, Any]) -> str:
    return " · ".join(
        value
        for value in (
            text(instructor.get("Name")),
            text_at(instructor, "Academic rank / status", "Academic Rank / Status"),
        )
        if value
    )


def fys_staff_name_and_status(faculty: dict[str, Any]) -> str:
    if text(faculty.get("staffText")):
        return text(faculty.get("staffText"))
    staff = rows(faculty.get("staff"))
    return " · ".join(
        value
        for value in (text(staff[0].get("name")) if staff else "", text(staff[0].get("status")) if staff else "")
        if value
    )


def affiliations(instructor: dict[str, Any]) -> str:
    structured = [text(row.get("name")) for row in rows(instructor.get("affiliations"))]
    return "\n".join(value for value in structured if value) or text(instructor.get("Affiliation(s)"))


def office_hours(instructor: dict[str, Any]) -> str:
    structured = [
        " · ".join(
            value
            for value in (
                text(row.get("day")),
                text(row.get("startTime")),
                text(row.get("endTime")),
                text(row.get("location")),
            )
            if value
        )
        for row in rows(instructor.get("officeHours"))
    ]
    return "\n".join(value for value in structured if value) or text(instructor.get("Office hours and location"))


def without_ids(value: Any) -> Any:
    if isinstance(value, list):
        return [without_ids(item) for item in value]
    if isinstance(value, dict):
        return {key: without_ids(item) for key, item in value.items() if key != "id"}
    return value


def assessment_rows(content: dict[str, Any]) -> list[dict[str, Any]]:
    assessment = record(content.get("assessment"))
    if "items" in assessment:
        return rows(assessment.get("items"))
    return [row for group in ("continuous", "final", "laboratory") for row in rows(assessment.get(group))]


def assessment_clos(row: dict[str, Any]) -> str:
    clos = row.get("clos")
    if isinstance(clos, str):
        return clos
    return "\n".join(item for item in clos if isinstance(item, str)) if isinstance(clos, list) else ""


def schedule_metadata_rows(scen: dict[str, Any], fys: dict[str, Any], left_scen: bool) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for index, row in enumerate(rows(scen.get("schedule")), start=1):
        for key, label in (
            ("date", "Session date"),
            ("preClass", "Pre-class learning"),
            ("assessments", "Scheduled assessment"),
        ):
            output.append(
                comparison_row(
                    f"Schedule {index} · {label}", text(row.get(key)), None, "left-only" if left_scen else "right-only"
                )
            )
    for index, row in enumerate(rows(fys.get("schedule")), start=1):
        for key, label in (
            ("week", "Week"),
            ("session", "Session"),
            ("assessment", "Scheduled assessment"),
            ("assessmentDate", "Assessment date"),
        ):
            output.append(
                comparison_row(
                    f"Schedule {index} · {label}", None, text(row.get(key)), "right-only" if left_scen else "left-only"
                )
            )
    return output


def outcome_alignment_rows(scen: dict[str, Any], left_scen: bool) -> list[dict[str, Any]]:
    output = [
        comparison_row(
            "Programme learning outcomes",
            without_ids(record(scen.get("learningOutcomes")).get("plos")),
            None,
            "left-only" if left_scen else "right-only",
        )
    ]
    for index, row in enumerate(rows(record(scen.get("learningOutcomes")).get("clos")), start=1):
        for key, label in (("plos", "PLO alignment"), ("skills", "Graduate competencies")):
            output.append(
                comparison_row(f"CLO {index} · {label}", row.get(key), None, "left-only" if left_scen else "right-only")
            )
    return output


def assessment_component_rows(fys: dict[str, Any], left_scen: bool) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for index, row in enumerate(assessment_rows(fys), start=1):
        output.append(
            comparison_row(
                f"Assessment {index} · FYS component",
                text(row.get("component")),
                None,
                "right-only" if left_scen else "left-only",
            )
        )
    return output


def flattened(value: Any, path: str = "") -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        return [item for key, child in value.items() for item in flattened(child, f"{path}.{key}" if path else key)]
    if isinstance(value, list):
        return [(path, value)]
    return [(path, value)]


def humanize(path: str) -> str:
    labels = {
        "aiPolicy": "AI policy",
        "courseWeight": "Course weight",
        "officePhone": "Office phone",
        INSTRUCTOR_AVAILABILITY_FIELD: "Instructor availability note",
    }
    key = path.rstrip(".").rsplit(".", 1)[-1]
    return labels.get(key, re.sub(r"(?<=[a-z])(?=[A-Z])", " ", key).replace("_", " ").title())
