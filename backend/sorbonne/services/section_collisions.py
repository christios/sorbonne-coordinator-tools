"""Our sections against other departments' sections, at the same hour.

The third kind of overlap, and the one nothing has ever reported. Two of *our* groups at
one hour is a planning defect and belongs to a student — a clash. Two sections neither of
which is ours is nobody's business here: we teach neither, we can move neither, the student
chose both, and reporting it is permanent unactionable red. What is left is the middle
case, and it needs a different remedy from either.

**It is a fact about a SECTION, not about a student.** Five of our SCEN-101 sections sit in
the university's Tuesday 16:30 option slot against ENGL, ARAB and SPAN. Reported per
student that is a wall of identical red lines and the only remedy on offer — "move this
student out of Arabic" — is one nobody would ever take. Reported per section it is one line
with three real answers: move OUR section out of the slot, which is entirely within the
department's power; accept it, because the option block is protected university-wide and
the students chose a clashing option; or refer it once, about the slot, to whoever owns
that block.

The discriminator is membership of `active_course_crns` — the curated register, never a
subject prefix. The prefixes look tidy for one term and stop being tidy the moment a
language set the department authors shares a prefix with one it does not.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _minutes(clock: str) -> int:
    hours, minutes = clock.strip().split(":")[:2]
    return int(hours) * 60 + int(minutes)


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def collisions(
    *,
    meetings: list[tuple[str, str, str, str]],
    ours: set[str],
    courses: dict[str, str],
    registered: dict[str, set[str]],
    settled: dict[tuple[str, str, str, str], dict[str, str]],
) -> dict[str, list[dict[str, Any]]]:
    """One row per (our section, weekday, hour) where somebody else's section sits too.

    `meetings` is `(crn, meets_on, starts_at, ends_at)`; `registered` is `crn -> student
    ids`, which is the only thing a student count is built from — ids and a length, never a
    name. `settled` is keyed the same way a row is, so a note expires by itself the moment
    the registrar moves our section: the slot it was about no longer exists.

    Weekly repetition folds, exactly as `group_clashes` folds it — eight Wednesdays at one
    hour is one fact that happened eight times, not eight facts.
    """
    by_date: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for crn, meets_on, starts_at, ends_at in meetings:
        by_date[meets_on].append((crn, starts_at, ends_at))

    slots: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for meets_on, rows in by_date.items():
        try:
            weekday = _WEEKDAYS[dt.date.fromisoformat(meets_on).weekday()]
        except ValueError:
            # An unreadable date is reported by the pull that carried it, not silently
            # turned into a collision on an invented day.
            continue
        for index, left in enumerate(rows):
            for right in rows[index + 1 :]:
                if left[0] == right[0]:
                    continue
                mine = [side for side in (left, right) if side[0] in ours]
                # Both ours is a student clash and lives on the cohort's page; neither is
                # nobody's business here. Only the middle case is a collision.
                if len(mine) != 1:
                    continue
                theirs = right if left[0] in ours else left
                start = max(_minutes(left[1]), _minutes(right[1]))
                end = min(_minutes(left[2]), _minutes(right[2]))
                if start >= end:
                    continue
                key = (mine[0][0], weekday, _clock(start), _clock(end))
                slot = slots.setdefault(
                    key,
                    {"ourCrn": key[0], "weekday": weekday, "startsAt": key[2], "endsAt": key[3],
                     "ourCourse": courses.get(key[0], ""), "theirs": {}, "dates": set()},
                )
                slot["theirs"].setdefault(theirs[0], courses.get(theirs[0], ""))
                slot["dates"].add(meets_on)

    live: list[dict[str, Any]] = []
    done: list[dict[str, Any]] = []
    for key, slot in sorted(slots.items()):
        mine_registered = registered.get(key[0], set())
        # Students the registrar has in ours AND in one of theirs. A count, because the
        # remedy is about the section and a list of names would only invite the wrong one.
        caught = {
            student
            for crn in slot["theirs"]
            for student in registered.get(crn, set()) & mine_registered
        }
        row = {
            "ourCrn": slot["ourCrn"],
            "ourCourse": slot["ourCourse"],
            "weekday": slot["weekday"],
            "startsAt": slot["startsAt"],
            "endsAt": slot["endsAt"],
            "dates": len(slot["dates"]),
            # How long the two actually overlap. The difference between a class somebody
            # misses and a quarter of an hour at the end of one: SCEN-102 runs to 18:15
            # and sport starts at 18:00, which is a fifteen-minute tail, while a section in
            # the Tuesday option block loses the whole ninety. Drawn alike they read alike.
            "minutes": _minutes(slot["endsAt"]) - _minutes(slot["startsAt"]),
            "theirs": [{"crn": crn, "courseCode": code} for crn, code in sorted(slot["theirs"].items())],
            "students": len(caught),
        }
        note = settled.get(key)
        if note:
            done.append({**row, "disposition": note.get("disposition", ""), "note": note.get("note", ""),
                         "settledAt": note.get("settled_at", ""), "settledBy": note.get("settled_by", "")})
        else:
            live.append(row)
    # Worst first, and "worst" is time lost rather than heads counted.
    #
    # Sorting by the number of students caught alone put a fifteen-minute overlap with
    # sport above a section losing the whole ninety-minute language hour, because two
    # students beat one. What is at stake is minutes multiplied by people multiplied by
    # how often it recurs; a slot nobody is caught by scores nothing and sinks to the
    # bottom, which is where the page then folds it away.
    live.sort(key=lambda row: (-(row["students"] * row["minutes"] * row["dates"]), -row["dates"], row["ourCrn"]))
    return {"collides": live, "settledCollisions": done}
