"""Groups that meet at the same hour, which is the one thing a fill must never do.

A student sits in one group per block, and a timetable holds one thing at a time. So two
groups in *different* blocks that meet at the same hour cannot share a student, and a group
whose own CRNs meet at the same hour cannot hold anyone at all. Groups of the same block are
never compared: a student is in one of them, not both.

Nor are two courses taught to different programmes. In L2 and L3 the group IS the
programme — one CM set carries the Maths courses and the Physics ones — and a student takes
the courses of their own programme. Two such courses have no student in common, so their
sections may sit on the same hour for ever and catch nobody. Those overlaps are not
reported, because a clash nobody can be caught by is not a clash; it is a room booking.

The timetable knows when every CRN meets; the coordinator built the groups. This is where
the two meet, and it is pure — the publication route feeds it and the fill will lean on it.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from itertools import combinations
from typing import Any

from sorbonne.services.enrolment_resolution import Group


@dataclass(frozen=True)
class Session:
    """One meeting of a CRN, as the timetable holds it."""

    crn: str
    date: str  # ISO date
    start: str  # HH:MM or HH:MM:SS
    end: str


def clashes(
    *,
    groups: list[Group],
    sessions: list[Session],
    assignments: dict[tuple[str, str], str],
    programs: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Every pair of groups that overlap, with the hours they overlap on and who sits in both.

    Weekly repetition is folded: fourteen Mondays at 08:30 are one window that happens
    fourteen times. The worst pairs come first — the ones with students already in both.

    `programs` is CRN -> the programme its course is taught to, for the courses that name
    one. Two CRNs named for different programmes are never compared: no student takes both,
    so the hour they share is not one anybody can be caught by. A CRN with no programme is
    for everyone and is compared with everything, which is every course in Foundation Year
    and L1.
    """
    by_crn: dict[str, list[Session]] = {}
    for session in sessions:
        by_crn.setdefault(session.crn, []).append(session)

    members: dict[str, set[str]] = {}
    for (student, _scope), group_id in assignments.items():
        members.setdefault(group_id, set()).add(student)

    found: list[dict[str, Any]] = []
    for left, right in _pairs(groups):
        windows = _windows(left, right, by_crn, programs or {})
        if not windows:
            continue
        both = (
            members.get(left.id, set())
            if left is right
            else members.get(left.id, set()) & members.get(right.id, set())
        )
        pair = [left] if left is right else [left, right]
        found.append(
            {
                "groups": [{"id": group.id, "scopeId": group.scope_id, "label": group.label} for group in pair],
                "windows": windows,
                "students": sorted(both),
            }
        )

    found.sort(key=lambda clash: (-len(clash["students"]), [group["label"] for group in clash["groups"]]))
    return found


def _pairs(groups: list[Group]):
    """Each group against itself, then against every group of another block."""
    for group in groups:
        yield group, group
    for left, right in combinations(groups, 2):
        if left.scope_id != right.scope_id:
            yield left, right


def _windows(
    left: Group, right: Group, by_crn: dict[str, list[Session]], programs: dict[str, str]
) -> list[dict[str, Any]]:
    # Every CRN of every course, parts included: the two halves of a split section are two
    # CRNs of one course, and the registrar's dates already keep them from overlapping.
    mine = [crn for crns in left.crns.values() for crn in crns if crn]
    if left is right:
        crn_pairs = list(combinations(sorted(set(mine)), 2))
    else:
        theirs = [crn for crns in right.crns.values() for crn in crns if crn]
        crn_pairs = [(a, b) for a in mine for b in theirs]

    folded: dict[tuple[int, int, int, str, str], dict[str, Any]] = {}
    for crn_a, crn_b in crn_pairs:
        if _different_programmes(programs.get(crn_a, ""), programs.get(crn_b, "")):
            continue
        for one in by_crn.get(crn_a, []):
            for other in by_crn.get(crn_b, []):
                window = _overlap(one, other)
                if window is None:
                    continue
                weekday, start, end = window
                key = (weekday, start, end, crn_a, crn_b)
                held = folded.get(key)
                if held is None:
                    folded[key] = {
                        "weekday": _WEEKDAYS[weekday],
                        "start": _clock(start),
                        "end": _clock(end),
                        "crns": [crn_a, crn_b],
                        "dates": 1,
                    }
                else:
                    held["dates"] += 1

    return [folded[key] for key in sorted(folded)]


def _different_programmes(ours: str, theirs: str) -> bool:
    """Whether two courses are taught to programmes that share no student.

    Blank means "everyone", on either side — which is how every set that does not use
    programmes goes on behaving exactly as it did.
    """
    return bool(ours) and bool(theirs) and ours.strip().casefold() != theirs.strip().casefold()


def _overlap(one: Session, other: Session) -> tuple[int, int, int] | None:
    """The weekday and minutes both sessions occupy, or nothing when they only touch."""
    if one.date != other.date:
        return None
    try:
        weekday = dt.date.fromisoformat(one.date).weekday()
        start = max(_minutes(one.start), _minutes(other.start))
        end = min(_minutes(one.end), _minutes(other.end))
    except ValueError:
        return None
    return (weekday, start, end) if start < end else None


def _minutes(clock: str) -> int:
    hours, minutes = clock.strip().split(":")[:2]
    return int(hours) * 60 + int(minutes)


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
