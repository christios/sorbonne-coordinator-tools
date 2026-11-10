"""Syllabi that say everything the template requires, for tests that need one to submit."""

from copy import deepcopy
from typing import Any

_SCEN: dict[str, Any] = {
    "identification": {
        "ects": "6",
        "degreeLevelAndSemester": "Licence 1, Semester 2",
        "programmeTitle": "Bachelor of Science in Physics",
        "contactHours": {"Lectures": "30", "Tutorials": "15"},
    },
    "contacts": {
        "instructor": {"Name": "A Professor", "Email": "professor@sorbonne.ae"},
        "administrativeContact": {"name": "A Coordinator", "contactDetails": "coordinator@sorbonne.ae"},
    },
    "description": {"overview": "Light as rays."},
    "delivery": {"mode": "Blended Learning Delivery", "faceToFacePercent": "80", "onlinePercent": "20"},
    "learningOutcomes": {"plos": [], "clos": [{"id": "clo-1", "clo": "Trace rays.", "ploIds": ["plo-1"]}]},
    "schedule": [
        {"id": "session-1", "week": "1", "topic": "Reflection"},
        {
            "id": "essay",
            "kind": "graded",
            "week": "1",
            "name": "Essay",
            "type": "Essay",
            "weight": "40",
            "cloIds": ["clo-1"],
            "aiPolicy": "AI Permitted as a Support Tool",
        },
        {
            "id": "exam",
            "kind": "graded",
            "week": "15",
            "name": "Final exam",
            "type": "Written exam",
            "weight": "60",
            "cloIds": ["clo-1"],
            "aiPolicy": "AI Prohibited",
        },
    ],
    "teachingApproach": {"methods": "Lectures.", "engagement": "Questions.", "feedback": "Marked work."},
    "assessment": {
        "items": [],
        "methodologies": "Written work.",
        "lateSubmissionPolicy": "Ten percent a day.",
        "aiVerificationMechanism": "An oral check.",
        "aiAllowedUses": ["Brainstorming or generating initial ideas"],
    },
    "schemaVersion": 2,
}

_FYS: dict[str, Any] = {
    "courseDetails": {"semester": "Semester 1", "courseWeight": "20%", "totalContactHours": "45"},
    "facultyDetails": {"staff": [{"nameAndStatus": "A Professor, Lecturer", "email": "professor@sorbonne.ae"}]},
    "delivery": {"mode": "Blended Learning Delivery", "faceToFacePercent": "100", "onlinePercent": "0"},
    "description": {"overview": "Mechanics."},
    "learningOutcomes": {"clos": [], "closText": "One.\nTwo.\nThree.\nFour."},
    "requiredMaterials": {"textbooks": "A textbook."},
    "teachingMethodologies": {"methods": {"Lectures": {"selected": True, "hours": "30"}}},
    "assessment": {},
    "schedule": [
        {"id": "session-1", "week": "1", "topic": "Forces"},
        {
            "id": "quiz",
            "kind": "graded",
            "week": "4",
            "component": "continuous:In class assignment",
            "description": "Quiz on forces",
            "weight": "100",
            "cloNumbers": ["1", "2"],
        },
    ],
    "schemaVersion": 2,
}


def complete_scen_content() -> dict[str, Any]:
    return deepcopy(_SCEN)


def complete_fys_content() -> dict[str, Any]:
    return deepcopy(_FYS)
