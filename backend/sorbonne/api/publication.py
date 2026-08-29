"""Publishing a semester's enrolments to the SCEN Student Hub.

This is the one place that reads both databases: the blocks and group assignments are this
application's, the timetable and the students' view of it are the platform's. So it sits
beside neither and gets a module of its own.

The order is always the same, and it is the point: resolve what this application believes,
ask the platform what that would change, show it, and only then write. A publish replaces
rather than merges, because this database is the whole truth about who is in which group —
which also means a cohort nobody has filled arrives as students losing their timetable, and
the coordinator has to see that before it happens rather than afterwards.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from sorbonne.api.timetables import require_client
from sorbonne.config import config
from sorbonne.services.enrolment_resolution import Group, Scope, Section, readiness, resolve, validate
from sorbonne.services.student_database import StudentDatabase
from sorbonne.services.student_timetables import StudentPlatformClient, StudentPlatformError

router = APIRouter(prefix="/publication", tags=["publication"])


def get_database() -> StudentDatabase:
    return StudentDatabase(config.database_url)


class PublishInput(BaseModel):
    """The version the coordinator was looking at, so a stale review is refused."""

    base_updated_at: str | None = None


def _forward(error: StudentPlatformError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


def _scopes(cohort: dict[str, Any]) -> list[Scope]:
    return [
        Scope(id=row["id"], cohort_id=cohort["cohortId"], code=row["code"], name=row["name"])
        for row in cohort["scopes"]
    ]


def _groups(cohort: dict[str, Any]) -> list[Group]:
    return [
        Group(id=row["id"], scope_id=row["scopeId"], label=row["label"], crns=row["crns"])
        for row in cohort["groups"]
    ]


def _assignments(cohort: dict[str, Any]) -> dict[tuple[str, str], str]:
    return {(row["studentId"], row["scopeId"]): row["groupId"] for row in cohort["assignments"]}


def _sections(rows: list[dict[str, Any]]) -> list[Section]:
    return [
        Section(
            crn=row.get("crn", ""),
            code=row.get("code", ""),
            kind=row.get("kind", ""),
            group_label=row.get("groupLabel", ""),
        )
        for row in rows
    ]


def _resolve_term(cohorts: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Every cohort on the semester, merged. One student can only be in one cohort."""
    enrolments: dict[str, list[str]] = {}
    for cohort in cohorts:
        for student, crns in resolve(
            scopes=_scopes(cohort), groups=_groups(cohort), assignments=_assignments(cohort)
        ).items():
            enrolments[student] = sorted(set(enrolments.get(student, [])) | set(crns))
    return enrolments


def _cohort_members(cohorts: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Who belongs to which cohort, for every member — not only the placed ones.

    The platform has no notion of cohorts otherwise, and it needs one to deliver a notice
    addressed to a population. Everybody the cohort holds is sent, including students
    nobody has put in a group yet: they resolve to no enrolments at all, and they are the
    students most likely to need telling why their timetable is empty.
    """
    members: dict[str, dict[str, str]] = {}
    for cohort in cohorts:
        for student in cohort.get("students", []):
            members[student] = {"key": cohort["cohortId"], "name": cohort["cohortName"]}
    return members


@router.get("/terms/{term_id}")
async def read_publication(
    term_id: str,
    database: StudentDatabase = Depends(get_database),
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    """What stands between this semester and being published. Writes nothing."""
    cohorts = database.term_publication(term_id)
    try:
        sections = _sections(await client.list_sections(term_id))
    except StudentPlatformError as exc:
        raise _forward(exc) from exc

    reports = []
    verdicts: dict[str, dict[str, Any]] = {}
    for cohort in cohorts:
        groups = _groups(cohort)
        reports.append(
            {
                "cohortId": cohort["cohortId"],
                **readiness(
                    cohort_name=cohort["cohortName"],
                    students=cohort["students"],
                    scopes=_scopes(cohort),
                    groups=groups,
                    course_codes=cohort["courseCodes"],
                    assignments=_assignments(cohort),
                ),
            }
        )
        verdicts.update(validate(groups=groups, sections=sections))

    resolved = _resolve_term(cohorts)
    # A CRN the timetable does not have enrols nobody, so a cohort whose every student is
    # assigned is still not ready if one of its groups points at a section that is not there.
    unmatched = [key for key, verdict in verdicts.items() if verdict["status"] != "matched"]
    return {
        "cohorts": reports,
        "validation": verdicts,
        "unmatchedCrns": len(unmatched),
        "sections": len(sections),
        "resolved": {"students": len(resolved), "enrolments": sum(len(crns) for crns in resolved.values())},
        "isReady": bool(cohorts) and all(report["isReady"] for report in reports) and not unmatched,
    }


@router.post("/terms/{term_id}/preview")
async def preview_publication(
    term_id: str,
    database: StudentDatabase = Depends(get_database),
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    """Resolve this semester's enrolments and ask the platform what would change."""
    resolved = _resolve_term(database.term_publication(term_id))
    try:
        return await client.preview_enrolments(term_id, resolved)
    except StudentPlatformError as exc:
        raise _forward(exc) from exc


@router.post("/terms/{term_id}/publish")
async def publish(
    term_id: str,
    body: PublishInput,
    database: StudentDatabase = Depends(get_database),
    client: StudentPlatformClient = Depends(require_client),
) -> dict[str, Any]:
    """Make the semester's enrolments exactly what this application resolved."""
    cohorts = database.term_publication(term_id)
    if not cohorts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No cohort has blocks for this semester yet, so there is nothing to publish.",
        )
    try:
        return await client.replace_enrolments(
            term_id,
            _resolve_term(cohorts),
            cohorts=_cohort_members(cohorts),
            base_updated_at=body.base_updated_at,
        )
    except StudentPlatformError as exc:
        raise _forward(exc) from exc
