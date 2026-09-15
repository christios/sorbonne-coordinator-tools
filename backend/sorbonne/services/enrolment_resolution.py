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

from collections.abc import Sequence
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
class Major:
    """One sub-row of a group: a programme it holds, and what a student on it is taught."""

    id: str
    program: str
    # course code -> its CRNs, already resolved: the group's shared cells, with this
    # sub-row's own on top and the courses it is not taught struck out.
    crns: dict[str, list[str]] = field(default_factory=dict)
    # The courses this sub-row is not taught at all — its own word, so an absence here is
    # not a CRN nobody has typed yet.
    not_taught: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Group:
    """A block: one of the ways to be taught a scope, carrying a CRN per course."""

    id: str
    scope_id: str
    label: str
    # course code -> its CRNs, one per part. A list because a course split between two
    # professors is taught under a CRN each, and both are this group's. The cells shared
    # by everybody in the group; a sub-row may override or strike some of them.
    crns: dict[str, list[str]] = field(default_factory=dict)
    # The majors this group holds, each a sub-row with its own seats and its own reading
    # of the cells. Empty for a group that is one thing for everybody, which is every group
    # in Foundation Year. Where it is not empty, the group is closed to anyone else.
    majors: tuple[Major, ...] = ()

    def crns_for(self, major_id: str) -> dict[str, list[str]]:
        """What a student placed on this sub-row is taught; the shared cells when on none."""
        for major in self.majors:
            if major.id == major_id:
                return major.crns
        return self.crns

    @property
    def programs(self) -> frozenset[str]:
        return frozenset(major.program.strip().casefold() for major in self.majors if major.program.strip())


@dataclass(frozen=True)
class Section:
    """A teaching section as the timetable publishes it."""

    crn: str
    code: str
    kind: str = ""
    group_label: str = ""


#: A placement: the group, and the sub-row taken in it — blank for a group with none.
Placement = tuple[str, str]


def resolve(
    *,
    scopes: list[Scope],
    groups: list[Group],
    assignments: dict[tuple[str, str], Placement],
) -> dict[str, list[str]]:
    """Every student's CRNs. `assignments` is `(student id, scope id) -> (group id, major id)`.

    A student on a sub-row is taught what the sub-row comes to: the group's shared cells,
    with the sub-row's own on top and the courses it is not taught struck out. A student
    on no sub-row is taught the shared cells and nothing more.
    """
    groups_by_id = {group.id: group for group in groups}
    scope_ids = {scope.id for scope in scopes}

    enrolments: dict[str, set[str]] = {}
    for (student, scope_id), (group_id, major_id) in assignments.items():
        if scope_id not in scope_ids:
            continue  # a scope from another semester; not this publication's business
        group = groups_by_id.get(group_id)
        if group is None:
            continue
        enrolments.setdefault(student, set()).update(
            crn for crns in group.crns_for(major_id).values() for crn in crns if crn
        )

    return {student: sorted(crns) for student, crns in sorted(enrolments.items()) if crns}


def _programs_held(groups: list[Group], assignments: dict[tuple[str, str], Placement]) -> dict[str, set[str]]:
    """Which programmes each student is known to be in, from the sub-rows they sit on.

    The platform stores no student's major of its own; what it has is the sub-row a
    placement took. A student on the Mathematics sub-row of CM 1 is a mathematician, and
    that is the whole of the evidence.
    """
    program_of = {
        major.id: major.program.strip().casefold()
        for group in groups
        for major in group.majors
        if major.program.strip()
    }
    held: dict[str, set[str]] = {}
    for (student, _scope), (_group, major_id) in assignments.items():
        program = program_of.get(major_id)
        if program:
            held.setdefault(student, set()).add(program)
    return held


def _offered(groups: list[Group]) -> frozenset[str] | None:
    """The programmes a set is open to: None when any of its groups is open to everybody."""
    if any(not group.majors for group in groups):
        return None
    return frozenset(program for group in groups for program in group.programs)


def _belongs(student: str, offered: frozenset[str] | None, held: dict[str, set[str]]) -> bool:
    """Whether this student is somebody this set is for.

    Fail open, twice over: a set with a group open to everybody is for everyone, and a
    student the sub-rows say nothing about is expected everywhere. Only a student
    positively known to be in a programme no group of the set holds stops being expected
    — which is the difference between not asking a mathematician for a physics group and
    quietly forgetting a physicist.
    """
    if offered is None:
        return True
    theirs = held.get(student)
    if not theirs:
        return True
    return bool(offered & theirs)


def _teaches(group: Group, code: str) -> bool:
    """Whether this group is asked for a CRN in this course: unless every sub-row is not taught it."""
    if not group.majors:
        return True
    return any(code not in major.not_taught for major in group.majors)


def _has_crn(group: Group, code: str) -> bool:
    if group.crns.get(code):
        return True
    return any(major.crns.get(code) for major in group.majors)


def readiness(  # noqa: PLR0913 - one keyword per thing a cohort needs to be ready
    *,
    cohort_name: str,
    students: list[str],
    scopes: list[Scope],
    groups: list[Group],
    course_codes: dict[str, list[str]],
    assignments: dict[tuple[str, str], Placement],
    shared_scopes: Sequence[Scope] = (),
    shared_groups: Sequence[Group] = (),
) -> dict[str, Any]:
    """What stands between this cohort and being publishable, in a coordinator's terms.

    `course_codes` is `scope id -> [course code]`, so a group can be told it is missing a CRN
    for a course its scope teaches.

    `shared_scopes` and `shared_groups` are the sets open to every cohort — the languages,
    which sit on Foundation Year's row. A student of ANY cohort is placed in one, so every
    cohort must be asked who is missing from them: without this, seventeen students outside
    Foundation Year had no language group and nothing anywhere said so, while the same fact
    was reported for the four inside it.

    They are deliberately NOT asked the second question below, "has this group a CRN for
    every course of its set". That is the owning cohort's business and it already asks it;
    asking it once per cohort would repeat one gap four times over.

    Who a set is for is read off its groups' sub-rows. A set whose every group holds only
    physicists does not want every mathematician in the cohort listed as missing from it —
    on the real data that was 36 of L2's 44 students and 11 of L3's 16, which is not a
    worklist but a wall of noise in front of one. And a group is only asked for a CRN in a
    course some sub-row of it is taught.
    """
    every_group = [*groups, *shared_groups]
    groups_by_scope: dict[str, list[Group]] = {}
    for group in every_group:
        groups_by_scope.setdefault(group.scope_id, []).append(group)
    mine = _programs_held(every_group, assignments)

    warnings: list[str] = []
    unassigned: dict[str, list[str]] = {}

    for scope in [*scopes, *shared_scopes]:
        label = scope.name or scope.code
        offered = groups_by_scope.get(scope.id, [])
        if not offered:
            # Only of a set this cohort owns: a shared set with no groups is somebody
            # else's gap to fill, and saying so on every cohort says it four times.
            if scope in scopes:
                warnings.append(f"{label} has no groups yet")
            continue

        open_to = _offered(offered)
        missing = [
            student
            for student in students
            if (student, scope.id) not in assignments and _belongs(student, open_to, mine)
        ]
        if missing:
            unassigned[scope.code] = sorted(missing)
            warnings.append(f"{len(missing)} with no {label} group")

        # Whether a group has the CRNs its set teaches is the owning cohort's question.
        if scope not in scopes:
            continue
        for group in offered:
            absent = [
                code for code in course_codes.get(scope.id, []) if not _has_crn(group, code) and _teaches(group, code)
            ]
            if absent:
                warnings.append(f"{label} {group.label} has no CRN for {', '.join(sorted(absent))}")

    resolved = resolve(scopes=[*scopes, *shared_scopes], groups=every_group, assignments=assignments)
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

    The timetable is the registrar's own, swept section by section. So a CRN missing from
    it means one of two quite different things — the section has no room booked yet, or
    nobody has asked the registrar about it — and neither is "this CRN is wrong". The
    sentence says so: an absence here is a gap in what we have been told, not a fault in
    the planning, and the older wording ("not in this semester's timetable") read as an
    accusation against a CRN that is very often perfectly correct.

    A CRN that *is* there but under a different course code is the subtler failure — a typo
    that lands on a real section of the wrong subject — and that one IS a fault of ours,
    which is why it is named separately and said in the other direction.
    """
    by_crn = {section.crn: section for section in sections}
    verdicts: dict[str, dict[str, Any]] = {}

    for group in groups:
        # Every cell anybody in the group is taught: the shared ones and each sub-row's own.
        every: dict[str, list[str]] = {code: list(crns) for code, crns in group.crns.items()}
        for major in group.majors:
            for code, crns in major.crns.items():
                every[code] = sorted(set(every.get(code, [])) | set(crns))
        for course_code, crns in every.items():
            key = f"{group.id}|{course_code}"
            # One verdict per section, over every part of it. A section taught in two
            # halves has a CRN for each and the pill sits on the section, so the first
            # thing wrong with any part is what it reports — a section is not settled
            # while half of it is unaccounted for.
            verdicts[key] = _verdict_of(crns, course_code, by_crn)

    return verdicts


def _verdict_of(crns: list[str], course_code: str, by_crn: dict[str, Section]) -> dict[str, Any]:
    """The worst thing true of any part, and the matching section when all of them agree."""
    if not crns:
        return {"status": "missing", "detail": "No CRN yet."}
    settled: Section | None = None
    for crn in crns:
        section = by_crn.get(crn)
        if section is None:
            return {
                "status": "unknown",
                "detail": (
                    f"No timetable for CRN {crn} yet — the registrar has not been asked "
                    "about it, or has booked no room for it."
                ),
            }
        if not _codes_agree(section.code, course_code):
            return {
                "status": "mismatched",
                "detail": f"CRN {crn} is {section.code} in the timetable, not {course_code}.",
                "section": _section_payload(section),
            }
        settled = settled or section
    assert settled is not None
    return {"status": "matched", "detail": "", "section": _section_payload(settled)}


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
