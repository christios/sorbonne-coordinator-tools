"""Turning blocks and group assignments into the enrolments a semester publishes.

A cohort is split into **scopes** — the kinds of teaching it is divided by, CM, TD, the
language block. Each scope offers **groups**, and a group holds one CRN per course in that
scope. A student is assigned to one group per scope, so their enrolment is the union of the
CRNs of the groups they are in. That is the whole rule, and everything here is a consequence
of it.

Two things then need saying out loud before anybody publishes:

- **Who is not ready.** A student with no group for a scope is not a student with a smaller
  timetable — they are a student who will not be taught something, and publishing quietly
  would hide it. So they are counted, per scope, and named.
- **Which CRNs are real.** A group's CRN is typed by a coordinator or read out of a workbook,
  and nothing has ever checked it against the timetable. `validate` compares each one to the
  sections the timetable actually holds, which is what puts a tick beside it.

Pure: no database, no network. The store hands it rows, the API hands it sections.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Scope:
    """One way a cohort is divided, for one semester."""

    id: str
    cohort_id: str
    code: str
    name: str = ""


@dataclass(frozen=True)
class Group:
    """A block: one of the ways to be taught a scope, carrying a CRN per course."""

    id: str
    scope_id: str
    label: str
    crns: dict[str, str] = field(default_factory=dict)  # course code -> CRN


@dataclass(frozen=True)
class Section:
    """A teaching section as the timetable publishes it."""

    crn: str
    code: str
    kind: str = ""
    group_label: str = ""


def resolve(
    *,
    scopes: list[Scope],
    groups: list[Group],
    assignments: dict[tuple[str, str], str],
) -> dict[str, list[str]]:
    """Every student's CRNs. `assignments` is `(student id, scope id) -> group id`."""
    groups_by_id = {group.id: group for group in groups}
    scope_ids = {scope.id for scope in scopes}

    enrolments: dict[str, set[str]] = {}
    for (student, scope_id), group_id in assignments.items():
        if scope_id not in scope_ids:
            continue  # a scope from another semester; not this publication's business
        group = groups_by_id.get(group_id)
        if group is None:
            continue
        enrolments.setdefault(student, set()).update(crn for crn in group.crns.values() if crn)

    return {student: sorted(crns) for student, crns in sorted(enrolments.items()) if crns}


def readiness(  # noqa: PLR0913 - one keyword per thing a cohort needs to be ready
    *,
    cohort_name: str,
    students: list[str],
    scopes: list[Scope],
    groups: list[Group],
    course_codes: dict[str, list[str]],
    assignments: dict[tuple[str, str], str],
) -> dict[str, Any]:
    """What stands between this cohort and being publishable, in a coordinator's terms.

    `course_codes` is `scope id -> [course code]`, so a group can be told it is missing a CRN
    for a course its scope teaches.
    """
    groups_by_scope: dict[str, list[Group]] = {}
    for group in groups:
        groups_by_scope.setdefault(group.scope_id, []).append(group)

    warnings: list[str] = []
    unassigned: dict[str, list[str]] = {}

    for scope in scopes:
        label = scope.name or scope.code
        offered = groups_by_scope.get(scope.id, [])
        if not offered:
            warnings.append(f"{label} has no groups yet")
            continue

        missing = [
            student for student in students if (student, scope.id) not in assignments
        ]
        if missing:
            unassigned[scope.code] = sorted(missing)
            warnings.append(f"{len(missing)} with no {label} group")

        for group in offered:
            absent = [code for code in course_codes.get(scope.id, []) if not group.crns.get(code)]
            if absent:
                warnings.append(f"{label} {group.label} has no CRN for {', '.join(sorted(absent))}")

    resolved = resolve(scopes=scopes, groups=groups, assignments=assignments)
    return {
        "cohort": cohort_name,
        "students": len(students),
        "studentsResolved": len([student for student in students if resolved.get(student)]),
        "unassigned": unassigned,
        "warnings": warnings,
        "isReady": not warnings,
    }


def validate(*, groups: list[Group], sections: list[Section]) -> dict[str, dict[str, Any]]:
    """Each group's CRNs against the timetable: `"group id|course code" -> verdict`.

    A CRN that is not in the timetable cannot enrol anybody, so it is the difference between
    a block that works and one that silently teaches nobody. A CRN that *is* there but under
    a different course code is the subtler failure — a typo that lands on a real section of
    the wrong subject — and is worth naming separately.
    """
    by_crn = {section.crn: section for section in sections}
    verdicts: dict[str, dict[str, Any]] = {}

    for group in groups:
        for course_code, crn in group.crns.items():
            key = f"{group.id}|{course_code}"
            if not crn:
                verdicts[key] = {"status": "missing", "detail": "No CRN yet."}
                continue
            section = by_crn.get(crn)
            if section is None:
                verdicts[key] = {
                    "status": "unknown",
                    "detail": f"CRN {crn} is not in this semester's timetable.",
                }
                continue
            if not _codes_agree(section.code, course_code):
                verdicts[key] = {
                    "status": "mismatched",
                    "detail": f"CRN {crn} is {section.code} in the timetable, not {course_code}.",
                    "section": _section_payload(section),
                }
                continue
            verdicts[key] = {"status": "matched", "detail": "", "section": _section_payload(section)}

    return verdicts


def _section_payload(section: Section) -> dict[str, str]:
    return {
        "crn": section.crn,
        "code": section.code,
        "kind": section.kind,
        "groupLabel": section.group_label,
    }


def _codes_agree(section_code: str, course_code: str) -> bool:
    """The timetable's code carries its section: MATH-001-TD-GR.3 is the course MATH-001.

    Compared on letters and digits only, because the two systems disagree about separators
    and case far more often than they disagree about the course.
    """
    section = _normalise(section_code)
    course = _normalise(course_code)
    return bool(course) and section.startswith(course)


def _normalise(code: str) -> str:
    return "".join(character for character in code.upper() if character.isalnum())
