"""Reading a syllabus's content the same way wherever it is read.

Since the November 2026 review the course schedule is where graded activities live: a
schedule card is either a session or a graded activity (content `schemaVersion` 2).
Syllabi written before that keep them in `assessment.items` (no `schemaVersion`). Every
feature that needs "the graded activities" — the 9.1 summary, the rubrics, the AI
policy — asks here, so the switch from one place to the other happens once.
"""

from __future__ import annotations

from copy import deepcopy
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


def course_ai_fallback(content: dict[str, Any]) -> str:
    """The one course-wide AI policy a syllabus written before November 2026 set.

    Until such a syllabus is converted, an activity without an option of its own applies it.
    Converting gives each activity that policy as its own, so a converted syllabus has none
    to fall back on — the old value stays stored only so the conversion can be undone.
    """
    if schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES:
        return ""
    assessment = content.get("assessment")
    course = assessment.get("aiPolicy") if isinstance(assessment, dict) else None
    return course.strip() if isinstance(course, str) else ""


def activity_ai_policy(activity: dict[str, Any], fallback: str = "") -> str:
    """The AI option an activity applies: its own, or the course-wide one an older syllabus set."""
    own = activity.get("aiPolicy") or activity.get("ai")
    if isinstance(own, str) and own.strip():
        return own.strip()
    return fallback


def ai_policy_summary(activity: dict[str, Any], fallback: str = "") -> str:
    """What the 9.1 summary prints in the activity's "Applicable AI policy" column."""
    policy = activity_ai_policy(activity, fallback)
    if ai_option(policy) == OTHER_AI_OPTION:
        written = activity.get("aiOtherText")
        return f"Other: {written.strip()}" if isinstance(written, str) and written.strip() else policy
    return policy


def ai_options_in_use(activities: list[dict[str, Any]], fallback: str = "") -> list[str]:
    """The template options at least one graded activity applies, in the template's order."""
    used = {ai_option(activity_ai_policy(activity, fallback)) for activity in activities}
    return [option for option in AI_OPTIONS if option in used]


def template_permitted_use(use: str) -> str:
    """A permitted use as the template words it."""
    return _LEGACY_PERMITTED_USES.get(" ".join(use.split()).casefold(), use)


def _has_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def convert_to_schedule_cards(content: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Move a syllabus's graded activities into its course schedule (November 2026 review).

    Each item of `assessment.items` becomes a graded card in `schedule`, with the same id —
    so its field history follows it — and every field it had. An activity that relied on
    the course-wide AI policy gets that policy as its own. Nothing is taken away: the old
    list, the course-wide policy and each session's old deadline and assessment notes stay
    stored, so the change can be undone by going back to the previous code. A syllabus
    already converted is returned as it is.

    Returns the new content and what changed, for the report a dry run shows.
    """
    report: dict[str, Any] = {"gradedActivities": 0, "withoutWeek": [], "inheritedAiPolicy": 0, "earlierNotes": 0}
    if schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES:
        return content, report
    converted = deepcopy(content)
    fallback = course_ai_fallback(content)
    schedule = [row for row in (converted.get("schedule") or []) if isinstance(row, dict)]
    report["earlierNotes"] = sum(
        1 for row in schedule if _has_text(row.get("assessments")) or _has_text(row.get("deadline"))
    )
    cards = []
    for position, item in enumerate(graded_activities(content), start=1):
        card = {**deepcopy(item), "kind": "graded"}
        if not _has_text(card.get("aiPolicy")) and not _has_text(card.get("ai")) and fallback:
            card["aiPolicy"] = card["ai"] = fallback
            report["inheritedAiPolicy"] += 1
        if not _has_text(str(card.get("week") or "")):
            name = card.get("name") or card.get("type") or f"Activity {position}"
            report["withoutWeek"].append(str(name).strip())
        cards.append(card)
    report["gradedActivities"] = len(cards)
    converted["schedule"] = [*schedule, *cards]
    converted["schemaVersion"] = SCHEDULE_HOLDS_GRADED_ACTIVITIES
    return converted, report
