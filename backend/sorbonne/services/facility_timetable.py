"""What the registrar has actually booked, and — just as much — what it has not said.

The third of the three records. It answers two questions that nothing else can: when does
this CRN meet, and did anybody ask. The second is not a lesser question. Pulling the portal
too quickly makes it return an empty list for about one section in seven, which is exactly
what a section with no classes booked looks like, so a store that cannot tell "asked and
got nothing" from "never asked" will one day report a term's teaching as cancelled.

Meetings come out as `group_clashes.Session`, unchanged and un-wrapped, because that is
already the shape the clash algorithm takes. Nothing here folds a weekly pattern; folding
is for display and it destroys the dates that make a half-semester handover harmless.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date as dt_date
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from sorbonne.services.group_clashes import Session

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

#: A section is only believed dead after this many consecutive complete pulls said nothing
#: about it. One bad pull must not retire a term's teaching.
SILENT_BEFORE_GONE = 2


class ContradictoryPull(Exception):
    """The pull says it asked about sections it then neither answered nor failed on."""


@dataclass(frozen=True)
class Coverage:
    """How much of a question this store can actually answer.

    `blind` is the honest part: the CRNs it has no meetings for, whatever the reason. A
    clash count next to a blind count is a floor with its own error bar; a clash count on
    its own is a claim the data cannot support.
    """

    published: list[str]
    silent: list[str]
    gone: list[str]
    unchecked: list[str]
    pulled_at: str

    @property
    def blind(self) -> list[str]:
        # `silent` is NOT blind. A section that went quiet keeps the meetings it had, and
        # those are still the best thing anybody knows about it — stale, not absent. Only
        # a section with no meetings on hand at all is something we cannot see.
        return sorted([*self.gone, *self.unchecked])


class FacilityTimetableStore:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    # ------------------------------------------------------------------ writing

    def record_pull(  # noqa: PLR0913 - one keyword per thing a pull reports
        self,
        *,
        term_code: str,
        asked: list[str],
        sections: list[dict[str, Any]],
        silent: list[str],
        failed: list[str],
        complete: bool,
        actor: str = "",
        now: str = "",
    ) -> dict[str, Any]:
        """Write down one pull: what it asked, what answered, and what stayed quiet.

        The rules, in the order they matter:

        1. **Every asked CRN is accounted for.** answered + silent + failed must cover the
           list, or the pull is contradictory and is refused rather than half-applied. A
           pull that quietly drops a section is how a section becomes invisible.
        2. **Meetings are replaced, not merged**, per answered section. A class that moves
           room or hour is the same class moved; merging would leave the old one behind for
           ever and manufacture a permanent clash against a class that is not there.
        3. **Only a complete pull may count a silence.** A pull that gave up halfway says
           nothing about the sections it never reached, and a failed call says nothing at
           all — neither may push a section towards being treated as gone.
        4. **A section nobody asked about is left alone**, and stays absent from the table
           if it was never there. Absence is how "unchecked" is said.
        """
        stamp = now or _now()
        answered = {row["crn"] for row in sections}
        accounted = answered | set(silent) | set(failed)
        missing = sorted(set(asked) - accounted)
        if missing:
            raise ContradictoryPull(
                f"The pull asked about {len(missing)} section(s) it neither answered, "
                f"failed nor reported silent: {', '.join(missing[:5])}."
            )

        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO facility_pulls
                            (id, term_code, pulled_at, pulled_by, asked, answered, silent, failed, complete)
                        VALUES (:id, :t, :at, :by, :asked, :answered, :silent, :failed, :complete)"""),
                {
                    "id": str(uuid.uuid4()),
                    "t": term_code,
                    "at": stamp,
                    "by": actor,
                    "asked": len(asked),
                    "answered": len(answered),
                    "silent": len(silent),
                    "failed": len(failed),
                    "complete": complete,
                },
            )

            for row in sections:
                self._answered(connection, term_code, row, stamp)
            if complete:
                for crn in silent:
                    self._silent(connection, term_code, crn, stamp)
            # A failed call is not evidence of anything, so it only records that we tried.
            for crn in [*failed, *([] if complete else silent)]:
                connection.execute(
                    text("""UPDATE facility_sections SET asked_at = :at
                            WHERE term_code = :t AND crn = :crn"""),
                    {"at": stamp, "t": term_code, "crn": crn},
                )

        return {
            "asked": len(asked),
            "answered": len(answered),
            "silent": len(silent) if complete else 0,
            "failed": len(failed),
            "complete": complete,
        }

    def _answered(self, connection: Any, term_code: str, row: dict[str, Any], stamp: str) -> None:
        connection.execute(
            text("""INSERT INTO facility_sections
                        (term_code, crn, course_code, title, teacher_name, rooms, schedule_state,
                         ours, head_count, silent_pulls, asked_at, first_seen_at, last_seen_at)
                    VALUES (:t, :crn, :code, :title, :teacher, :rooms, 'published',
                            :ours, :head, 0, :at, :at, :at)
                    ON CONFLICT (term_code, crn) DO UPDATE SET
                        course_code = excluded.course_code, title = excluded.title,
                        teacher_name = excluded.teacher_name, rooms = excluded.rooms,
                        schedule_state = 'published', ours = excluded.ours,
                        head_count = excluded.head_count, silent_pulls = 0,
                        asked_at = excluded.asked_at, last_seen_at = excluded.last_seen_at"""),
            {
                "t": term_code,
                "crn": row["crn"],
                "code": row.get("courseCode", ""),
                "title": row.get("title", ""),
                "teacher": row.get("teacherName", ""),
                "rooms": ", ".join(row.get("rooms", []) or []),
                "ours": bool(row.get("ours")),
                # Never for a section that is not ours: another department's enrolment is a
                # fact about them, and no verdict of ours needs it.
                "head": row.get("headCount") if row.get("ours") else None,
                "at": stamp,
            },
        )
        # Replace, per rule 2. Cheaper and more obviously correct than diffing, and a
        # section's meetings are tens of rows, not thousands.
        connection.execute(
            text("DELETE FROM facility_meetings WHERE term_code = :t AND crn = :crn"),
            {"t": term_code, "crn": row["crn"]},
        )
        seen: set[tuple[str, str, str]] = set()
        for meeting in row.get("meetings", []):
            key = (meeting["meetsOn"], meeting["startsAt"], meeting["endsAt"])
            if key in seen:
                continue
            seen.add(key)
            connection.execute(
                text("""INSERT INTO facility_meetings
                            (id, term_code, crn, meets_on, starts_at, ends_at, room)
                        VALUES (:id, :t, :crn, :on, :start, :end, :room)"""),
                {
                    "id": str(uuid.uuid4()),
                    "t": term_code,
                    "crn": row["crn"],
                    "on": meeting["meetsOn"],
                    "start": meeting["startsAt"],
                    "end": meeting["endsAt"],
                    "room": meeting.get("room", ""),
                },
            )

    def _silent(self, connection: Any, term_code: str, crn: str, stamp: str) -> None:
        """A complete pull asked and got nothing. Written down; believed only at two.

        The meetings are deliberately KEPT. Until it is believed dead, the last thing the
        registrar said about this section is still the best thing anybody knows.
        """
        connection.execute(
            text("""INSERT INTO facility_sections
                        (term_code, crn, schedule_state, silent_pulls, asked_at, first_seen_at, last_seen_at)
                    VALUES (:t, :crn, 'silent', 1, :at, :at, :at)
                    ON CONFLICT (term_code, crn) DO UPDATE SET
                        silent_pulls = facility_sections.silent_pulls + 1,
                        schedule_state = CASE
                            WHEN facility_sections.silent_pulls + 1 >= :enough THEN 'gone'
                            ELSE 'silent' END,
                        asked_at = excluded.asked_at"""),
            {"t": term_code, "crn": crn, "at": stamp, "enough": SILENT_BEFORE_GONE},
        )

    # ------------------------------------------------------------------ reading

    def sessions_for(self, term_code: str, crns: list[str]) -> list[Session]:
        """Every meeting of these sections, as the clash algorithm already takes them.

        A `gone` section contributes nothing: it is the one state where we believe the
        classes are not happening. `silent` still contributes, because stale is not absent.
        """
        if not crns:
            return []
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT m.crn, m.meets_on, m.starts_at, m.ends_at
                        FROM facility_meetings m
                        JOIN facility_sections s ON s.term_code = m.term_code AND s.crn = m.crn
                        WHERE m.term_code = :t AND m.crn = ANY(:crns) AND s.schedule_state <> 'gone'
                        ORDER BY m.meets_on, m.starts_at, m.crn"""),
                {"t": term_code, "crns": crns},
            ).all()
        return [Session(crn=row[0], date=row[1], start=row[2], end=row[3]) for row in rows]

    def windows_for(self, term_code: str, crns: list[str]) -> dict[str, tuple[str, str]]:
        """First and last date each of these sections meets, for the ones we have dates for.

        A section absent from the answer has no window at all — nobody has asked the
        registrar about it, or the registrar said nothing — and every caller must treat
        that as "no opinion" rather than as "never meets". A `gone` section contributes
        nothing, exactly as `sessions_for` treats it: it is the one state where we believe
        the classes are not happening.

        Two dates rather than the meetings themselves because that is the whole question a
        half-semester handover asks — was this section running on that day — and answering
        it from the endpoints costs one row per section instead of thirty.
        """
        if not crns:
            return {}
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT m.crn, min(m.meets_on), max(m.meets_on)
                        FROM facility_meetings m
                        JOIN facility_sections s ON s.term_code = m.term_code AND s.crn = m.crn
                        WHERE m.term_code = :t AND m.crn = ANY(:crns) AND s.schedule_state <> 'gone'
                        GROUP BY m.crn"""),
                {"t": term_code, "crns": crns},
            ).all()
        return {row[0]: (row[1], row[2]) for row in rows}

    def sections_for(self, term_code: str, crns: list[str]) -> list[tuple[str, str]]:
        """`(crn, course code)` for the sections the registrar has answered about.

        What `enrolment_resolution.validate` needs to tell a CRN that is not on any
        timetable from one that is, but under a different course's name. `gone` is left
        out, as everywhere: it is the one state where we believe the section is not there.
        """
        if not crns:
            return []
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT crn, course_code FROM facility_sections
                        WHERE term_code = :t AND crn = ANY(:crns) AND schedule_state <> 'gone'
                        ORDER BY crn"""),
                {"t": term_code, "crns": crns},
            ).all()
        return [(row[0], row[1]) for row in rows]

    def weekdays_for(self, term_code: str) -> dict[str, list[str]]:
        """`crn -> ["Mon", "Tue"]` for every section the registrar has timetabled.

        Folded to weekdays here rather than in the browser because that is the shape the
        question is asked in — "who has languages on a Tuesday" — while the dates stay
        underneath for everything that needs them. Derived from the date rather than
        stored, so a coordinator's own timezone can never move a class to another day.
        """
        if not term_code:
            return {}
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT m.crn, m.meets_on FROM facility_meetings m
                        JOIN facility_sections s ON s.term_code = m.term_code AND s.crn = m.crn
                        WHERE m.term_code = :t AND s.schedule_state <> 'gone'"""),
                {"t": term_code},
            ).all()
        held: dict[str, set[str]] = {}
        for crn, meets_on in rows:
            try:
                weekday = _WEEKDAYS[dt_date.fromisoformat(meets_on).weekday()]
            except ValueError:
                # Reported by the pull that carried it; never turned into a day.
                continue
            held.setdefault(crn, set()).add(weekday)
        return {crn: sorted(days, key=_WEEKDAYS.index) for crn, days in held.items()}

    def timetable_for(self, term_code: str, crns: list[str]) -> dict[str, Any]:
        """These sections' meetings, with rooms and the state each section is in, for a calendar.

        Every CRN asked for comes back, whatever is known about it. A calendar is read for
        the gaps as much as for the classes — "is Tuesday afternoon free" — and one that
        quietly dropped a section nobody has asked the registrar about would answer yes
        about an afternoon that may well have a lecture in it. So an unchecked section is a
        row with no meetings and the word `unchecked` on it, and the page says so.

        `gone` contributes no meetings, `silent` keeps its last ones — exactly as
        `sessions_for` reads them, so the calendar and the clash count never disagree
        about whether a class is happening.
        """
        wanted = sorted({crn for crn in crns if crn})
        if not wanted:
            return {"termCode": term_code, "sections": [], "pulledAt": ""}
        with self.engine.connect() as connection:
            sections = {
                row["crn"]: row
                for row in connection.execute(
                    text("""SELECT crn, course_code, title, teacher_name, schedule_state
                            FROM facility_sections WHERE term_code = :t AND crn = ANY(:crns)"""),
                    {"t": term_code, "crns": wanted},
                ).mappings()
            }
            meetings = (
                connection.execute(
                    text("""SELECT m.crn, m.meets_on, m.starts_at, m.ends_at, m.room
                            FROM facility_meetings m
                            JOIN facility_sections s ON s.term_code = m.term_code AND s.crn = m.crn
                            WHERE m.term_code = :t AND m.crn = ANY(:crns) AND s.schedule_state <> 'gone'
                            ORDER BY m.meets_on, m.starts_at, m.crn"""),
                    {"t": term_code, "crns": wanted},
                )
                .mappings()
                .all()
            )
            pulled = connection.execute(
                text("SELECT max(pulled_at) FROM facility_pulls WHERE term_code = :t"), {"t": term_code}
            ).scalar()
        by_crn: dict[str, list[dict[str, str]]] = {}
        for row in meetings:
            by_crn.setdefault(row["crn"], []).append(
                {
                    "meetsOn": row["meets_on"],
                    "startsAt": row["starts_at"],
                    "endsAt": row["ends_at"],
                    "room": row["room"] or "",
                }
            )
        return {
            "termCode": term_code,
            "sections": [
                {
                    "crn": crn,
                    "courseCode": (sections[crn]["course_code"] if crn in sections else "") or "",
                    "title": (sections[crn]["title"] if crn in sections else "") or "",
                    "teacherName": (sections[crn]["teacher_name"] if crn in sections else "") or "",
                    "state": sections[crn]["schedule_state"] if crn in sections else "unchecked",
                    "meetings": by_crn.get(crn, []),
                }
                for crn in wanted
            ],
            "pulledAt": pulled or "",
        }

    def hours_for(self, term_code: str) -> dict[str, dict[str, Any]]:
        """`crn -> {courseCode, teacherName, hours}`: what the registrar has booked, added up.

        The registrar's own count of a section's teaching, for reading beside the hours our
        planning asks for. Added up from the dated meetings rather than taken from anywhere
        else, so a cancelled week or a half-semester handover is already in the number. A
        `gone` section contributes nothing, as everywhere.
        """
        if not term_code:
            return {}
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT s.crn, s.course_code, s.teacher_name,
                               coalesce(sum(EXTRACT(EPOCH FROM (m.ends_at::time - m.starts_at::time)) / 3600.0), 0)
                        FROM facility_sections s
                        LEFT JOIN facility_meetings m ON m.term_code = s.term_code AND m.crn = s.crn
                        WHERE s.term_code = :t AND s.schedule_state <> 'gone'
                        GROUP BY s.crn, s.course_code, s.teacher_name"""),
                {"t": term_code},
            ).all()
        return {
            row[0]: {"courseCode": row[1] or "", "teacherName": row[2] or "", "hours": round(float(row[3]), 2)}
            for row in rows
        }

    def coverage_for(self, term_code: str, crns: list[str]) -> Coverage:
        """What this store can and cannot say about these sections."""
        if not crns:
            return Coverage([], [], [], [], "")
        with self.engine.connect() as connection:
            held = dict(
                connection.execute(
                    text("""SELECT crn, schedule_state FROM facility_sections
                            WHERE term_code = :t AND crn = ANY(:crns)"""),
                    {"t": term_code, "crns": crns},
                ).all()
            )
            pulled = connection.execute(
                text("SELECT max(pulled_at) FROM facility_pulls WHERE term_code = :t"), {"t": term_code}
            ).scalar()
        by_state: dict[str, list[str]] = {"published": [], "silent": [], "gone": [], "unchecked": []}
        for crn in crns:
            by_state[held.get(crn, "unchecked")].append(crn)
        return Coverage(
            published=sorted(by_state["published"]),
            silent=sorted(by_state["silent"]),
            gone=sorted(by_state["gone"]),
            unchecked=sorted(by_state["unchecked"]),
            pulled_at=pulled or "",
        )


    def sweep(self, term_code: str) -> dict[str, Any]:
        """Everything one term's sweep holds, in the shape a pull is written in.

        For copying a term's timetable from one instance to another, which nothing else can
        do: the registrar is reached through a browser extension signed in as a coordinator,
        so a developer's database can only get this by somebody sitting down and running a
        sync. Reading it back in the pull's own shape means the copy is the same write the
        extension makes, with no second path into these tables to keep honest.

        `asked` is every section the sweep accounted for — answered, silent and gone alike —
        because a pull that named fewer would read as the registrar having cancelled the
        rest, and `record_pull` refuses a pull that does not add up.
        """
        with self.engine.connect() as connection:
            sections = (
                connection.execute(
                    text("""SELECT crn, course_code, title, teacher_name, rooms, schedule_state, ours, head_count
                            FROM facility_sections WHERE term_code = :t ORDER BY crn"""),
                    {"t": term_code},
                )
                .mappings()
                .all()
            )
            meetings = (
                connection.execute(
                    text("""SELECT crn, meets_on, starts_at, ends_at, room FROM facility_meetings
                            WHERE term_code = :t ORDER BY crn, meets_on, starts_at"""),
                    {"t": term_code},
                )
                .mappings()
                .all()
            )
        by_crn: dict[str, list[dict[str, str]]] = {}
        for row in meetings:
            by_crn.setdefault(row["crn"], []).append(
                {
                    "meetsOn": row["meets_on"],
                    "startsAt": row["starts_at"],
                    "endsAt": row["ends_at"],
                    "room": row["room"] or "",
                }
            )
        answered, quiet = [], []
        for row in sections:
            if row["schedule_state"] != "published":
                # Silent and gone are both "asked, answered nothing". The difference is how
                # many times over, which the receiving store counts for itself.
                quiet.append(row["crn"])
                continue
            answered.append(
                {
                    "crn": row["crn"],
                    "courseCode": row["course_code"] or "",
                    "title": row["title"] or "",
                    "teacherName": row["teacher_name"] or "",
                    "rooms": [room for room in (row["rooms"] or "").split(",") if room],
                    "ours": bool(row["ours"]),
                    "headCount": row["head_count"],
                    "meetings": by_crn.get(row["crn"], []),
                }
            )
        return {
            "termCode": term_code,
            "asked": sorted({row["crn"] for row in sections}),
            "sections": answered,
            "silent": sorted(quiet),
            "failed": [],
            "complete": True,
        }

    def terms(self) -> list[str]:
        """The terms this store has been swept for, newest first."""
        with self.engine.connect() as connection:
            return [
                row[0]
                for row in connection.execute(
                    text("SELECT DISTINCT term_code FROM facility_sections ORDER BY term_code DESC")
                )
            ]


def _now() -> str:
    from datetime import datetime, timezone  # noqa: PLC0415 - one caller, and it is here

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
