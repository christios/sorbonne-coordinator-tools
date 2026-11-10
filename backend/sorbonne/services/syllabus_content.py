"""Reading a syllabus's content the same way wherever it is read.

Since the November 2026 review the course schedule is where graded activities live: a
schedule card is either a session or a graded activity (content `schemaVersion` 2).
Syllabi written before that keep them in `assessment.items` (no `schemaVersion`). Every
feature that needs "the graded activities" — the 9.1 summary, the rubrics, the AI
policy — asks here, so the switch from one place to the other happens once.
"""

from __future__ import annotations

from typing import Any

SCHEDULE_HOLDS_GRADED_ACTIVITIES = 2


def schema_version(content: dict[str, Any]) -> int:
    version = content.get("schemaVersion")
    return version if isinstance(version, int) else 1


def graded_activities(content: dict[str, Any]) -> list[dict[str, Any]]:
    """The syllabus's graded activities, in the order the syllabus keeps them."""
    if schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES:
        schedule = content.get("schedule")
        return [
            card for card in (schedule if isinstance(schedule, list) else [])
            if isinstance(card, dict) and card.get("kind") == "graded"
        ]
    assessment = content.get("assessment")
    items = assessment.get("items") if isinstance(assessment, dict) else None
    return [item for item in (items if isinstance(items, list) else []) if isinstance(item, dict)]


# The five options of the template's AI policy table (section 9.3), in its row order. Every
# graded activity applies one of them (November 2026 review); the catalogue's entries carry
# the same labels and record their row.
AI_OPTIONS = (
    "AI Prohibited",
    "AI Permitted as a Support Tool",
    "Restricted AI Use",
    "AI Required",
    "Other (Specify)",
)
OTHER_AI_OPTION = AI_OPTIONS[4]

# Uses the builder once offered in its own words; the template's checkboxes are worded
# differently, so an older choice is matched to the box it meant.
_LEGACY_PERMITTED_USES = {
    "language editing": "Language editing (grammar, spelling, style, and readability)",
    "structuring or organising ideas": "Structuring or organizing ideas",
}


def ai_option(label: Any) -> str:
    """The template option a stored label names, or "" when it names none of them."""
    wanted = " ".join(str(label).split()).casefold() if isinstance(label, str) else ""
    return next((option for option in AI_OPTIONS if option.casefold() == wanted), "")


def activity_ai_policy(activity: dict[str, Any], assessment: dict[str, Any]) -> str:
    """The AI option an activity applies: its own, or the one course-level policy older syllabi set."""
    own = activity.get("aiPolicy") or activity.get("ai")
    if isinstance(own, str) and own.strip():
        return own.strip()
    course = assessment.get("aiPolicy")
    return course.strip() if isinstance(course, str) else ""


def ai_policy_summary(activity: dict[str, Any], assessment: dict[str, Any]) -> str:
    """What the 9.1 summary prints in the activity's "Applicable AI policy" column."""
    policy = activity_ai_policy(activity, assessment)
    if ai_option(policy) == OTHER_AI_OPTION:
        written = activity.get("aiOtherText")
        return f"Other: {written.strip()}" if isinstance(written, str) and written.strip() else policy
    return policy


def ai_options_in_use(activities: list[dict[str, Any]], assessment: dict[str, Any]) -> list[str]:
    """The template options at least one graded activity applies, in the template's order."""
    used = {ai_option(activity_ai_policy(activity, assessment)) for activity in activities}
    return [option for option in AI_OPTIONS if option in used]


def template_permitted_use(use: str) -> str:
    """A permitted use as the template words it."""
    return _LEGACY_PERMITTED_USES.get(" ".join(use.split()).casefold(), use)
