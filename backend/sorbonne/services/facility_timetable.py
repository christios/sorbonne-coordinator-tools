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
from hashlib import sha256
from datetime import date as dt_date
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.services.engine import engine_for
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


def _said(slots: list[tuple[str, str, str]]) -> str:
    return "|".join(f"{on}T{start}-{end}" for on, start, end in sorted(slots))


def change_key(
    term_code: str,
    crn: str,
    *,
    removed: list[tuple[str, str, str]],
    added: list[tuple[str, str, str]],
) -> str:
    """The name of one section's changed classes, stable while the same ones have changed.

    An approval is stored against this, so it expires by ceasing to match rather than by
    anything having to expire it — the same way every other dismissed warning here works.

    Removals and arrivals are named apart rather than thrown into one bag. A class gone
    from Tuesday and a class arrived on Thursday are two facts about the same week, and a
    key that could not tell them apart would let an approval given for one silently cover
    the other.
    """
    said = f"removed:{_said(removed)}|added:{_said(added)}"
    return f"registrar-classes-changed:{term_code}:{crn}:{sha256(said.encode()).hexdigest()[:12]}"


class FacilityTimetableStore:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

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
        # Asked before the upsert below creates the row. Everything is new the first time a
        # section is seen, and a term's first sweep reporting itself as change is noise.
        known = connection.execute(
            text("SELECT 1 FROM facility_sections WHERE term_code = :t AND crn = :crn"),
            {"t": term_code, "crn": row["crn"]},
        ).first() is not None
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
        # section's meetings are tens of rows, not thousands. What is being replaced is
        # read first, though: it is the only evidence that a deleted class ever existed.
        held = {
            (held_row["meets_on"], held_row["starts_at"], held_row["ends_at"]): held_row["room"]
            for held_row in connection.execute(
                text("""SELECT meets_on, starts_at, ends_at, room FROM facility_meetings
                        WHERE term_code = :t AND crn = :crn"""),
                {"t": term_code, "crn": row["crn"]},
            ).mappings()
        }
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
        if known:
            self._note_changes(connection, term_code, row, held=held, now=set(seen), stamp=stamp)

    def _note_changes(  # noqa: PLR0913 - the section, both sides of the comparison, and when
        self,
        connection: Any,
        term_code: str,
        row: dict[str, Any],
        *,
        held: dict[tuple[str, str, str], str],
        now: set[tuple[str, str, str]],
        stamp: str,
    ) -> None:
        """Write down what this sweep took away and what it brought, for a section we knew.

        A class that moved hour leaves both a removal and an addition. That is the honest
        reading: nothing here can tell a move from a deletion plus an unrelated booking,
        and a coordinator looking at the diff can, because they know the course.
        """
        rooms = {
            (meeting["meetsOn"], meeting["startsAt"], meeting["endsAt"]): meeting.get("room", "")
            for meeting in row.get("meetings", [])
        }
        changes = [("removed", slot, held[slot]) for slot in sorted(set(held) - now)]
        changes += [("added", slot, rooms.get(slot, "")) for slot in sorted(now - set(held))]
        for kind, (meets_on, starts_at, ends_at), room in changes:
            connection.execute(
                text("""INSERT INTO facility_meeting_changes
                            (id, term_code, crn, noticed_at, kind, meets_on, starts_at, ends_at, room)
                        VALUES (:id, :t, :crn, :at, :kind, :on, :start, :end, :room)"""),
                {
                    "id": str(uuid.uuid4()),
                    "t": term_code,
                    "crn": row["crn"],
                    "at": stamp,
                    "kind": kind,
                    "on": meets_on,
                    "start": starts_at,
                    "end": ends_at,
                    "room": room,
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

    def classes_changed(self, term_code: str) -> list[dict[str, Any]]:
        """Sections whose classes the registrar has changed, and the shape they are in now.

        Three things, because three things can be true of a class: it has gone, it is
        still there, or it has arrived. Nothing here calls a deletion and an arrival a
        move. The registrar's meetings carry no identity from one sweep to the next, so
        "moved" would be a guess wearing the clothes of a fact — a coordinator looking at
        a Tuesday gone and a Thursday arrived in the same week can read it themselves, and
        is the only one entitled to.

        Grouped by section rather than by sweep, because the question a coordinator has is
        "what happened to this course", not "what happened on Tuesday".

        The diff is against what was true when the section was first seen, not a history of
        everything the portal has ever said: a class deleted and put back is not news, and
        neither is one added and then taken away again. Each slot's first change says what
        it was to begin with and its last says what it is now, which is all it takes to
        hold that line however many times a sweep changes its mind.

        Each section carries a key that holds still while the same classes have changed.
        That is what lets a coordinator's approval last exactly as long as the fact it was
        about: the same change stays approved, and one more class going or arriving changes
        the key and asks again.

        Only our own sections. The sweep also covers the ~35 electives our students sit in
        elsewhere, because a clash with one of those is real and otherwise invisible — but
        a class the Spanish department deletes from its own option is their business, and
        naming their teacher in a warning on our teachers' page is how a banner earns the
        right to be ignored. The changes are still recorded for everything swept, so a
        section that becomes ours arrives with its history already kept.
        """
        with self.engine.connect() as connection:
            changes = (
                connection.execute(
                    text("""SELECT c.crn, c.noticed_at, c.kind, c.meets_on,
                                   c.starts_at, c.ends_at, c.room
                            FROM facility_meeting_changes c
                            JOIN facility_sections s
                              ON s.term_code = c.term_code AND s.crn = c.crn AND s.ours
                            WHERE c.term_code = :t
                            ORDER BY c.noticed_at, c.meets_on, c.starts_at"""),
                    {"t": term_code},
                )
                .mappings()
                .all()
            )
            if not changes:
                return []
            crns = sorted({row["crn"] for row in changes})
            sections = {
                row["crn"]: row
                for row in connection.execute(
                    text("""SELECT crn, course_code, title, teacher_name, schedule_state
                            FROM facility_sections WHERE term_code = :t AND crn = ANY(:crns)"""),
                    {"t": term_code, "crns": crns},
                ).mappings()
            }
            # Our own cancellations for these sections. A class we said would not happen
            # and the registrar has now deleted is the registrar agreeing with us, not
            # news — but it is still a gap in the month, so it is shown and marked. There
            # is no answering half for arrivals: the department's own record knows how to
            # cancel a class and how to have it covered, and nothing else.
            cancelled = {
                (str(row[0]), str(row[1]), str(row[2]))
                for row in connection.execute(
                    text("""SELECT crn, meets_on, starts_at FROM session_changes
                            WHERE term_code = :t AND crn = ANY(:crns) AND kind = 'cancelled'"""),
                    {"t": term_code, "crns": crns},
                )
            }
            standing: dict[str, list[dict[str, str]]] = {}
            for row in connection.execute(
                text("""SELECT crn, meets_on, starts_at, ends_at, room FROM facility_meetings
                        WHERE term_code = :t AND crn = ANY(:crns)
                        ORDER BY meets_on, starts_at"""),
                {"t": term_code, "crns": crns},
            ).mappings():
                standing.setdefault(row["crn"], []).append(
                    {
                        "meetsOn": row["meets_on"],
                        "startsAt": row["starts_at"],
                        "endsAt": row["ends_at"],
                        "room": row["room"] or "",
                    }
                )

        # What each slot was when we met it, and what it is now. The pair is the whole
        # diff: same word twice is a change that stands, two different words is a slot
        # that has come back to where it began and is nobody's news.
        began: dict[tuple[str, tuple[str, str, str]], str] = {}
        ended: dict[tuple[str, tuple[str, str, str]], Any] = {}
        for row in changes:
            named = (row["crn"], (row["meets_on"], row["starts_at"], row["ends_at"]))
            began.setdefault(named, row["kind"])
            ended[named] = row

        net: dict[str, dict[str, dict[tuple[str, str, str], Any]]] = {}
        for (crn, slot), row in ended.items():
            if began[(crn, slot)] != row["kind"]:
                continue
            net.setdefault(crn, {"removed": {}, "added": {}})[row["kind"]][slot] = row

        found = []
        for crn in crns:
            change = net.get(crn)
            if not change:
                continue
            lost = []
            news: list[tuple[str, str, str]] = []
            for slot in sorted(change["removed"]):
                row = change["removed"][slot]
                known = (crn, slot[0], slot[1]) in cancelled
                lost.append(
                    {
                        "meetsOn": row["meets_on"],
                        "startsAt": row["starts_at"],
                        "endsAt": row["ends_at"],
                        "room": row["room"] or "",
                        "weCancelled": known,
                    }
                )
                if not known:
                    news.append(slot)
            arrived = [
                {
                    "meetsOn": slot[0],
                    "startsAt": slot[1],
                    "endsAt": slot[2],
                    "room": change["added"][slot]["room"] or "",
                }
                for slot in sorted(change["added"])
            ]
            # Every removal already ours and nothing new arrived. The section keeps its
            # place in nobody's warning: a coordinator who cancels classes regularly would
            # otherwise be shown their own work back, which is how people learn to ignore
            # a banner.
            if not news and not arrived:
                continue
            noticed = max(
                [change["removed"][slot]["noticed_at"] for slot in news]
                + [row["noticed_at"] for row in change["added"].values()],
                default="",
            )
            section = sections.get(crn)
            found.append(
                {
                    "crn": crn,
                    "courseCode": (section or {}).get("course_code", ""),
                    "title": (section or {}).get("title", ""),
                    "teacherName": (section or {}).get("teacher_name", ""),
                    "scheduleState": (section or {}).get("schedule_state", ""),
                    "removed": lost,
                    "added": arrived,
                    # What was there before and is there still, so the diff can be drawn
                    # rather than counted. The arrivals are standing classes too, and they
                    # are told apart here rather than in the drawing: a month that painted
                    # one square twice would be a month nobody could read.
                    "kept": [
                        meeting
                        for meeting in standing.get(crn, [])
                        if (meeting["meetsOn"], meeting["startsAt"], meeting["endsAt"]) not in change["added"]
                    ],
                    "noticedAt": noticed,
                    # Named after what is news. A class we cancelled ourselves joining the
                    # list later must not reopen a warning somebody has already answered.
                    "key": change_key(term_code, crn, removed=news, added=sorted(change["added"])),
                }
            )
        return sorted(
            found,
            key=lambda section: (-(len(section["removed"]) + len(section["added"])), section["crn"]),
        )

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
