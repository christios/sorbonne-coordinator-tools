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
