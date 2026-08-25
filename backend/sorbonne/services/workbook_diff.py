"""What a workbook would change about a semester, before any of it is written.

Every row carries the operation it stands for, so what the screen shows and what it
posts back are the same object: there is no second place where a tick is translated
into a change, and so no second place for the two to disagree.

Both uploads used to land on drop. That is fine the first time and wrong every time after:
a re-upload silently rewrote CRNs a coordinator had corrected by hand, and moved students
between groups without saying whose. Neither failure announces itself — a wrong CRN teaches
nobody, and a moved student simply finds themselves somewhere else.

So both now say what they would do and change only what is ticked. The rules are the same
ones the timetable review uses, for the same reason: nothing is pre-approved, and what is
left unticked keeps the value it has.

Neither diff proposes a removal. A group or a placement that is in the database but not in
the workbook is left alone — removing is a deliberate act elsewhere, so that an out-of-date
sheet can never take away a group somebody is sitting in.

Pure: the store hands it rows, the parser hands it a workbook.
"""

from __future__ import annotations

from typing import Any

# The catalogue, as the store reads it back: {scope code: {"name", "courses", "groups"}}
# where a group is {"id", "label", "capacity", "note", "crns": {course code: crn}}.
Catalogue = dict[str, dict[str, Any]]


def diff_reference(*, held: Catalogue, incoming) -> list[dict[str, Any]]:
    """One row per decision the Reference sheet would have somebody make.

    Rows are grouped by block so the screen can show them the way the matrix reads, and each
    carries everything `apply_reference` needs — the workbook is not consulted again.
    """
    blocks: list[dict[str, Any]] = []

    for scope in incoming.scopes:
        stored = held.get(scope.code.upper())
        rows: list[dict[str, Any]] = []
        unchanged = 0

        stored_courses = {code.upper() for code in (stored or {}).get("courses", {})}
        for course in scope.courses:
            if course.code.upper() not in stored_courses:
                rows.append(
                    {
                        "kind": "course",
                        "op": "addCourse",
                        "key": f"course|{scope.code}|{course.code}",
                        "status": "added",
                        "label": course.code,
                        "detail": course.name or "a course this block does not teach yet",
                        "scopeCode": scope.code,
                        "courseCode": course.code,
                        "courseName": course.name,
                        "component": course.component,
                    }
                )

        stored_groups = {
            label.upper(): group for label, group in (stored or {}).get("groups", {}).items()
        }
        for group in scope.groups:
            held_group = stored_groups.get(group.label.upper())
            if held_group is None:
                rows.append(
                    {
                        "kind": "group",
                        "op": "addGroup",
                        "key": f"group|{scope.code}|{group.label}",
                        "status": "added",
                        "label": f"Group {group.label}",
                        "detail": f"{len(group.crns)} CRN(s) come with it",
                        "scopeCode": scope.code,
                        "groupLabel": group.label,
                        "capacity": group.capacity,
                        "note": group.note,
                        "crns": {code: crn for code, (crn, _) in group.crns.items()},
                        "teachers": {code: teacher for code, (_, teacher) in group.crns.items()},
                    }
                )
                continue

            for course_code, (crn, teacher) in sorted(group.crns.items()):
                before = held_group.get("crns", {}).get(course_code, "")
                if before == crn:
                    unchanged += 1
                    continue
                rows.append(
                    {
                        "kind": "cell",
                        "op": "setCell",
                        "key": f"cell|{scope.code}|{group.label}|{course_code}",
                        "status": "changed" if before else "added",
                        "label": f"Group {group.label} · {course_code}",
                        "detail": f"CRN {before} → {crn}" if before else f"CRN {crn}",
                        "before": before,
                        "after": crn,
                        "scopeCode": scope.code,
                        "groupLabel": group.label,
                        "courseCode": course_code,
                        "teacher": teacher,
                    }
                )

        blocks.append(
            {
                "scopeCode": scope.code,
                "scopeName": scope.name,
                "isNew": stored is None,
                "unchanged": unchanged,
                "rows": rows,
            }
        )

    return blocks


def diff_assignments(
    *, held: dict[str, dict[str, str]], incoming: dict[str, dict[str, str]], groups: dict[str, dict[str, str]]
) -> dict[str, Any]:
    """What the student sheets would do to who is in which group.

    `held` is `{student: {scope code: group label}}` as it stands, `incoming` the same from
    the workbook, and `groups` is `{scope code: {group label upper: group id}}` so a label
    the catalogue does not have can be named rather than skipped in silence.
    """
    rows: list[dict[str, Any]] = []
    unchanged = 0
    unknown_groups: set[str] = set()

    for student in sorted(incoming):
        for scope_code, label in sorted(incoming[student].items()):
            available = groups.get(scope_code.upper(), {})
            group_id = available.get(label.upper())
            if group_id is None:
                unknown_groups.add(f"{scope_code} {label}")
                continue

            before = held.get(student, {}).get(scope_code.upper(), "")
            if before.upper() == label.upper():
                unchanged += 1
                continue

            rows.append(
                {
                    "key": f"place|{student}|{scope_code}",
                    "op": "place",
                    "status": "moved" if before else "placed",
                    "studentId": student,
                    "scopeCode": scope_code,
                    "before": before,
                    "after": label,
                    "groupId": group_id,
                    "detail": f"{scope_code} {before} → {label}" if before else f"{scope_code} {label}",
                }
            )

    return {
        "rows": rows,
        "unchanged": unchanged,
        "unknownGroups": sorted(unknown_groups),
    }


def summarize_reference(blocks: list[dict[str, Any]]) -> dict[str, int]:
    rows = [row for block in blocks for row in block["rows"]]
    return {
        "blocksNew": len([block for block in blocks if block["isNew"]]),
        "groupsAdded": len([row for row in rows if row["kind"] == "group"]),
        "coursesAdded": len([row for row in rows if row["kind"] == "course"]),
        "crnsChanged": len([row for row in rows if row["kind"] == "cell" and row["status"] == "changed"]),
        "crnsAdded": len([row for row in rows if row["kind"] == "cell" and row["status"] == "added"]),
        "unchanged": sum(block["unchanged"] for block in blocks),
        "decisions": len(rows),
    }


def summarize_assignments(report: dict[str, Any]) -> dict[str, int]:
    return {
        "placed": len([row for row in report["rows"] if row["status"] == "placed"]),
        "moved": len([row for row in report["rows"] if row["status"] == "moved"]),
        "unchanged": report["unchanged"],
        "unknownGroups": len(report["unknownGroups"]),
        "decisions": len(report["rows"]),
    }
