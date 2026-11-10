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
        cards = [
            card for card in (schedule if isinstance(schedule, list) else [])
            if isinstance(card, dict) and card.get("kind") == "graded"
        ]
        # In the order the schedule shows them: by week, then by date, undated last.
        return sorted(cards, key=lambda card: (_week_order(card), not card.get("date"), str(card.get("date") or "")))
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


DEFAULT_SESSION_TYPE = "CM"


def _week_order(row: dict[str, Any]) -> float:
    week = str(row.get("week") or "").strip()
    return int(week) if week.isdigit() else float("inf")


def _display_date(value: Any) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if len(text) == len("2026-09-14") and text[4] == "-" and text[7] == "-":
        return f"{text[8:10]}/{text[5:7]}/{text[0:4]}"
    return text


def _lines(*parts: Any) -> str:
    return "\n".join(part.strip() for part in parts if isinstance(part, str) and part.strip())


def document_schedule(content: dict[str, Any]) -> list[dict[str, Any]]:
    """The course schedule as the document prints it: one row per line of section 6.

    Each row carries the session label the document shows ("CM 2", counted per kind of
    session) under `session`. A syllabus written before November 2026 prints as it always
    has. Once the schedule holds the graded activities, its sessions print in week order and
    each graded activity goes in the Assessment and Date columns of the last session of its
    week — or, in a week with no session, on a row of its own. A session's old assessment
    and deadline notes still print with it until the teacher removes them.
    """
    stored = [row for row in (content.get("schedule") or []) if isinstance(row, dict)]
    converted = schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES
    sessions = [row for row in stored if row.get("kind") != "graded"] if converted else stored
    if converted:
        sessions = sorted(sessions, key=_week_order)
    counts: dict[str, int] = {}
    printed: list[dict[str, Any]] = []
    for row in sessions:
        kind = str(row.get("sessionType") or "").strip() or DEFAULT_SESSION_TYPE
        counts[kind] = counts.get(kind, 0) + 1
        printed.append({**row, "session": f"{kind} {counts[kind]}"})
    if not converted:
        return printed
    graded = sorted(
        (row for row in stored if row.get("kind") == "graded"),
        # By week, then by date, an undated one after the dated ones of its week.
        key=lambda card: (_week_order(card), not card.get("date"), str(card.get("date") or "")),
    )
    for card in graded:
        name = str(card.get("name") or card.get("type") or "Graded activity").strip()
        when = _display_date(card.get("date"))
        week = str(card.get("week") or "").strip()
        home = next(
            (
                row
                for row in reversed(printed)
                if not row.get("ownRow") and week and str(row.get("week") or "").strip() == week
            ),
            None,
        )
        if home is None:
            printed.append(
                {"week": week, "session": "", "topic": name, "ownRow": True, "assessments": name, "deadline": when}
            )
            continue
        home["assessments"] = _lines(home.get("assessments"), name)
        home["deadline"] = _lines(home.get("deadline"), when)
    return sorted(printed, key=_week_order)


# The Foundation Year form's assessment tables (November 2026: filled from graded cards).
# A card's `component` names its row: "continuous:<row>", "final", or "laboratory:<row>".
FYS_CONTINUOUS_ROWS = ("In class assignment", "In class presentation", "Report / homework assignment", "Other")
FYS_LABORATORY_ROWS = ("Report / homework assignment", "Lab exam")


def fys_component_rows(activities: list[dict[str, Any]]) -> dict[str, list[dict[str, str]]]:
    """The Foundation Year assessment tables as the form prints them, from its graded cards.

    Continuous and laboratory tables have one row per component the form lists; the cards of
    one component share its row (descriptions one per line, outcomes once each, weights
    added up). The final assessment has a row per card.
    """

    def joined(cards: list[dict[str, Any]]) -> dict[str, str]:
        weights = [float(card["weight"]) for card in cards if _is_number(card.get("weight"))]
        total = sum(weights)
        clos: list[str] = []
        for card in cards:
            for clo in _clo_numbers(card):
                if clo not in clos:
                    clos.append(clo)
        return {
            "description": _lines(*(str(card.get("description") or card.get("name") or "") for card in cards)),
            "clos": ", ".join(clos),
            "weight": (f"{total:g}%" if weights else ""),
        }

    by_component: dict[str, list[dict[str, Any]]] = {}
    for card in activities:
        by_component.setdefault(str(card.get("component") or ""), []).append(card)
    return {
        "continuous": [
            {"component": row, **joined(by_component.get(f"continuous:{row}", []))} for row in FYS_CONTINUOUS_ROWS
        ],
        "final": [joined([card]) for card in by_component.get("final", [])],
        "laboratory": [
            {"component": row, **joined(by_component.get(f"laboratory:{row}", []))} for row in FYS_LABORATORY_ROWS
        ],
    }


def _is_number(value: Any) -> bool:
    try:
        float(str(value).strip())
    except ValueError:
        return False
    return bool(str(value).strip())


def _clo_numbers(card: dict[str, Any]) -> list[str]:
    """A Foundation Year card names its outcomes by number ("1", "3"), as its form does."""
    numbers = card.get("cloNumbers")
    return [f"CLO {number}" for number in numbers] if isinstance(numbers, list) else []


def convert_fys_to_schedule_cards(content: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Give a Foundation Year syllabus the same shape: graded activities as schedule cards.

    Rows its assessment tables already had (a syllabus copied from a bachelor one) become
    cards, matched to the form's component rows. Text typed into the old free-text boxes
    cannot be split into cards; it is kept, untouched, and shown to the teacher to move
    across — the free-text schedule under `earlierSchedule`, the rest where it was.
    """
    report: dict[str, Any] = {"gradedActivities": 0, "withoutWeek": [], "inheritedAiPolicy": 0, "earlierNotes": 0}
    if schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES:
        return content, report
    converted = deepcopy(content)
    schedule = converted.get("schedule")
    if isinstance(schedule, dict):
        converted["earlierSchedule"] = schedule
        report["earlierNotes"] += 1 if _has_text(schedule.get("scheduleText")) else 0
        schedule = []
    sessions = [row for row in (schedule or []) if isinstance(row, dict)]
    assessment = converted.get("assessment") if isinstance(converted.get("assessment"), dict) else {}
    report["earlierNotes"] += sum(
        1 for key in ("continuousText", "finalText", "laboratoryText") if _has_text(assessment.get(key))
    )
    cards = []
    for table, rows in (("continuous", FYS_CONTINUOUS_ROWS), ("final", ()), ("laboratory", FYS_LABORATORY_ROWS)):
        for item in assessment.get(table) or []:
            if not isinstance(item, dict):
                continue
            named = str(item.get("component") or "").strip().casefold()
            fallback = "Other" if table == "continuous" else rows[0] if rows else ""
            row = next((row for row in rows if row.casefold() == named), fallback)
            component = table if table == "final" else f"{table}:{row}"
            cards.append(
                {
                    "id": str(item.get("id") or f"{table}-{len(cards) + 1}"),
                    "kind": "graded",
                    "week": "",
                    "date": "",
                    "component": component,
                    "name": str(item.get("description") or "").strip(),
                    "description": str(item.get("description") or "").strip(),
                    "weight": str(item.get("weight") or "").strip().rstrip("%"),
                    "earlierClos": str(item.get("clos") or "").strip(),
                }
            )
            report["withoutWeek"].append(cards[-1]["name"] or component)
    report["gradedActivities"] = len(cards)
    converted["schedule"] = [*sessions, *cards]
    converted["schemaVersion"] = SCHEDULE_HOLDS_GRADED_ACTIVITIES
    return converted, report


# The template's contact-hour rows, in its order, and the session type each one adds up
# (Christian, 10 Nov 2026: the hours come from the course schedule, not from boxes in section 1).
CONTACT_HOUR_ROWS = ("Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other")
SESSION_TYPE_ROWS = {
    "CM": "Lectures",
    "TD": "Tutorials",
    "Workshop": "Workshops",
    "Seminar": "Seminars",
    "TP": "Laboratory",
    "Other": "Other",
}
# What a session card shows, and prints, when nobody chose its type.
DEFAULT_SESSION_TYPE = "CM"


def session_hours(row: dict[str, Any]) -> float | None:
    """A session's length in hours, or None when it has none (a comma is read as a decimal point)."""
    raw = str(row.get("duration") or "").strip().replace(",", ".")
    try:
        hours = float(raw)
    except ValueError:
        return None
    return hours if hours > 0 else None


def contact_hours(content: dict[str, Any]) -> dict[str, str]:
    """The contact hours the document prints, row by row: the course schedule's sessions added up.

    Each session counts its length under its type's row; graded activities do not count. A
    syllabus none of whose sessions has a length yet keeps printing the hours typed into
    section 1 before November 2026, so its export does not go blank before its teacher has
    been through the schedule.
    """
    sessions = [row for row in content.get("schedule") or [] if isinstance(row, dict) and row.get("kind") != "graded"]
    timed = [(row, hours) for row in sessions if (hours := session_hours(row)) is not None]
    if not timed:
        identification = content.get("identification")
        typed = identification.get("contactHours") if isinstance(identification, dict) else None
        typed = typed if isinstance(typed, dict) else {}
        return {row: str(typed.get(row) or "").strip() for row in CONTACT_HOUR_ROWS}
    totals = dict.fromkeys(CONTACT_HOUR_ROWS, 0.0)
    for row, hours in timed:
        totals[SESSION_TYPE_ROWS.get(str(row.get("sessionType") or DEFAULT_SESSION_TYPE), "Other")] += hours
    return {row: (f"{total:g}" if total else "") for row, total in totals.items()}

