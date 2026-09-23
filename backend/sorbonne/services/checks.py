"""Which of the department's checks are on, and the floor below which one says nothing.

A check is a named function, not a row in a table — see the note in migration 0042 and the
rejection of an authorable rules engine in `docs/plans/three-sources-of-truth.md`. What is
configurable is whether it runs and, where the question has a size, how big a thing has to
be before it is worth a coordinator's attention.

The defaults below are the answer for a department that has never opened the panel, and
they are chosen from the real data rather than from taste. `collision` starts at thirty
minutes because on the semester this was written against, seven students were caught by an
overlap and four of them by a quarter of an hour at the end of a class against a sport
session — true, unactionable, and exactly the sort of thing that teaches people to stop
reading warnings.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Check:
    """One named check: what it is called, what it asks, and what it does by default."""

    name: str
    title: str
    #: What the threshold counts, for the panel to put beside the box. Empty when the
    #: check has no size to it and the number is meaningless.
    measures: str
    #: The page whose question this is, and so the only page that offers it. One panel
    #: listing every check wherever it was opened put a teacher's hours on Cohorts and a
    #: student's timetable on Teacher hours, each beside things it had nothing to do with.
    home: str
    #: Whether a cohort may answer differently from the department. Only a check that is
    #: about students can: a cohort has no view on how far apart a teacher's hours are, and
    #: an override nothing reads is a setting that silently does nothing.
    per_cohort: bool = False
    enabled: bool = True
    threshold: int = 0


CHECKS: tuple[Check, ...] = (
    Check(
        name="collision",
        title="A student in one of our sections and another department's at the same hour",
        measures="minutes of overlap",
        home="cohorts",
        per_cohort=True,
        threshold=30,
    ),
    Check(
        name="teacher_hours_apart",
        title="A teacher's hours disagreeing between the places they are written",
        measures="hours apart",
        home="teacher-hours",
        # Two hours, because the small differences are all explainable and none of them is
        # worth a pill: a class that ran short, a half-hour of cover, a rounding on a
        # requisition. Below this the column would be a wall of warnings nobody acts on,
        # which is how a warnings column stops being read at all.
        threshold=2,
    ),
    Check(
        name="portal_sync_age",
        title="Portal data old enough that the pages should not be trusted",
        measures="hours old",
        # Every student page reads the portal, so no one of them owns this.
        home="settings",
        # Eight, so a morning's work is answered by a morning's sync: the registrar moves
        # sections, staff and registrations during the working day, and a page read at four
        # o'clock from a pull taken the previous afternoon is a page quietly answering
        # yesterday's question. Off is a real answer too — during a portal outage there is
        # nothing to be done about it and a warning every morning is just noise.
        threshold=8,
    ),
)

BY_NAME = {check.name: check for check in CHECKS}


@dataclass(frozen=True)
class Setting:
    enabled: bool
    threshold: int


def settled(rows: list[dict], cohort_id: str = "") -> dict[str, Setting]:
    """The answer for each check: the cohort's if it has one, else the department's.

    `rows` is every `check_settings` row for the checks in question — both scopes — so
    this is one query and a fold rather than a query per cohort.
    """
    found: dict[str, Setting] = {
        check.name: Setting(check.enabled, check.threshold) for check in CHECKS
    }
    # The department's first, so a cohort's row lands on top of it.
    for row in sorted(rows, key=lambda row: bool(row.get("cohort_id"))):
        name = row.get("name", "")
        if name not in found:
            continue
        if row.get("cohort_id") not in ("", cohort_id):
            continue
        # A cohort's answer to a question that is not a cohort's. Such rows could be written
        # while every panel offered every check; they are ignored rather than deleted, so
        # nothing anybody typed is destroyed, and they cannot move a number.
        if row.get("cohort_id") and not BY_NAME[name].per_cohort:
            continue
        found[name] = Setting(bool(row.get("enabled", True)), int(row.get("threshold") or 0))
    return found
