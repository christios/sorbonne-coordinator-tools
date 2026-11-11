"""What a syllabus still lacks before it can be submitted for review (November 2026 review).

One list of rules, here on the server: the editor shows what it returns, and submitting for
review is refused while anything is missing. Drafts are never blocked: a teacher can save
and export an incomplete syllabus. Each item names the screen section it belongs to, so
the editor can take the teacher there.

CONFIRMED: Christian reviewed the required-fields checklist on 10 Nov 2026
(docs/plans/required-fields-checklist.md). Over the proposal he made required the
instructor's academic rank, each CLO's SCEN competencies, and each session's details and
type. Changing a rule is a change to this file, that list and the tests.
"""

from __future__ import annotations

import re
from typing import Any

from sorbonne.services.syllabus_content import (
    OTHER_AI_OPTION,
    SCHEDULE_HOLDS_GRADED_ACTIVITIES,
    activity_ai_policy,
    ai_option,
    ai_options_in_use,
    course_ai_fallback,
    graded_activities,
    schema_version,
    session_hours,
)
from sorbonne.services.syllabus_templates import FYS_TEMPLATE_ID

TOTAL_PERCENT = 100
FYS_FEWEST_CLOS = 4
FYS_MOST_CLOS = 6
QUOTED_LENGTH = 50
QUOTED_NAMES = 3
# What the library calls a new syllabus until its course is chosen (frontend: UNTITLED_SYLLABUS).
UNTITLED_SYLLABUS = "Untitled syllabus"
HOD_HAS_NOT_WRITTEN = "The Head of Department has not written this course's learning outcomes yet."

Missing = list[dict[str, Any]]


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return str(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else ""


def _ids(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [line for line in _text(value).split("\n") if line.strip()]


def _plain(value: Any) -> str:
    """Rich text with its tags and spacing taken out: empty when nothing was written."""
    return " ".join(re.sub(r"<[^>]*>", " ", _text(value)).replace("&nbsp;", " ").split())


def _number(value: Any) -> float | None:
    try:
        return float(_text(value).rstrip("%").strip())
    except ValueError:
        return None


def _add(  # noqa: PLR0913 - the list, where, what, and the three optional pointers to cards
    missing: Missing,
    section: str,
    message: str,
    *,
    items: list[dict[str, str]] | None = None,
    need: str | None = None,
    summary: str | None = None,
) -> None:
    """One thing still to fill in. Since 11 Nov 2026 a gap in schedule cards also names them.

    `items` are the cards concerned ({"id", "label"}), so the list can open each one; `need`
    is what is missing in a word or two ("week", "CLOs assessed"); `summary` says it shortly for
    many cards at once ("15 sessions without a week"). All three are optional additions: the
    message stays the whole sentence, for any reader that knows nothing else.
    """
    entry: dict[str, Any] = {"section": section, "message": message}
    if items:
        entry["items"] = items
    if need:
        entry["need"] = need
    if summary:
        entry["summary"] = summary
    missing.append(entry)


def missing_for_submission(
    syllabus: dict[str, Any],
    content: dict[str, Any],
    *,
    outcome_mode: str = "teacher",
    expected_plos: dict[str, str] | None = None,
    programme_has_plos: bool = True,
) -> Missing:
    """Everything a syllabus must still say before it can go for review, in screen order.

    `content` is the syllabus as the document prints it (the catalogue's parts resolved).
    `expected_plos` maps each PLO the curriculum mapping expects of the course, by id, to the
    code the teacher sees; None or empty when the course is not mapped. `programme_has_plos`
    is False for a programme with no PLOs to align to, such as the Foundation Year's.
    """
    missing: Missing = []
    if syllabus.get("templateId") == FYS_TEMPLATE_ID:
        _fys_details(missing, content)
        _fys_outcomes(missing, content, outcome_mode)
        _fys_materials(missing, content)
        if schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES:
            _sessions(missing, content, flag_earlier_notes=False)
            _fys_graded(missing, content)
        return missing
    _identification(missing, syllabus, content)
    _contacts(missing, content)
    _description(missing, content)
    _outcomes(missing, content, outcome_mode, expected_plos or {}, programme_has_plos=programme_has_plos)
    converted = schema_version(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES
    _sessions(missing, content, flag_earlier_notes=converted)
    _graded(missing, content, "schedule" if converted else "assessment", week_required=converted)
    _assessment(missing, content)
    return missing


def _identification(missing: Missing, syllabus: dict[str, Any], content: dict[str, Any]) -> None:
    identification = _record(content.get("identification"))
    for key, label in (
        ("courseCode", "course code"),
        ("courseTitle", "course title"),
        ("academicYear", "academic year"),
    ):
        # A new syllabus is "Untitled syllabus" until its course is chosen (10 Nov 2026).
        if _text(syllabus.get(key)) in ("", UNTITLED_SYLLABUS):
            _add(missing, "identification", f"Give the {label}.")
    if not _text(identification.get("degreeLevelAndSemester")):
        _add(missing, "identification", "Give the degree level and semester.")
    if not (_text(identification.get("catalogueProgrammeId")) or _text(identification.get("programmeTitle"))):
        _add(missing, "identification", "Choose the programme.")
    if not _text(identification.get("ects")):
        _add(missing, "identification", "Give the number of ECTS.")


def _contacts(missing: Missing, content: dict[str, Any]) -> None:
    contacts = _record(content.get("contacts"))
    first = (_rows(contacts.get("instructors")) or [_record(contacts.get("instructor"))])[0]
    from_directory = bool(_text(first.get("personId")))
    if not (from_directory or _text(first.get("Name"))):
        _add(missing, "contacts", "Name the course instructor.")
    if not (from_directory or _text(first.get("Email"))):
        _add(missing, "contacts", "Give the course instructor's email.")
    # Ticked required by Christian, 10 Nov 2026. Someone chosen from People brings the
    # directory's rank, resolved onto `contacts.instructor`; a teacher cannot type it there.
    resolved = _record(contacts.get("instructor"))
    rank = next(
        (
            _text(record.get(key))
            for record in (first, resolved)
            for key in ("Academic rank / status", "Academic Rank / Status")
            if _text(record.get(key))
        ),
        "",
    )
    if not rank:
        _add(
            missing,
            "contacts",
            "Ask an administrator to add the course instructor's academic rank in People."
            if from_directory
            else "Give the course instructor's academic rank / status.",
        )
    coordinator = contacts.get("administrativeContact")
    named = _record(coordinator)
    if not (_text(named.get("personId")) or _text(named.get("name")) or _text(coordinator)):
        _add(missing, "contacts", "Choose the academic coordinator.")


def _description(missing: Missing, content: dict[str, Any]) -> None:
    if not _text(_record(content.get("description")).get("overview")):
        _add(missing, "description", "Write the course description.")
    delivery = _record(content.get("delivery"))
    if not _text(delivery.get("mode")):
        _add(missing, "description", "Choose the delivery mode.")
    elif delivery.get("mode") == "Blended Learning Delivery":
        split = (_number(delivery.get("faceToFacePercent")) or 0) + (_number(delivery.get("onlinePercent")) or 0)
        if split != TOTAL_PERCENT:
            _add(missing, "description", "Make the face-to-face and online shares add up to 100%.")


def _outcomes(
    missing: Missing,
    content: dict[str, Any],
    outcome_mode: str,
    expected_plos: dict[str, str],
    *,
    programme_has_plos: bool,
) -> None:
    clos = _rows(_record(content.get("learningOutcomes")).get("clos"))
    if outcome_mode == "hod":
        if not clos:
            _add(missing, "learningOutcomes", HOD_HAS_NOT_WRITTEN)
        # The Head of Department writes the CLOs; the competencies are still the teacher's.
        for position, clo in enumerate(clos, start=1):
            if not _ids(clo.get("skillIds")):
                _add(missing, "learningOutcomes", f"Choose the SCEN graduate competencies CLO {position} develops.")
        return
    if not clos:
        _add(missing, "learningOutcomes", "Write at least one course learning outcome.")
        return
    for position, clo in enumerate(clos, start=1):
        if not _text(clo.get("clo")):
            _add(missing, "learningOutcomes", f"Write CLO {position}.")
            continue
        if programme_has_plos and not _ids(clo.get("ploIds")):
            # A Foundation Year course's programme has no PLOs: nothing to align to.
            _add(missing, "learningOutcomes", f"Align CLO {position} to a programme learning outcome.")
        # Ticked required by Christian, 10 Nov 2026.
        if not (_ids(clo.get("skillIds")) or _text(clo.get("skills"))):
            _add(missing, "learningOutcomes", f"Choose the SCEN graduate competencies CLO {position} develops.")
    aligned = {plo for clo in clos for plo in _ids(clo.get("ploIds"))}
    unaligned = [code for plo_id, code in expected_plos.items() if plo_id not in aligned]
    if unaligned:
        _add(
            missing,
            "learningOutcomes",
            f"Align a course learning outcome to {', '.join(unaligned)}: the curriculum mapping expects it.",
        )


def _short(value: str) -> str:
    """A topic or a name as a message quotes it: its first line, at most a few words long."""
    line = " ".join(next((part for part in value.splitlines() if part.strip()), "").split())
    return line if len(line) <= QUOTED_LENGTH else f"{line[: QUOTED_LENGTH - 1].rstrip()}…"


def _some(names: list[str]) -> str:
    quoted = ", ".join(f'"{name}"' for name in names[:QUOTED_NAMES])
    return f"{quoted} and {len(names) - QUOTED_NAMES} more" if len(names) > QUOTED_NAMES else quoted


def _sessions(missing: Missing, content: dict[str, Any], *, flag_earlier_notes: bool) -> None:
    """Sessions are many and alike: one line per kind of gap, naming the first few."""
    sessions = [row for row in _rows(content.get("schedule")) if row.get("kind") != "graded"]
    if not sessions:
        _add(missing, "schedule", "Add the course's sessions to the schedule.")
        return
    def gap(rows: list[dict[str, Any]], message: str, need: str, summary: str) -> None:
        _add(missing, "schedule", message, items=[_session_item(row) for row in rows], need=need, summary=summary)

    untitled = [row for row in sessions if not _text(row.get("topic"))]
    if untitled:
        gap(
            untitled,
            f"Give {_count(len(untitled), 'session')} a topic.",
            "topic",
            f"{_count(len(untitled), 'session')} without a topic",
        )
    # The session card asks for a week; rows from older syllabi may carry a date instead.
    unplaced = [row for row in sessions if not (_text(row.get("week")) or _text(row.get("date")))]
    if unplaced:
        gap(
            unplaced,
            f"Give {_count(len(unplaced), 'session')} a week: {_some(_names(unplaced))}.",
            "week",
            f"{_count(len(unplaced), 'session')} without a week",
        )
    # The contact hours are the sessions' lengths added up (10 Nov 2026).
    untimed = [row for row in sessions if session_hours(row) is None]
    if untimed:
        gap(
            untimed,
            f"Give {_count(len(untimed), 'session')} a length in hours: {_some(_names(untimed))}.",
            "length",
            f"{_count(len(untimed), 'session')} without a length in hours",
        )
    # Ticked required by Christian, 10 Nov 2026. The details are rich text: an emptied box
    # still holds its tags. The session type needs no rule: a card without one shows, and
    # prints, the default CM.
    undetailed = [row for row in sessions if not _plain(row.get("details"))]
    if undetailed:
        gap(
            undetailed,
            f"Describe {_count(len(undetailed), 'session')} in its details: {_some(_names(undetailed))}.",
            "details",
            f"{_count(len(undetailed), 'session')} without details",
        )
    if flag_earlier_notes:
        noted = [row for row in sessions if _text(row.get("assessments")) or _text(row.get("deadline"))]
        if noted:
            gap(
                noted,
                f"Move the earlier notes into graded activities, or clear them ({_count(len(noted), 'session')}): "
                f"{_some(_names(noted))}.",
                "earlier notes",
                f"{_count(len(noted), 'session')} with earlier notes to move into graded activities or clear",
            )


def _session_name(row: dict[str, Any]) -> str:
    return _short(_text(row.get("topic"))) or "untitled"


def _names(rows: list[dict[str, Any]]) -> list[str]:
    return [_session_name(row) for row in rows]


def _session_item(row: dict[str, Any]) -> dict[str, str]:
    """A session card as the list links to it."""
    topic = _short(_text(row.get("topic")))
    return {"id": _text(row.get("id")), "label": topic or "Untitled session"}


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}{'s' if number != 1 else ''}"


def _activity_name(activity: dict[str, Any], position: int) -> str:
    """As the schedule names the card: its name, else its type, else its number."""
    name = _text(activity.get("name")) or _text(activity.get("type")) or _text(activity.get("description"))
    return _short(name) or f"Graded activity {position}"


def _graded(missing: Missing, content: dict[str, Any], section: str, *, week_required: bool) -> None:
    activities = graded_activities(content)
    if not activities:
        _add(missing, section, "Add the course's graded activities.")
        return
    fallback = course_ai_fallback(content)
    for position, activity in enumerate(activities, start=1):
        name = _activity_name(activity, position)
        card = [{"id": _text(activity.get("id")), "label": name}]

        def gap(message: str, need: str, card: list[dict[str, str]] = card) -> None:
            _add(missing, section, message, items=card, need=need)

        if week_required and not _text(activity.get("week")):
            gap(f'Give "{name}" a week.', "week")
        elif not (_text(activity.get("week")) or _text(activity.get("date"))):
            gap(f'Give "{name}" a date or a week.', "date or week")
        if not (_text(activity.get("assessmentTypeId")) or _text(activity.get("type"))):
            gap(f'Choose the assessment type of "{name}".', "assessment type")
        if _number(activity.get("weight")) is None:
            gap(f'Give the weight of "{name}".', "weight")
        # A syllabus written before CLOs were picked by id names them as text, which still prints.
        if not (_ids(activity.get("cloIds")) or _ids(activity.get("catalogueCloIds")) or _text(activity.get("clos"))):
            gap(f'Say which course learning outcomes "{name}" assesses.', "CLOs assessed")
        policy = activity_ai_policy(activity, fallback)
        if not policy:
            gap(f'Choose the AI policy of "{name}".', "AI policy")
        elif ai_option(policy) == OTHER_AI_OPTION and not _text(activity.get("aiOtherText")):
            gap(f'Describe the AI policy of "{name}".', "AI policy described")
    _weights_add_up(missing, section, activities)


def _weights_add_up(missing: Missing, section: str, activities: list[dict[str, Any]]) -> None:
    weights = [_number(activity.get("weight")) for activity in activities]
    total = sum(weight for weight in weights if weight is not None)
    if round(total, 6) != TOTAL_PERCENT:
        _add(missing, section, f"Make the graded activities' weights add up to 100% (they add up to {total:g}%).")



def _assessment(missing: Missing, content: dict[str, Any]) -> None:
    assessment = _record(content.get("assessment"))
    if not _text(assessment.get("methodologies")):
        _add(missing, "assessment", "Describe the assessment methodologies.")
    if not _text(assessment.get("lateSubmissionPolicy")):
        _add(missing, "assessment", "Give the late submission policy.")
    in_use = ai_options_in_use(graded_activities(content), course_ai_fallback(content))
    if "AI Prohibited" in in_use and not _text(assessment.get("aiVerificationMechanism")):
        _add(missing, "assessment", "Say how the use of AI is checked where it is prohibited.")
    other_uses = [_text(_record(use).get("text")) for use in assessment.get("aiOtherUses") or []]
    if "AI Permitted as a Support Tool" in in_use and not (
        assessment.get("aiAllowedUses") or any(other_uses) or _text(assessment.get("aiOtherUse"))
    ):
        _add(missing, "assessment", "Tick the uses of AI permitted as a support tool.")


def _fys_details(missing: Missing, content: dict[str, Any]) -> None:
    details = _record(content.get("courseDetails"))
    for key, label in (
        ("semester", "semester"),
        ("courseWeight", "weight of the course in the semester's grade"),
        ("totalContactHours", "course contact hours"),
    ):
        if not _text(details.get(key)):
            _add(missing, "courseDetails", f"Give the {label}.")
    # Chosen from the People directory (`staff` rows), or typed into the editor's boxes.
    faculty = _record(content.get("facultyDetails"))
    staff = _rows(faculty.get("staff"))
    from_directory = bool(_text(faculty.get("personId")))
    if not (
        from_directory
        or _text(faculty.get("staffText"))
        or any(_text(person.get("nameAndStatus")) for person in staff)
    ):
        _add(missing, "facultyDetails", "Name the course instructor.")
    if not (from_directory or _text(faculty.get("email")) or any(_text(person.get("email")) for person in staff)):
        _add(missing, "facultyDetails", "Give the course instructor's email.")
    if not _text(_record(content.get("delivery")).get("mode")):
        _add(missing, "description", "Choose the delivery mode.")
    if not _text(_record(content.get("description")).get("overview")):
        _add(missing, "description", "Write the course description.")


def _fys_outcomes(missing: Missing, content: dict[str, Any], outcome_mode: str) -> None:
    outcomes = _record(content.get("learningOutcomes"))
    rows = _rows(outcomes.get("clos"))
    if outcome_mode == "hod":
        if not rows:
            _add(missing, "learningOutcomes", HOD_HAS_NOT_WRITTEN)
        return
    count = len(rows) or len([line for line in _text(outcomes.get("closText")).splitlines() if line.strip()])
    if not FYS_FEWEST_CLOS <= count <= FYS_MOST_CLOS:
        _add(missing, "learningOutcomes", f"Write between 4 and 6 course learning outcomes (there are {count}).")


def _fys_materials(missing: Missing, content: dict[str, Any]) -> None:
    if not _text(_record(content.get("requiredMaterials")).get("textbooks")):
        _add(missing, "requiredMaterials", "List the textbooks and recommended reading.")
    # The editor offers the free text; the ticks only come from a converted bachelor syllabus.
    methodologies = _record(content.get("teachingMethodologies"))
    methods = _record(methodologies.get("methods"))
    if not (_text(methodologies.get("notes")) or any(_record(entry).get("selected") for entry in methods.values())):
        _add(missing, "teachingMethodologies", "Describe the teaching methods and hours.")


def _fys_graded(missing: Missing, content: dict[str, Any]) -> None:
    activities = graded_activities(content)
    if not activities:
        _add(missing, "schedule", "Add the course's graded activities to the teaching schedule.")
        return
    for position, activity in enumerate(activities, start=1):
        name = _activity_name(activity, position)
        card = [{"id": _text(activity.get("id")), "label": name}]

        def gap(message: str, need: str, card: list[dict[str, str]] = card) -> None:
            _add(missing, "schedule", message, items=card, need=need)

        if not _text(activity.get("week")):
            gap(f'Give "{name}" a week.', "week")
        if not _text(activity.get("component")):
            gap(f'Choose the row of the assessment form "{name}" fills.', "form row")
        if not _text(activity.get("description")):
            gap(f'Describe "{name}".', "description")
        if _number(activity.get("weight")) is None:
            gap(f'Give the weight of "{name}".', "weight")
        if not _ids(activity.get("cloNumbers")):
            gap(f'Say which course learning outcomes "{name}" measures.', "CLOs measured")
    _weights_add_up(missing, "schedule", activities)
