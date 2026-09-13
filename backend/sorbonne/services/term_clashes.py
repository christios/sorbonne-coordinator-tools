"""Which of a cohort's groups meet at the same hour, named the way the page lays them out.

Lifted out of `api/publication.py` unchanged. It was only ever there because that route
happened to be the one with sessions to hand — and being there made it reachable only
through a route that requires the SCEN Student Hub, so a department with no Hub could not
see its own clashes even when the registrar's timetable was sitting in the database.

Nothing about the clash service itself needed changing to free it. `group_clashes.clashes`
already takes a plain `list[Session]` with no notion of where the sessions came from; the
coupling was two route-level `Depends`, not a design. Anyone tempted to "make the clash
service source-agnostic" should read this paragraph first: it already is.
"""

from __future__ import annotations

from typing import Any

from sorbonne.services.enrolment_resolution import Group, Major, Placement, Scope
from sorbonne.services.group_clashes import Session, clashes


def scopes_of(cohort: dict[str, Any]) -> list[Scope]:
    return [
        Scope(id=row["id"], cohort_id=cohort["cohortId"], code=row["code"], name=row["name"])
        for row in cohort["scopes"]
    ]


def groups_of(cohort: dict[str, Any], key: str = "groups") -> list[Group]:
    """The publication's groups as the resolution algorithm takes them, sub-rows included."""
    return [
        Group(
            id=row["id"],
            scope_id=row["scopeId"],
            label=row["label"],
            crns=row["crns"],
            majors=tuple(
                Major(id=major["id"], program=major.get("program", ""), crns=major.get("crns", {}))
                for major in row.get("majors", [])
            ),
        )
        for row in cohort.get(key, [])
    ]


def assignments_of(cohort: dict[str, Any], key: str = "assignments") -> dict[tuple[str, str], Placement]:
    """`(student, scope) -> (group, sub-row)`; the sub-row blank for a group that has none."""
    return {(row["studentId"], row["scopeId"]): (row["groupId"], row.get("majorId", "")) for row in cohort.get(key, [])}


def programs_of(cohort: dict[str, Any]) -> dict[str, str]:
    """CRN -> the programme it is taught to, for the CRNs one sub-row and no other takes.

    Computed where the cells are read, in the store, because it is the cells that say it:
    a sub-row's own CRN is its programme's, and a shared CRN whose other sub-rows are not
    taught the course is the remaining one's. Two such CRNs for different programmes have
    no student in common, whatever hour they meet at.
    """
    return dict(cohort.get("crnPrograms") or {})


def cohort_clashes(cohort: dict[str, Any], groups: list[Group], sessions: list[Session]) -> list[dict[str, Any]]:
    """The cohort's clashing groups, each pair named the way the page lays the blocks out.

    Against the cohort's own sets AND the sets open to every cohort, which live on somebody
    else's row. Without the second, a student's language hour was compared only with the
    lectures of whichever cohort happens to hold the language set — so for everybody else
    it was never compared with anything. Only this cohort's students are named, because a
    clash is reported to the cohort that can do something about it.
    """
    scopes = [*cohort["scopes"], *cohort.get("sharedScopes", [])]
    code_of = {row["id"]: row["code"] for row in scopes}
    order = {row["id"]: index for index, row in enumerate(scopes)}
    both = [*groups, *groups_of(cohort, key="sharedGroups")]
    assignments = {**assignments_of(cohort), **assignments_of(cohort, key="sharedAssignments")}
    named = []
    for clash in clashes(groups=both, sessions=sessions, assignments=assignments, programs=programs_of(cohort)):
        pair = sorted(clash["groups"], key=lambda group: order.get(group["scopeId"], 0))
        # A window's two CRNs are in the pair's order; keep them so when the pair is turned.
        turned = pair[0]["id"] != clash["groups"][0]["id"]
        named.append(
            {
                **clash,
                "groups": [{**group, "scopeCode": code_of.get(group["scopeId"], "")} for group in pair],
                "windows": [
                    {**window, "crns": list(reversed(window["crns"]))} if turned else window
                    for window in clash["windows"]
                ],
            }
        )
    return named
