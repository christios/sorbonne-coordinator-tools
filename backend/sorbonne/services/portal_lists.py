"""The portal's courses, teachers and a student's registrations, kept the way its students are.

Students taught the pattern: a saved filter is a fixed question to the registrar portal,
a sync is the answer to that question today, and the difference between the two answers
is the only honest way to say "no longer in the portal". The three lists here follow it
exactly, so a coordinator who knows the Students page knows these.

What is shared and what is not is decided per list, not per row. A course and a teacher
are the department's public business — the timetable prints both — and are kept whole.
A registration is a student id against a CRN, which is the same fact a group assignment
already is; the student's name arrives with the pull and goes no further than the browser.

A term link ties a Student Hub semester to the portal term code it is, so a CRN typed in
a group, a CRN the Hub teaches, and a CRN the portal registered can be the same CRN.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from sorbonne.services.section_collisions import collisions
from sorbonne.services.student_database import (
    DuplicateFilterName,
    FilterNotFound,
    StudentDatabase,
    _check_criteria,
    _clean_ids,
    _now,
    _text,
)

KINDS = ("courses", "teachers", "registrations")


class UnknownKind(Exception):
    pass


class ActiveCourseNotFound(Exception):
    """An active course id nothing holds any more."""


class InvalidParent(ValueError):
    """A parent CRN that would make nonsense of the register, and why."""


class PortalTeacherNotFound(Exception):
    """The portal has no such teacher — the list it came from is older than the list here."""


class PortalTeacherAlreadyLinked(Exception):
    """Somebody else on the department's list is already that portal profile."""


class ActiveTeacherNotFound(Exception):
    pass


@dataclass(frozen=True)
class Mismatch:
    """One way a student's registration differs from the group we placed them in."""

    student_id: str
    term_id: str
    term_code: str
    course_code: str
    # missing: placed, not registered · wrong: registered elsewhere · extra: registered in
    # a section we did not place them in · unplaced: registered, but in no group of ours ·
    # doubled: registered in two sections of one set, which no student can attend
    kind: str
    # Every section of this course our blocks give the student: a course taught as a
    # lecture and a tutorial gives them two, and both are right.
    expected: list[str]
    registered: list[str]
    # The set a `doubled` verdict is about. Empty for the verdicts that are about a course.
    scope_code: str = ""

    def as_payload(self) -> dict[str, Any]:
        return {
            "studentId": self.student_id,
            "termId": self.term_id,
            "termCode": self.term_code,
            "courseCode": self.course_code,
            "kind": self.kind,
            "scopeCode": self.scope_code,
            "expected": self.expected,
            "registered": self.registered,
        }


class FacilityWindows(Protocol):
    """Just enough of the registrar's timetable to know when a section runs.

    A protocol rather than the store itself, so this module does not depend on the
    facilities one and a test can hand in a dict of dates. It is also the honest size of
    the dependency: the check wants two dates per section and nothing else.
    """

    def windows_for(self, term_code: str, crns: list[str]) -> dict[str, tuple[str, str]]: ...


@dataclass(frozen=True)
class TermCoverage:
    """How much of a cohort the register could be asked about at all, one semester.

    A check that reports no differences has said one of two very different things: that
    the registrar agrees with us, or that nobody has ever asked it. The old check could not
    tell them apart — it walked the linked semesters and skipped every student no pull had
    returned, counting nothing either time — so a cohort nobody had ever checked showed
    exactly the clean Warnings column of a cohort that was perfectly registered.

    Three integers rather than a verdict, because the three cases want different actions:

    - `pulled_in_term == 0` — no registrations pull covers this semester at all. Sync.
    - `pulled_in_term > 0` and `judged == 0` — pulls exist and returned nobody from this
      cohort, which means the filter they ran under is scoped to another population.
    - `0 < blind < members` — stragglers. N students the last pull did not return.

    `blind` is stored rather than derived. It equals `len(skipped)`, but the wire carries
    the integer so nothing on the far side has to size a list to tell the cases apart.
    """

    term_id: str
    #: Empty when nobody has linked this semester to a portal term — the first case, and
    #: the one that used to be silent.
    term_code: str
    members: int
    judged: int
    blind: int
    #: By id only. A name never reaches this server, and coverage is not the place to start.
    skipped: list[str]
    #: Students of ANY cohort the term's registration pulls have returned. It separates
    #: "nothing has been pulled" from "something was, and none of it was ours".
    pulled_in_term: int
    #: Our own sections the registrar has given no timetable for. A section with no dates
    #: cannot be told to be over, so it goes on being expected all year — which is the old
    #: behaviour, kept deliberately, and named here so it is a declared fallback rather
    #: than a silent one. Both halves of a handover among these are still both expected.
    undated_crns: list[str] = field(default_factory=list)

    def as_payload(self) -> dict[str, Any]:
        return {
            "termId": self.term_id,
            "termCode": self.term_code,
            "members": self.members,
            "judged": self.judged,
            "blind": self.blind,
            "skipped": self.skipped,
            "pulledInTerm": self.pulled_in_term,
            "undatedCrns": self.undated_crns,
        }


@dataclass(frozen=True)
class RegistrationReport:
    """The differences, and how much of the cohort they were looked for in.

    One record rather than two returns, so that every caller is forced by the type to have
    seen the coverage. A list of mismatches on its own is a number without its error bar.
    """

    mismatches: list[Mismatch]
    coverage: list[TermCoverage]


class UnknownDisposition(Exception):
    """A collision can be accepted or referred, and nothing else."""


class PortalListStore:
    def __init__(self, database_url: str) -> None:
        self.engine = create_engine(database_url, pool_pre_ping=False, pool_recycle=300)

    # ------------------------------------------------------------------ filters

    def list_filters(self, kind: str) -> list[dict[str, Any]]:
        _kind(kind)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("SELECT * FROM portal_filters WHERE kind = :kind ORDER BY name"), {"kind": kind}
                )
                .mappings()
                .all()
            )
            held = self._held_counts(connection, kind)
        return [self._filter(row, held.get(row["id"], (0, 0))) for row in rows]

    def get_filter(self, filter_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM portal_filters WHERE id = :id"), {"id": filter_id})
                .mappings()
                .first()
            )
            if row is None:
                raise FilterNotFound(filter_id)
            held = self._held_counts(connection, row["kind"])
        return self._filter(row, held.get(filter_id, (0, 0)))

    def create_filter(self, *, kind: str, name: str, criteria: dict[str, Any], actor: str = "") -> dict[str, Any]:
        _kind(kind)
        checked = _check_criteria(criteria, allow_empty=True)
        identifier = str(uuid4())
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    text("""INSERT INTO portal_filters (id, kind, name, filter, created_at, updated_by)
                            VALUES (:id, :kind, :name, :filter, :now, :actor)"""),
                    {
                        "id": identifier,
                        "kind": kind,
                        "name": _text(name),
                        "filter": json.dumps(checked),
                        "now": _now(),
                        "actor": _text(actor),
                    },
                )
        except IntegrityError as exc:
            raise DuplicateFilterName(name) from exc
        return self.get_filter(identifier)

    def delete_filter(self, filter_id: str) -> None:
        with self.engine.begin() as connection:
            deleted = connection.execute(text("DELETE FROM portal_filters WHERE id = :id"), {"id": filter_id}).rowcount
        if deleted == 0:
            raise FilterNotFound(filter_id)

    def _filter(self, row: Any, held: tuple[int, int]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "name": row["name"],
            "filter": row["filter"] if isinstance(row["filter"], dict) else json.loads(row["filter"] or "{}"),
            "held": held[0],
            "gone": held[1],
            "lastSyncedAt": row["last_synced_at"],
            "createdAt": row["created_at"],
            "updatedBy": row["updated_by"],
        }

    def _held_counts(self, connection: Connection, kind: str) -> dict[str, tuple[int, int]]:
        table = {
            "courses": "portal_course_members",
            "teachers": "portal_teacher_members",
            "registrations": "portal_registration_members",
        }[kind]
        rows = connection.execute(
            text(f"""SELECT filter_id,
                            count(*) FILTER (WHERE status = 'in_portal') AS held,
                            count(*) FILTER (WHERE status <> 'in_portal') AS gone
                     FROM {table} GROUP BY filter_id""")  # noqa: S608 - table from a fixed map
        ).all()
        return {row[0]: (int(row[1]), int(row[2])) for row in rows}

    # ------------------------------------------------------------------ courses

    def sync_courses(self, filter_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        """What this filter's question returned about courses today."""
        held_filter = self.get_filter(filter_id)
        if held_filter["kind"] != "courses":
            raise UnknownKind(held_filter["kind"])
        now = _now()
        found: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            key = (_text(row.get("termCode")), _text(row.get("crn")))
            if all(key):
                found[key] = row
        with self.engine.begin() as connection:
            held = {
                (row[0], row[1])
                for row in connection.execute(
                    text("SELECT term_code, crn FROM portal_course_members WHERE filter_id = :f"),
                    {"f": filter_id},
                )
            }
            if found:
                connection.execute(
                    text("""INSERT INTO portal_courses
                                (term_code, crn, course_code, title, subject, sequence, part_of_term,
                                 part_of_term_desc, credits, department, level, college, contact_hours,
                                 teacher_name, registered, begins, ends, status, first_seen_at, last_seen_at)
                            VALUES (:term_code, :crn, :course_code, :title, :subject, :sequence, :part_of_term,
                                    :part_of_term_desc, :credits, :department, :level, :college, :contact_hours,
                                    :teacher_name, :registered, :begins, :ends, 'in_portal', :now, :now)
                            ON CONFLICT (term_code, crn) DO UPDATE SET
                                course_code = excluded.course_code, title = excluded.title,
                                subject = excluded.subject, sequence = excluded.sequence,
                                part_of_term = excluded.part_of_term,
                                part_of_term_desc = excluded.part_of_term_desc,
                                credits = excluded.credits, department = excluded.department,
                                level = excluded.level, college = excluded.college,
                                contact_hours = excluded.contact_hours, teacher_name = excluded.teacher_name,
                                registered = excluded.registered, begins = excluded.begins,
                                ends = excluded.ends, status = 'in_portal', last_seen_at = :now"""),
                    [self._course_params(key, row, now) for key, row in found.items()],
                )
                connection.execute(
                    text("""INSERT INTO portal_course_members (filter_id, term_code, crn, status)
                            VALUES (:f, :term_code, :crn, 'in_portal')
                            ON CONFLICT (filter_id, term_code, crn) DO UPDATE SET status = 'in_portal'"""),
                    [{"f": filter_id, "term_code": key[0], "crn": key[1]} for key in found],
                )
            gone = [key for key in held if key not in found]
            missing = 0
            for term_code, crn in gone:
                missing += connection.execute(
                    text("""UPDATE portal_course_members SET status = 'not_in_portal'
                            WHERE filter_id = :f AND term_code = :t AND crn = :c AND status <> 'not_in_portal'"""),
                    {"f": filter_id, "t": term_code, "c": crn},
                ).rowcount
                connection.execute(
                    text("""UPDATE portal_courses SET status = 'not_in_portal', last_seen_at = last_seen_at
                            WHERE term_code = :t AND crn = :c AND NOT EXISTS (
                                SELECT 1 FROM portal_course_members m
                                 WHERE m.term_code = :t AND m.crn = :c AND m.status = 'in_portal')"""),
                    {"t": term_code, "c": crn},
                )
            connection.execute(
                text("UPDATE portal_filters SET last_synced_at = :now WHERE id = :f"), {"now": now, "f": filter_id}
            )
        return {
            "seen": len(found),
            "added": len([key for key in found if key not in held]),
            "missing": missing,
            "syncedAt": now,
        }

    @staticmethod
    def _course_params(key: tuple[str, str], row: dict[str, Any], now: str) -> dict[str, Any]:
        return {
            "term_code": key[0],
            "crn": key[1],
            "course_code": _text(row.get("courseCode")),
            "title": _text(row.get("title")),
            "subject": _text(row.get("subject")),
            "sequence": _text(row.get("sequence")),
            "part_of_term": _text(row.get("partOfTerm")),
            "part_of_term_desc": _text(row.get("partOfTermDesc")),
            "credits": _text(row.get("credits")),
            "department": _text(row.get("department")),
            "level": _text(row.get("level")),
            "college": _text(row.get("college")),
            "contact_hours": _text(row.get("contactHours")),
            "teacher_name": _people(row.get("teacherName")),
            "registered": _int(row.get("registered")),
            "begins": _text(row.get("begins")),
            "ends": _text(row.get("ends")),
            "now": now,
        }

    def list_courses(self, term_code: str = "", filter_id: str = "") -> list[dict[str, Any]]:
        """The courses held: one term's, one filter's, or all."""
        clauses = []
        params: dict[str, Any] = {}
        if term_code:
            clauses.append("c.term_code = :term")
            params["term"] = term_code
        if filter_id:
            clauses.append(
                "EXISTS (SELECT 1 FROM portal_course_members m WHERE m.filter_id = :f"
                " AND m.term_code = c.term_code AND m.crn = c.crn)"
            )
            params["f"] = filter_id
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"SELECT c.* FROM portal_courses c{where} ORDER BY c.term_code, c.course_code, c.crn"),  # noqa: S608
                    params,
                )
                .mappings()
                .all()
            )
        return [_course(row) for row in rows]

    def course_terms(self) -> list[str]:
        with self.engine.connect() as connection:
            return [
                row[0]
                for row in connection.execute(
                    text("SELECT DISTINCT term_code FROM portal_courses ORDER BY term_code DESC")
                )
            ]

    # ----------------------------------------------------------------- teachers

    def sync_teachers(self, filter_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        held_filter = self.get_filter(filter_id)
        if held_filter["kind"] != "teachers":
            raise UnknownKind(held_filter["kind"])
        now = _now()
        found: dict[str, dict[str, Any]] = {}
        for row in rows:
            teacher_id = _text(row.get("teacherId")).upper()
            if teacher_id:
                found[teacher_id] = row
        with self.engine.begin() as connection:
            held = {
                row[0]
                for row in connection.execute(
                    text("SELECT teacher_id FROM portal_teacher_members WHERE filter_id = :f"), {"f": filter_id}
                )
            }
            if found:
                connection.execute(
                    text("""INSERT INTO portal_teachers
                                (teacher_id, full_name, teacher_status, category, type, last_term, credits,
                                 courses_count, periods_count, students_count, department, rank, courses,
                                 institution, psuad_email, status, first_seen_at, last_seen_at)
                            VALUES (:teacher_id, :full_name, :teacher_status, :category, :type, :last_term,
                                    :credits, :courses_count, :periods_count, :students_count, :department,
                                    :rank, :courses, :institution, :psuad_email, 'in_portal', :now, :now)
                            ON CONFLICT (teacher_id) DO UPDATE SET
                                full_name = excluded.full_name, teacher_status = excluded.teacher_status,
                                category = excluded.category, type = excluded.type,
                                last_term = excluded.last_term, credits = excluded.credits,
                                courses_count = excluded.courses_count, periods_count = excluded.periods_count,
                                students_count = excluded.students_count, department = excluded.department,
                                rank = excluded.rank, courses = excluded.courses,
                                institution = excluded.institution, psuad_email = excluded.psuad_email,
                                status = 'in_portal', last_seen_at = :now"""),
                    [self._teacher_params(teacher_id, row, now) for teacher_id, row in found.items()],
                )
                connection.execute(
                    text("""INSERT INTO portal_teacher_members (filter_id, teacher_id, status)
                            VALUES (:f, :t, 'in_portal')
                            ON CONFLICT (filter_id, teacher_id) DO UPDATE SET status = 'in_portal'"""),
                    [{"f": filter_id, "t": teacher_id} for teacher_id in found],
                )
            gone = [teacher_id for teacher_id in held if teacher_id not in found]
            missing = 0
            if gone:
                missing = connection.execute(
                    text("""UPDATE portal_teacher_members SET status = 'not_in_portal'
                            WHERE filter_id = :f AND teacher_id = ANY(:ids) AND status <> 'not_in_portal'"""),
                    {"f": filter_id, "ids": gone},
                ).rowcount
                connection.execute(
                    text("""UPDATE portal_teachers SET status = 'not_in_portal'
                            WHERE teacher_id = ANY(:ids) AND NOT EXISTS (
                                SELECT 1 FROM portal_teacher_members m
                                 WHERE m.teacher_id = portal_teachers.teacher_id AND m.status = 'in_portal')"""),
                    {"ids": gone},
                )
            connection.execute(
                text("UPDATE portal_filters SET last_synced_at = :now WHERE id = :f"), {"now": now, "f": filter_id}
            )
        return {
            "seen": len(found),
            "added": len([teacher_id for teacher_id in found if teacher_id not in held]),
            "missing": missing,
            "syncedAt": now,
        }

    @staticmethod
    def _teacher_params(teacher_id: str, row: dict[str, Any], now: str) -> dict[str, Any]:
        return {
            "teacher_id": teacher_id,
            "full_name": _text(row.get("fullName")),
            "teacher_status": _text(row.get("status")),
            "category": _text(row.get("category")),
            "type": _text(row.get("type")),
            "last_term": _text(row.get("lastTerm")),
            "credits": _text(row.get("credits")),
            "courses_count": _text(row.get("coursesCount")),
            "periods_count": _text(row.get("periodsCount")),
            "students_count": _text(row.get("studentsCount")),
            "department": _text(row.get("department")),
            "rank": _text(row.get("rank")),
            "courses": _text(row.get("courses")),
            "institution": _text(row.get("institution")),
            "psuad_email": _text(row.get("psuadEmail")),
            "now": now,
        }

    def list_teachers(self, filter_id: str = "") -> list[dict[str, Any]]:
        where = ""
        params: dict[str, Any] = {}
        if filter_id:
            where = (
                " WHERE EXISTS (SELECT 1 FROM portal_teacher_members m"
                " WHERE m.filter_id = :f AND m.teacher_id = t.teacher_id)"
            )
            params["f"] = filter_id
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"SELECT t.* FROM portal_teachers t{where} ORDER BY t.full_name, t.teacher_id"),  # noqa: S608
                    params,
                )
                .mappings()
                .all()
            )
        return [_teacher(row) for row in rows]

    # ------------------------------------------------------------ registrations

    def sync_registrations(self, filter_id: str, term_code: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        """What the portal says each student in the pull is registered in, this term.

        The unit is the student, not the row: a student the pull returned has exactly the
        CRNs the pull returned for them, and a student this filter held and the pull no
        longer returns has left the population — their registrations for the term go with
        them. Only ids and CRNs are written; the names in the pull stop here.
        """
        held_filter = self.get_filter(filter_id)
        if held_filter["kind"] != "registrations":
            raise UnknownKind(held_filter["kind"])
        term = _text(term_code)
        if not term:
            raise ValueError("A registrations pull needs its term code.")
        now = _now()
        by_student: dict[str, dict[str, str]] = {}
        for row in rows:
            student = _text(row.get("studentId")).upper()
            crn = _text(row.get("crn"))
            if student and crn:
                by_student.setdefault(student, {})[crn] = _text(row.get("courseCode"))
        students = _clean_ids(list(by_student))
        with self.engine.begin() as connection:
            held = {
                row[0]
                for row in connection.execute(
                    text("""SELECT student_id FROM portal_registration_members
                            WHERE filter_id = :f AND term_code = :t"""),
                    {"f": filter_id, "t": term},
                )
            }
            if students:
                connection.execute(
                    text("""INSERT INTO student_registrations
                                (term_code, student_id, crn, course_code, status, first_seen_at, last_seen_at)
                            VALUES (:t, :s, :c, :code, 'in_portal', :now, :now)
                            ON CONFLICT (term_code, student_id, crn) DO UPDATE SET
                                course_code = excluded.course_code, status = 'in_portal', last_seen_at = :now"""),
                    [
                        {"t": term, "s": student, "c": crn, "code": code, "now": now}
                        for student, crns in by_student.items()
                        for crn, code in crns.items()
                    ],
                )
                # A CRN a returned student held last time and not this time: dropped.
                for student, crns in by_student.items():
                    connection.execute(
                        text("""UPDATE student_registrations SET status = 'not_in_portal'
                                WHERE term_code = :t AND student_id = :s AND NOT (crn = ANY(:crns))"""),
                        {"t": term, "s": student, "crns": list(crns)},
                    )
                connection.execute(
                    text("""INSERT INTO portal_registration_members (filter_id, term_code, student_id, status)
                            VALUES (:f, :t, :s, 'in_portal')
                            ON CONFLICT (filter_id, term_code, student_id) DO UPDATE SET status = 'in_portal'"""),
                    [{"f": filter_id, "t": term, "s": student} for student in students],
                )
            gone = [student for student in held if student not in by_student]
            missing = 0
            if gone:
                missing = connection.execute(
                    text("""UPDATE portal_registration_members SET status = 'not_in_portal'
                            WHERE filter_id = :f AND term_code = :t AND student_id = ANY(:ids)
                              AND status <> 'not_in_portal'"""),
                    {"f": filter_id, "t": term, "ids": gone},
                ).rowcount
                connection.execute(
                    text("""UPDATE student_registrations SET status = 'not_in_portal'
                            WHERE term_code = :t AND student_id = ANY(:ids) AND NOT EXISTS (
                                SELECT 1 FROM portal_registration_members m
                                 WHERE m.term_code = :t AND m.student_id = student_registrations.student_id
                                   AND m.status = 'in_portal')"""),
                    {"t": term, "ids": gone},
                )
            connection.execute(
                text("UPDATE portal_filters SET last_synced_at = :now WHERE id = :f"), {"now": now, "f": filter_id}
            )
        return {
            "seen": len(students),
            "rows": sum(len(crns) for crns in by_student.values()),
            "added": len([student for student in students if student not in held]),
            "missing": missing,
            "syncedAt": now,
        }

    def registrations_of(self, student_id: str) -> list[dict[str, Any]]:
        """One student's registrations, every term, with what the courses list knows of each CRN."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT r.term_code, r.crn, r.status, r.last_seen_at,
                                   coalesce(nullif(r.course_code, ''), c.course_code, '') AS course_code,
                                   coalesce(c.title, '') AS title, coalesce(c.teacher_name, '') AS teacher_name
                            FROM student_registrations r
                            LEFT JOIN portal_courses c ON c.term_code = r.term_code AND c.crn = r.crn
                            WHERE r.student_id = :s
                            ORDER BY r.term_code DESC, course_code, r.crn"""),
                    {"s": _text(student_id).upper()},
                )
                .mappings()
                .all()
            )
        return [
            {
                "termCode": row["term_code"],
                "crn": row["crn"],
                "courseCode": row["course_code"],
                "title": row["title"],
                "teacherName": row["teacher_name"],
                "status": row["status"],
                "lastSeenAt": row["last_seen_at"],
            }
            for row in rows
        ]

    def registered_in(self, term_code: str) -> dict[str, dict[str, list[str]]]:
        """`student -> course code -> CRNs` for one term, in-portal rows only."""
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT r.student_id, r.crn,
                               coalesce(nullif(r.course_code, ''), c.course_code, '') AS course_code
                        FROM student_registrations r
                        LEFT JOIN portal_courses c ON c.term_code = r.term_code AND c.crn = r.crn
                        WHERE r.term_code = :t AND r.status = 'in_portal'"""),
                {"t": term_code},
            ).all()
        held: dict[str, dict[str, list[str]]] = {}
        for student, crn, code in rows:
            held.setdefault(student, {}).setdefault(code, []).append(crn)
        return held

    def timetable_targets(self, term_code: str) -> dict[str, list[str]]:
        """Which CRNs to ask the registrar's timetable about, split by whose they are.

        Taken from `student_registrations`, which is the only list that holds the electives
        — the ~44 sections of other departments our students sit in, where a collision with
        one of ours is real and is otherwise invisible. `portal_courses` is not a
        substitute: it was synced with DEPT_CODE=SCEN and knows nothing outside it.

        Split rather than merged, because the two halves are answerable separately: asking
        the registrar about another department's rooms is a different question from asking
        about our own, and shipping with the second half switched off must stay possible.
        """
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT DISTINCT r.crn,
                               EXISTS (SELECT 1 FROM active_course_crns a
                                        WHERE a.term_code = r.term_code AND a.crn = r.crn) AS ours
                        FROM student_registrations r
                        WHERE r.term_code = :t AND r.status = 'in_portal' AND r.crn <> ''"""),
                {"t": term_code},
            ).all()
        ours = sorted(crn for crn, mine in rows if mine)
        return {"ours": ours, "registered": sorted(crn for crn, mine in rows if not mine)}

    def pulled_students(self, term_code: str) -> set[str]:
        """Who any registrations filter has returned this term — the only students a check may judge."""
        with self.engine.connect() as connection:
            return {
                row[0]
                for row in connection.execute(
                    text("""SELECT DISTINCT student_id FROM portal_registration_members
                            WHERE term_code = :t AND status = 'in_portal'"""),
                    {"t": term_code},
                )
            }

    # ---------------------------------------------------------- active teachers

    def list_active_teachers(self) -> list[dict[str, Any]]:
        """The department's own list, with what the portal knows about each when it is there."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT a.*, p.teacher_status, p.category, p.type, p.last_term, p.department,
                                   p.rank, p.courses, p.institution, p.status AS portal_status,
                                   -- The portal first, and what was stored only where it is silent.
                                   -- A row linked to a portal profile is that profile: the registrar
                                   -- is where a name is corrected and where an address is issued, and
                                   -- a part-time record written a year ago should not outrank it.
                                   coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), '') AS shown_name,
                                   coalesce(nullif(p.psuad_email, ''), nullif(a.email, ''), '') AS shown_email
                            FROM active_teachers a
                            LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                            ORDER BY shown_name, a.id""")
                )
                .mappings()
                .all()
            )
            # What each of them is actually down to teach, from our own planning. Two
            # numbers rather than one: `sections` is how many name them at all, `linked`
            # how many do it by a chosen id rather than free text — and the gap between the
            # two IS the worklist. On the real data 137 sections carry a name and 0 carry a
            # link, so a single count would say "not in our planning" about every teacher in
            # the department and read as a bug rather than as a backlog.
            planned = connection.execute(
                text("""SELECT gc.teacher_id, count(*) FROM group_crns gc
                        WHERE gc.crn <> '' AND gc.retired = false AND coalesce(gc.teacher_id, '') <> ''
                        GROUP BY gc.teacher_id""")
            ).all()
            written = [
                (row[0], row[1])
                for row in connection.execute(
                    text("""SELECT coalesce(gc.teacher, ''), count(*) FROM group_crns gc
                            WHERE gc.crn <> '' AND gc.retired = false AND coalesce(gc.teacher, '') <> ''
                            GROUP BY coalesce(gc.teacher, '')""")
                )
            ]
        linked_by_id = dict(planned)
        held = []
        for row in rows:
            teacher = _active(row)
            # Named-but-not-linked is matched through `names_agree`, the same rule the
            # register drift uses, so "El Sayed" and "Elsayed" are one person here too.
            named = sum(count for name, count in written if names_agree(teacher["fullName"], name))
            teacher["linkedSections"] = linked_by_id.get(row["id"], 0)
            teacher["sections"] = teacher["linkedSections"] + named
            held.append(teacher)
        return held

    def unlinked_portal_matches(self) -> list[dict[str, Any]]:
        """Active teachers who came from the part-time database and look like a portal profile.

        A teacher joins the portal's lists when they are first paid through it, which can be
        months after the department started counting on them. Nothing about a sync notices:
        it writes the portal's own tables and never touches ours, so the person quietly
        becomes two — a part-time row with no portal columns, and a portal row nobody has
        added. Adding the second is what creates the duplicate, and the e-mail match that
        would have prevented it fails exactly when the part-time record holds a personal
        address, which is the normal case for somebody not yet issued a university one.

        So they are matched on the name instead, and only ever offered: a name is not proof,
        and joining two records is not something to do to somebody behind their back.
        """
        with self.engine.connect() as connection:
            active = connection.execute(text("SELECT * FROM active_teachers")).mappings().all()
            portal = (
                connection.execute(
                    text("SELECT teacher_id, full_name, psuad_email, status FROM portal_teachers")
                )
                .mappings()
                .all()
            )
        taken = {row["portal_teacher_id"] for row in active if row["portal_teacher_id"]}
        by_name: dict[str, list[Any]] = {}
        for row in portal:
            if row["teacher_id"] in taken:
                continue
            by_name.setdefault(_name_key(row["full_name"]), []).append(row)

        found: list[dict[str, Any]] = []
        for row in active:
            if row["portal_teacher_id"] or not row["part_time_teacher_id"]:
                continue
            # One candidate only. Two people of the same name is a question for a person.
            candidates = by_name.get(_name_key(row["full_name"]), [])
            if len(candidates) != 1:
                continue
            match = candidates[0]
            found.append(
                {
                    "activeId": row["id"],
                    "activeName": row["full_name"],
                    "activeEmail": row["email"],
                    "portalTeacherId": match["teacher_id"],
                    "portalName": match["full_name"],
                    "portalEmail": match["psuad_email"] or "",
                    "portalStatus": match["status"],
                }
            )
        return sorted(found, key=lambda entry: entry["activeName"].casefold())

    def link_active_teacher(self, active_id: str, portal_teacher_id: str) -> None:
        """Say that this active teacher is that portal profile, and let the profile lead.

        The row keeps its part-time id, so the two sides stay joined; from here its name,
        its address and everything else on screen are the portal's.
        """
        teacher_id = _text(portal_teacher_id).upper()
        with self.engine.begin() as connection:
            row = (
                connection.execute(text("SELECT * FROM active_teachers WHERE id = :id"), {"id": active_id})
                .mappings()
                .first()
            )
            if row is None:
                raise ActiveTeacherNotFound(active_id)
            portal = (
                connection.execute(
                    text("SELECT teacher_id FROM portal_teachers WHERE teacher_id = :t"), {"t": teacher_id}
                )
                .mappings()
                .first()
            )
            if portal is None:
                raise PortalTeacherNotFound(teacher_id)
            already = (
                connection.execute(
                    text("SELECT id FROM active_teachers WHERE portal_teacher_id = :t AND id <> :id"),
                    {"t": teacher_id, "id": active_id},
                )
                .mappings()
                .first()
            )
            if already is not None:
                raise PortalTeacherAlreadyLinked(teacher_id)
            connection.execute(
                text("UPDATE active_teachers SET portal_teacher_id = :t WHERE id = :id"),
                {"t": teacher_id, "id": active_id},
            )

    def add_active_teachers(
        self,
        *,
        portal_teacher_ids: list[str],
        part_time: list[dict[str, str]],
        actor: str = "",
    ) -> dict[str, int]:
        """Choose teachers from the portal, or bring them from the part-time database.

        One person, one row: a portal teacher whose university e-mail is already on an
        active record from the part-time side is joined to it rather than listed twice,
        and the other way round. A portal id the portal list does not hold is skipped.
        """
        now = _now()
        added = linked = skipped = 0
        with self.engine.begin() as connection:
            held = connection.execute(text("SELECT * FROM active_teachers")).mappings().all()
            by_portal = {row["portal_teacher_id"]: row for row in held if row["portal_teacher_id"]}
            by_part_time = {row["part_time_teacher_id"]: row for row in held if row["part_time_teacher_id"]}
            by_email = {row["email"].casefold(): row for row in held if row["email"]}

            for raw in portal_teacher_ids:
                teacher_id = _text(raw).upper()
                if not teacher_id or teacher_id in by_portal:
                    skipped += 1
                    continue
                portal = (
                    connection.execute(
                        text("SELECT full_name, psuad_email FROM portal_teachers WHERE teacher_id = :t"),
                        {"t": teacher_id},
                    )
                    .mappings()
                    .first()
                )
                if portal is None:
                    skipped += 1
                    continue
                email = _text(portal["psuad_email"])
                same = by_email.get(email.casefold()) if email else None
                if same is not None and not same["portal_teacher_id"]:
                    connection.execute(
                        text("UPDATE active_teachers SET portal_teacher_id = :t WHERE id = :id"),
                        {"t": teacher_id, "id": same["id"]},
                    )
                    linked += 1
                    continue
                connection.execute(
                    text("""INSERT INTO active_teachers
                                (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                            VALUES (:id, :t, '', :name, :email, :now, :actor)"""),
                    {
                        "id": str(uuid4()),
                        "t": teacher_id,
                        "name": _text(portal["full_name"]),
                        "email": email,
                        "now": now,
                        "actor": _text(actor),
                    },
                )
                by_portal[teacher_id] = {"portal_teacher_id": teacher_id}
                if email:
                    by_email[email.casefold()] = {"id": "", "portal_teacher_id": teacher_id, "part_time_teacher_id": ""}
                added += 1

            for record in part_time:
                part_time_id = _text(record.get("id"))
                if not part_time_id or part_time_id in by_part_time:
                    skipped += 1
                    continue
                email = _text(record.get("email"))
                same = by_email.get(email.casefold()) if email else None
                if same is not None and same.get("id") and not same["part_time_teacher_id"]:
                    connection.execute(
                        text("UPDATE active_teachers SET part_time_teacher_id = :p WHERE id = :id"),
                        {"p": part_time_id, "id": same["id"]},
                    )
                    linked += 1
                    continue
                connection.execute(
                    text("""INSERT INTO active_teachers
                                (id, portal_teacher_id, part_time_teacher_id, full_name, email, added_at, added_by)
                            VALUES (:id, '', :p, :name, :email, :now, :actor)"""),
                    {
                        "id": str(uuid4()),
                        "p": part_time_id,
                        "name": _text(record.get("fullName")),
                        "email": email,
                        "now": now,
                        "actor": _text(actor),
                    },
                )
                by_part_time[part_time_id] = {"part_time_teacher_id": part_time_id}
                added += 1
        return {"added": added, "linked": linked, "skipped": skipped}

    def remove_active_teacher(self, active_id: str) -> None:
        with self.engine.begin() as connection:
            removed = connection.execute(text("DELETE FROM active_teachers WHERE id = :id"), {"id": active_id}).rowcount
        if removed == 0:
            raise ActiveTeacherNotFound(active_id)

    # ---------------------------------------------------------- active courses

    def list_active_crns(self, term_code: str = "") -> list[dict[str, Any]]:
        """The register: our CRNs, each with what the portal says about it beside it."""
        clause = " AND r.term_code = :term" if term_code else ""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"""SELECT r.*, a.title AS course_title, a.ue, a.mutualized,
                                    p.title AS portal_title, p.teacher_name, p.registered,
                                    p.status AS portal_status, p.sequence, p.part_of_term_desc,
                                    p.credits, p.contact_hours,
                                    pp.title AS parent_title, pp.status AS parent_status,
                                    pp.course_code AS parent_course_code,
                                    (SELECT count(*) FROM group_crns gc WHERE gc.crn = r.crn) AS used_by,
                                    (SELECT count(*) FROM active_course_crns k
                                      WHERE k.term_code = r.term_code AND k.parent_crn = r.crn) AS child_count
                             FROM active_course_crns r
                             LEFT JOIN active_courses a ON a.course_code = r.course_code
                             LEFT JOIN portal_courses p
                                    ON p.term_code = r.term_code AND p.crn = r.crn
                             LEFT JOIN portal_courses pp
                                    ON pp.term_code = r.term_code AND pp.crn = r.parent_crn
                             WHERE 1 = 1{clause}
                             ORDER BY r.course_code, r.crn"""),  # noqa: S608
                    {"term": term_code} if term_code else {},
                )
                .mappings()
                .all()
            )
        return [_active_crn(row) for row in rows]

    def add_active_crns(
        self, *, course_codes: list[str], crns: list[dict[str, str]], actor: str = ""
    ) -> dict[str, int]:
        """Take CRNs into the register: every one the portal lists for a course, or named ones.

        A course brings its CRNs in when it is chosen; the ones the registrar makes later
        are flagged rather than taken in behind the coordinator's back, and this is how
        they are taken in.
        """
        now, added, skipped = _now(), 0, 0
        with self.engine.begin() as connection:
            held = {
                (row[0], row[1])
                for row in connection.execute(text("SELECT term_code, crn FROM active_course_crns"))
            }
            wanted: list[tuple[str, str, str]] = []
            for raw in course_codes:
                code = _text(raw).upper()
                if not code:
                    continue
                wanted.extend(
                    (row[0], row[1], code)
                    for row in connection.execute(
                        text("SELECT term_code, crn FROM portal_courses WHERE upper(course_code) = :code"),
                        {"code": code},
                    )
                )
            for record in crns:
                term_code, crn = _text(record.get("termCode")), _text(record.get("crn"))
                if not crn:
                    continue
                code = _text(record.get("courseCode")).upper()
                if not code:
                    code = _text(
                        connection.execute(
                            text("SELECT upper(course_code) FROM portal_courses WHERE crn = :crn LIMIT 1"),
                            {"crn": crn},
                        ).scalar()
                    )
                wanted.append((term_code, crn, code))
            for term_code, crn, code in wanted:
                if not code or (term_code, crn) in held:
                    skipped += 1
                    continue
                connection.execute(
                    text("""INSERT INTO active_course_crns
                                (id, term_code, crn, course_code, parent_crn, added_at, added_by)
                            VALUES (:id, :term_code, :crn, :course_code, '', :now, :actor)"""),
                    {
                        "id": str(uuid4()),
                        "term_code": term_code,
                        "crn": crn,
                        "course_code": code,
                        "now": now,
                        "actor": _text(actor),
                    },
                )
                held.add((term_code, crn))
                added += 1
        return {"added": added, "skipped": skipped}

    def update_active_crn(self, crn_id: str, *, parent_crn: str) -> dict[str, Any]:
        """What this section hangs from. The one thing about a CRN that is ours to say.

        The register is two deep and no deeper: a CRN the sections hang from is the top of
        its course, so it cannot hang from anything itself, and nothing may hang from a
        section. Refused here rather than only in the picker, because the register is what
        the timetable workbook's Parent CRN column is written from.
        """
        parent = _text(parent_crn)
        with self.engine.begin() as connection:
            held = (
                connection.execute(
                    text("SELECT term_code, crn FROM active_course_crns WHERE id = :id"), {"id": crn_id}
                )
                .mappings()
                .first()
            )
            if held is None:
                raise ActiveCourseNotFound(crn_id)
            if parent:
                if parent == held["crn"]:
                    raise InvalidParent("A CRN cannot hang from itself.")
                children = connection.execute(
                    text("""SELECT count(*) FROM active_course_crns
                            WHERE term_code = :term AND parent_crn = :crn"""),
                    {"term": held["term_code"], "crn": held["crn"]},
                ).scalar()
                if children:
                    raise InvalidParent(
                        f"{held['crn']} is the parent of {children} CRN(s), and a parent cannot have one."
                    )
                above = connection.execute(
                    text("""SELECT parent_crn FROM active_course_crns
                            WHERE term_code = :term AND crn = :crn"""),
                    {"term": held["term_code"], "crn": parent},
                ).scalar()
                if _text(above):
                    raise InvalidParent(f"{parent} hangs from {_text(above)} itself, so nothing may hang from it.")
            connection.execute(
                text("UPDATE active_course_crns SET parent_crn = :parent WHERE id = :id"),
                {"id": crn_id, "parent": parent},
            )
        return next(row for row in self.list_active_crns() if row["id"] == crn_id)

    def remove_active_crn(self, crn_id: str) -> None:
        with self.engine.begin() as connection:
            removed = connection.execute(
                text("DELETE FROM active_course_crns WHERE id = :id"), {"id": crn_id}
            ).rowcount
        if removed == 0:
            raise ActiveCourseNotFound(crn_id)

    def section_collisions(self, term_code: str) -> dict[str, list[dict[str, Any]]]:
        """Our sections sharing an hour with a section we do not own — see `section_collisions`.

        Empty when nobody has swept the registrar's timetable for this term, which is
        *blind* rather than *none*: the caller says which, since a page that reported "no
        collisions" from an empty record would be making the same claim about a question
        nobody has asked that this whole record exists to stop.
        """
        if not term_code:
            return {"collides": [], "settledCollisions": []}
        with self.engine.connect() as connection:
            meetings = [
                (row[0], row[1], row[2], row[3])
                for row in connection.execute(
                    text("""SELECT m.crn, m.meets_on, m.starts_at, m.ends_at
                            FROM facility_meetings m
                            JOIN facility_sections s ON s.term_code = m.term_code AND s.crn = m.crn
                            WHERE m.term_code = :t AND s.schedule_state <> 'gone'"""),
                    {"t": term_code},
                )
            ]
            ours = {
                row[0]
                for row in connection.execute(
                    text("SELECT crn FROM active_course_crns WHERE term_code = :t"), {"t": term_code}
                )
            }
            courses = dict(
                connection.execute(
                    text("""SELECT crn, coalesce(nullif(course_code, ''), '') FROM facility_sections
                            WHERE term_code = :t"""),
                    {"t": term_code},
                ).all()
            )
            registered: dict[str, set[str]] = {}
            for crn, student in connection.execute(
                text("""SELECT crn, student_id FROM student_registrations
                        WHERE term_code = :t AND status = 'in_portal'"""),
                {"t": term_code},
            ):
                registered.setdefault(crn, set()).add(student)
            settled = {
                (row["our_crn"], row["weekday"], row["starts_at"], row["ends_at"]): dict(row)
                for row in connection.execute(
                    text("SELECT * FROM section_collision_notes WHERE term_code = :t"), {"t": term_code}
                ).mappings()
            }
        return collisions(
            meetings=meetings, ours=ours, courses=courses, registered=registered, settled=settled
        )

    def live_crns(self) -> list[str]:
        """Every CRN a live section of our planning holds, whichever cohort or semester.

        Term-blind and cohort-blind, exactly as `used_by` is: a CRN is the portal's own
        identifier and matching it on anything else would lose the sets open to every
        cohort, which is the whole class of thing this keeps failing to see.
        """
        with self.engine.connect() as connection:
            return sorted(
                row[0]
                for row in connection.execute(
                    text("SELECT DISTINCT crn FROM group_crns WHERE crn <> '' AND retired = false")
                )
            )

    def has_facility_pull(self, term_code: str) -> bool:
        """Whether the registrar's timetable has ever been swept for this term.

        The difference between "no collisions" and "nobody has looked", which are the same
        empty list and very different sentences.
        """
        if not term_code:
            return False
        with self.engine.connect() as connection:
            return bool(
                connection.execute(
                    text("SELECT 1 FROM facility_pulls WHERE term_code = :t LIMIT 1"), {"t": term_code}
                ).scalar()
            )

    def settle_collision(  # noqa: PLR0913 - one argument per part of the key, plus the verdict
        self,
        *,
        term_code: str,
        our_crn: str,
        weekday: str,
        starts_at: str,
        ends_at: str,
        disposition: str,
        note: str = "",
        actor: str = "",
    ) -> None:
        """Accept a collision, or record that it has been referred. Empty disposition unsettles it.

        Keyed on our own section's slot, so the note expires by itself when the registrar
        moves that section: the slot it was about stops existing and the row stops matching.
        The same fact-shaped-key discipline as a warning's, with no expiry to keep track of.

        Server-side rather than in the browser's dismissal store, and deliberately: every
        input here is the server's and identical for every coordinator, so a decision one
        of them takes is a decision the department has taken.
        """
        if disposition and disposition not in {"accepted", "referred"}:
            raise UnknownDisposition(disposition)
        with self.engine.begin() as connection:
            if not disposition:
                connection.execute(
                    text("""DELETE FROM section_collision_notes
                            WHERE term_code = :t AND our_crn = :crn AND weekday = :d
                              AND starts_at = :s AND ends_at = :e"""),
                    {"t": term_code, "crn": our_crn, "d": weekday, "s": starts_at, "e": ends_at},
                )
                return
            connection.execute(
                text("""INSERT INTO section_collision_notes
                            (term_code, our_crn, their_crn, weekday, starts_at, ends_at,
                             disposition, note, settled_at, settled_by)
                        VALUES (:t, :crn, '', :d, :s, :e, :disposition, :note, :at, :by)
                        ON CONFLICT (term_code, our_crn, their_crn, weekday, starts_at, ends_at)
                        DO UPDATE SET disposition = excluded.disposition, note = excluded.note,
                                      settled_at = excluded.settled_at, settled_by = excluded.settled_by"""),
                {"t": term_code, "crn": our_crn, "d": weekday, "s": starts_at, "e": ends_at,
                 "disposition": disposition, "note": _text(note)[:400], "at": _now(), "by": actor},
            )

    def teacher_drift(self, term_code: str = "") -> dict[str, list[dict[str, Any]]]:
        """Who our planning says teaches a section, against who the registrar has on it.

        Two questions, not one, because they are cleared differently. A section the
        registrar staffs and our planning does not is a line to copy across; a section
        where the two name different people is a conversation with somebody.

        Names are compared through `names_agree` rather than as strings. On the real data a
        plain comparison reports twenty-six disagreements, and five of the eleven distinct
        pairs among them are nothing but where the space falls in a surname — "El Sayed"
        against "Elsayed". Reporting those would bury the four that are real, one of which
        is two entirely different people on one section.

        `TBD` and its friends are not names. A section our planning has not staffed yet is
        `unnamed`, never a disagreement: it is a different problem with a different answer.
        """
        term = _text(term_code)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT gc.crn, c.code AS course_code, g.label AS group_label,
                                   coalesce(t.full_name, '') AS linked,
                                   coalesce(gc.teacher, '') AS written,
                                   coalesce(p.teacher_name, '') AS theirs,
                                   p.crn IS NOT NULL AS in_portal
                            FROM group_crns gc
                            JOIN scope_courses c ON c.id = gc.course_id
                            JOIN scope_groups g ON g.id = gc.group_id
                            LEFT JOIN active_teachers t ON t.id = gc.teacher_id
                            LEFT JOIN portal_courses p
                                   ON p.crn = gc.crn AND p.status = 'in_portal'
                                  AND (:term = '' OR p.term_code = :term)
                            WHERE gc.crn <> '' AND gc.retired = false
                            ORDER BY c.code, gc.crn"""),
                    {"term": term},
                )
                .mappings()
                .all()
            )

        differs: list[dict[str, Any]] = []
        unnamed: list[dict[str, Any]] = []
        for row in rows:
            # A linked teacher is the department's answer; free text is the department
            # still writing it down. Either is "who we say", and the state says which.
            ours = row["linked"] or row["written"]
            if not row["in_portal"] or not named(row["theirs"]):
                continue
            entry = {
                "crn": row["crn"],
                "courseCode": row["course_code"],
                "groupLabel": row["group_label"],
                "ours": ours,
                "theirs": row["theirs"],
                "planning": _planning_state(row["linked"], row["written"]),
            }
            if not named(ours):
                unnamed.append(entry)
            elif not names_agree(ours, row["theirs"]):
                differs.append(entry)
        return {"teacherDiffers": differs, "teacherUnnamed": unnamed}

    def register_check(self, term_code: str = "") -> dict[str, list[dict[str, Any]]]:
        """Where the registrar's list and the department's register have moved apart.

        Three questions, the ones a coordinator acts on: what we hold that the portal has
        stopped listing, what the portal lists for our courses that we have not taken in,
        and what a course card is teaching under a CRN nobody registered.
        """
        term = _text(term_code)
        params: dict[str, Any] = {"term": term} if term else {}
        where_register = " AND r.term_code = :term" if term else ""
        where_portal = " AND p.term_code = :term" if term else ""
        with self.engine.connect() as connection:
            gone = (
                connection.execute(
                    text(f"""SELECT r.id, r.term_code, r.crn, r.course_code,
                                    (SELECT count(*) FROM group_crns gc WHERE gc.crn = r.crn) AS used_by,
                                    (SELECT count(*) FROM active_course_crns k
                                      WHERE k.term_code = r.term_code AND k.parent_crn = r.crn) AS child_count
                             FROM active_course_crns r
                             LEFT JOIN portal_courses p
                                    ON p.term_code = r.term_code AND p.crn = r.crn
                             WHERE (p.crn IS NULL OR p.status <> 'in_portal'){where_register}
                             ORDER BY r.course_code, r.crn"""),  # noqa: S608
                    params,
                )
                .mappings()
                .all()
            )
            arrived = (
                connection.execute(
                    text(f"""SELECT p.term_code, p.crn, upper(p.course_code) AS course_code,
                                    p.title, p.teacher_name, p.registered
                             FROM portal_courses p
                             JOIN active_courses a ON a.course_code = upper(p.course_code)
                             WHERE p.status = 'in_portal'
                               AND NOT EXISTS (SELECT 1 FROM active_course_crns r
                                                WHERE r.term_code = p.term_code AND r.crn = p.crn)
                               {where_portal}
                             ORDER BY upper(p.course_code), p.crn"""),  # noqa: S608
                    params,
                )
                .mappings()
                .all()
            )
            unregistered = (
                connection.execute(
                    text("""SELECT DISTINCT gc.crn, c.code AS course_code
                            FROM group_crns gc
                            JOIN scope_courses c ON c.id = gc.course_id
                            WHERE gc.crn <> '' AND gc.retired = false
                              AND NOT EXISTS (SELECT 1 FROM active_course_crns r WHERE r.crn = gc.crn)
                            ORDER BY c.code, gc.crn""")
                )
                .mappings()
                .all()
            )
        return {
            "gone": [
                {
                    "id": row["id"],
                    "termCode": row["term_code"],
                    "crn": row["crn"],
                    "courseCode": row["course_code"],
                    "usedBy": int(row["used_by"] or 0),
                }
                for row in gone
            ],
            "arrived": [
                {
                    "termCode": row["term_code"],
                    "crn": row["crn"],
                    "courseCode": row["course_code"],
                    "title": row["title"],
                    "teacherName": row["teacher_name"],
                    "registered": int(row["registered"] or 0),
                }
                for row in arrived
            ],
            "unregistered": [
                {"crn": row["crn"], "courseCode": row["course_code"]} for row in unregistered
            ],
        }

    def list_active_courses(self) -> list[dict[str, Any]]:
        """The department's own list of courses, with how the portal knows each."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT a.*,
                                   (SELECT count(*) FROM active_course_crns r
                                     WHERE r.course_code = a.course_code) AS crn_count,
                                   (SELECT count(*) FROM portal_courses c
                                     WHERE upper(c.course_code) = a.course_code) AS portal_crn_count,
                                   (SELECT count(DISTINCT c.term_code) FROM portal_courses c
                                     WHERE upper(c.course_code) = a.course_code) AS term_count,
                                   (SELECT max(c.term_code) FROM portal_courses c
                                     WHERE upper(c.course_code) = a.course_code) AS last_term
                            FROM active_courses a
                            ORDER BY a.course_code""")
                )
                .mappings()
                .all()
            )
            parents = {row["course_code"]: _parent_row(connection, row["course_code"]) for row in rows}
        return [_active_course(row, parents.get(row["course_code"])) for row in rows]

    def add_active_courses(
        self, *, course_codes: list[str], by_hand: list[dict[str, str]], actor: str = ""
    ) -> dict[str, int]:
        """Choose courses from the portal's list, or add one the portal does not list yet.

        One code, one row, however many CRNs or terms the portal lists it in: the title
        is the portal's latest word for it. A code the portal list does not hold is
        skipped rather than invented — that is what the by-hand path is for.
        """
        now = _now()
        added = skipped = 0
        with self.engine.begin() as connection:
            held = {
                row[0]
                for row in connection.execute(text("SELECT course_code FROM active_courses"))
            }
            for raw in course_codes:
                code = _text(raw).upper()
                if not code or code in held:
                    skipped += 1
                    continue
                title = _course_title(connection, code)
                if title is None:
                    skipped += 1
                    continue
                self._insert_active_course(connection, code, title, now, actor)
                self._take_in_crns(connection, code, now, actor)
                held.add(code)
                added += 1
            for record in by_hand:
                code = _text(record.get("courseCode")).upper()
                if not code or code in held:
                    skipped += 1
                    continue
                self._insert_active_course(connection, code, _text(record.get("title")), now, actor)
                self._take_in_crns(connection, code, now, actor)
                held.add(code)
                added += 1
        return {"added": added, "skipped": skipped}

    @staticmethod
    def _take_in_crns(connection: Connection, code: str, now: str, actor: str) -> None:
        """Every CRN the portal lists for this course, as the register's rows."""
        for term_code, crn in connection.execute(
            text("SELECT term_code, crn FROM portal_courses WHERE upper(course_code) = :code"),
            {"code": code},
        ):
            connection.execute(
                text("""INSERT INTO active_course_crns
                            (id, term_code, crn, course_code, parent_crn, added_at, added_by)
                        VALUES (:id, :term_code, :crn, :code, '', :now, :actor)
                        ON CONFLICT (term_code, crn) DO NOTHING"""),
                {"id": str(uuid4()), "term_code": term_code, "crn": crn, "code": code, "now": now, "actor": actor},
            )

    @staticmethod
    def _insert_active_course(connection: Connection, code: str, title: str, now: str, actor: str) -> None:
        connection.execute(
            text("""INSERT INTO active_courses (id, course_code, title, ue, added_at, added_by)
                    VALUES (:id, :code, :title, '', :now, :actor)"""),
            {"id": str(uuid4()), "code": code, "title": title, "now": now, "actor": _text(actor)},
        )

    def update_active_course(
        self, active_id: str, *, title: str, ue: str, mutualized: str = ""
    ) -> dict[str, Any]:
        """The course's own facts: what to call it, its Sorbonne UE, and whether it is
        taught to both degrees at once. The parent CRN is a fact of each section, and
        lives on the register's CRN rows."""
        if mutualized not in ("", "yes", "no"):
            raise ValueError("A course is mutualized, not mutualized, or nobody has said.")
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("UPDATE active_courses SET title = :title, ue = :ue, mutualized = :mutualized WHERE id = :id"),
                {"id": active_id, "title": _text(title), "ue": _text(ue), "mutualized": mutualized},
            ).rowcount
        if updated == 0:
            raise ActiveCourseNotFound(active_id)
        return next(course for course in self.list_active_courses() if course["id"] == active_id)

    def remove_active_course(self, active_id: str) -> None:
        with self.engine.begin() as connection:
            code = connection.execute(
                text("SELECT course_code FROM active_courses WHERE id = :id"), {"id": active_id}
            ).scalar()
            # Its CRNs go with it: they were in the register because the course was.
            if code:
                connection.execute(
                    text("DELETE FROM active_course_crns WHERE course_code = :code"), {"code": code}
                )
            removed = connection.execute(text("DELETE FROM active_courses WHERE id = :id"), {"id": active_id}).rowcount
        if removed == 0:
            raise ActiveCourseNotFound(active_id)

    # --------------------------------------------------------------- term links

    def term_links(self) -> dict[str, str]:
        with self.engine.connect() as connection:
            return dict(
                connection.execute(
                    text("SELECT term_id, portal_term_code FROM term_links WHERE portal_term_code <> ''")
                ).all()
            )

    def link_term(self, term_id: str, portal_term_code: str) -> dict[str, str]:
        code = _text(portal_term_code)
        with self.engine.begin() as connection:
            if code:
                connection.execute(
                    text("""INSERT INTO term_links (term_id, portal_term_code) VALUES (:t, :c)
                            ON CONFLICT (term_id) DO UPDATE SET portal_term_code = excluded.portal_term_code"""),
                    {"t": term_id, "c": code},
                )
            else:
                connection.execute(text("DELETE FROM term_links WHERE term_id = :t"), {"t": term_id})
        return {"termId": term_id, "portalTermCode": code}

    def crns_for_term(self, term_id: str) -> dict[str, Any]:
        """Every portal CRN of the term a Hub semester is linked to, keyed by CRN."""
        code = self.term_links().get(term_id, "")
        if not code:
            return {"portalTermCode": "", "crns": {}}
        return {
            "portalTermCode": code,
            "crns": {
                course["crn"]: {
                    "courseCode": course["courseCode"],
                    "title": course["title"],
                    "teacherName": course["teacherName"],
                    "status": course["status"],
                }
                for course in self.list_courses(code)
            },
        }

    # ---------------------------------------------------------- the comparison

    def registration_check(
        self,
        cohort_id: str,
        database: StudentDatabase,
        facilities: FacilityWindows | None = None,
        on: str = "",
    ) -> RegistrationReport:
        """Where the portal's registrations differ from the groups we placed a cohort in.

        Judged per course of our blocks, per student the registrations pull has returned:
        placed and not registered is *missing*; registered in another section is *wrong*;
        registered in ours and another is *extra*; registered while in no group of ours is
        *unplaced*. A CRN outside our blocks — a language course, say — is not our business
        and is not mentioned. A student no pull has returned is still not judged.

        But now they are COUNTED. The silence is unchanged and the verdicts are unchanged;
        what is new is that the answer says how much of the cohort it rests on. Two things
        used to vanish without a word: a semester nobody had linked to a portal term, which
        this walked straight past, and a student no pull had returned, which it skipped
        without recording. Both produced the same clean Warnings column as a cohort that
        was genuinely correct.

        The walk is the union of the semesters this cohort is on and the linked ones. Both
        halves earn their place: `scope_terms` adds the unlinked semesters, which is the
        point, and the links are kept so that every mismatch found today is still found —
        `_doubled_in_a_set` reads the whole semester, not just this cohort's part of it.
        Coverage, though, is reported only for the semesters the cohort is actually on: a
        linked semester it has no part in has nothing to say, and "0 of 145 checked" about
        a semester a cohort is not taught in is a false alarm, not a floor.

        `facilities` makes the expectation date-aware — see `_expected_on`. Optional, and
        absent it behaves exactly as before: every section our planning holds for a course
        code is expected every day, which is wrong for anything taught in two halves. `on`
        is the day being judged, today unless a caller says otherwise.
        """
        today = on or _today()
        links = self.term_links()
        present = set(database.scope_terms(cohort_id))
        members = database.cohort_members(cohort_id)
        found: list[Mismatch] = []
        coverage: list[TermCoverage] = []
        for term_id in sorted(present | set(links)):
            term_code = links.get(term_id, "")
            # Two sections of one set, before anything about placement is asked.
            found.extend(self._doubled_in_a_set(cohort_id, term_id, term_code, database))
            cohort = next(
                (entry for entry in database.term_publication(term_id) if entry["cohortId"] == cohort_id), None
            )
            groups = {group["id"]: group for group in cohort["groups"]} if cohort else {}
            ours = sorted(
                {crn for group in groups.values() for crns in group["crns"].values() for crn in crns if crn}
            )
            # When the registrar's timetable is on hand, a section that is not running is
            # not expected. When it is not, every section stays expected and the coverage
            # says which ones that fallback applied to.
            windows = facilities.windows_for(term_code, ours) if facilities and term_code else {}
            if term_id in present:
                # Every student of the cohort, against everyone the term's pulls returned.
                # Not `cohort["students"]`: a cohort with no sets of its own on this
                # semester has no entry below at all, and it is precisely that cohort whose
                # coverage nobody has ever seen.
                pulled_here = self.pulled_students(term_code)
                judged = sorted(members & pulled_here)
                skipped = sorted(members - pulled_here)
                coverage.append(
                    TermCoverage(
                        term_id=term_id,
                        term_code=term_code,
                        members=len(members),
                        judged=len(judged),
                        blind=len(skipped),
                        skipped=skipped,
                        pulled_in_term=len(pulled_here),
                        undated_crns=[crn for crn in ours if crn not in windows],
                    )
                )
            if cohort is None:
                continue
            course_codes = sorted({code for group in groups.values() for code in group["crns"]})
            expected: dict[str, dict[str, set[str]]] = {}
            for row in cohort["assignments"]:
                group = groups.get(row["groupId"])
                if group is None:
                    continue
                for code, crns in group["crns"].items():
                    # A student is in several sets at once — a lecture group and a tutorial
                    # group — and each may carry the same course. All of their sections are
                    # expected, not whichever was read last; and a section taught in two
                    # halves is two CRNs of one course, both of which they are in.
                    expected.setdefault(row["studentId"], {}).setdefault(code, set()).update(
                        crn for crn in crns if crn
                    )
            registered = self.registered_in(term_code)
            pulled = self.pulled_students(term_code)
            for student in cohort["students"]:
                if student not in pulled:
                    continue
                found.extend(
                    _judge(
                        student,
                        term_id,
                        term_code,
                        code,
                        _expected_on(sorted(expected.get(student, {}).get(code, set())), windows, today),
                        sorted(expected.get(student, {}).get(code, set())),
                        registered.get(student, {}).get(code, []),
                    )
                    for code in course_codes
                )
        return RegistrationReport(
            mismatches=[mismatch for mismatch in found if mismatch is not None],
            coverage=coverage,
        )

    def _doubled_in_a_set(
        self, cohort_id: str, term_id: str, term_code: str, database: StudentDatabase
    ) -> list[Mismatch]:
        """Students the registrar has in two groups of one set, which nobody can attend.

        A set is a way of splitting a cohort — the lectures, the tutorials, the languages —
        and a student sits in exactly one of its groups. Two groups of one set against one
        name is a contradiction in the registration itself: it needs no opinion from us
        about where they ought to be, and it is wrong whether or not we have placed them.

        Down to the group and not to the set, because a set carries several courses and one
        group of it hands a student a CRN for each — a tutorial group with four courses is
        four registrations and entirely correct.

        Every set of the semester is looked at, not this cohort's. A set open to every
        cohort is filed under whichever cohort happens to hold its row, so reading a
        semester cohort by cohort is exactly how the languages have gone unchecked.
        """
        sets = database.term_scope_crns(term_id)
        if not sets:
            return []
        # CRN -> which group of which set. A CRN in two places is a fault of ours rather
        # than the registrar's, and not this check's to report; the first claim stands.
        where: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        for entry in sets:
            for group in entry["groups"]:
                for crn in group["crns"]:
                    where.setdefault(crn, (entry, group))

        registered = self.registered_in(term_code)
        pulled = self.pulled_students(term_code)
        found: list[Mismatch] = []
        for student in sorted(database.cohort_members(cohort_id) & pulled):
            held: dict[str, dict[str, set[str]]] = {}
            for crns in registered.get(student, {}).values():
                for crn in crns:
                    place = where.get(crn)
                    if place is None:
                        continue
                    entry, group = place
                    held.setdefault(entry["scopeId"], {}).setdefault(group["label"], set()).add(crn)
            for scope_id, groups in held.items():
                if len(groups) < 2:  # noqa: PLR2004 - one group of a set is the whole rule
                    continue
                entry = next(candidate for candidate in sets if candidate["scopeId"] == scope_id)
                found.append(
                    Mismatch(
                        student_id=student,
                        term_id=term_id,
                        term_code=term_code,
                        course_code=", ".join(sorted(groups)),
                        kind="doubled",
                        expected=[],
                        registered=sorted({crn for crns in groups.values() for crn in crns}),
                        scope_code=entry["code"],
                    )
                )
        return found


def _today() -> str:
    """The day being judged, as the ISO date the meetings are stored as.

    UTC, because that is what the rest of this file stamps with and the university is four
    hours ahead of it — so this can only ever be a few hours behind local midnight, and a
    section's window is weeks wide. A timezone would be precision the data does not have.
    """
    return datetime.now(timezone.utc).date().isoformat()


def _expected_on(crns: list[str], windows: dict[str, tuple[str, str]], on: str) -> list[str]:
    """Which sections of one course a student is expected in on one day.

    `expected` used to be every section our planning holds for a course code, all year.
    For a course taught in two halves — MATH-351 runs as 23436 until 26 October and 23820
    from 2 November — that meant both were expected every day of the year, so before the
    handover ten students were reported missing from a section that had not started and
    after it from one that had finished. Wrong every single day, in both directions.

    Three tiers, in order, and the fall-through is what keeps it safe:

    1. **Running today** — the ordinary answer, and the one that ends the handover problem.
    2. **Not yet started**, when nothing is running. That is the week between two halves:
       the first has finished, the second has not begun, and the one to be registered in
       is plainly the second. It is never *both*.
    3. **Everything**, when neither tier has anything to offer. That is a course whose
       sections have all finished, or one nobody has pulled a timetable for. Narrowing
       here would be far worse than not narrowing: an empty `expected` turns every
       registration into `unplaced`, so a term that has ended, or a registrar we have not
       asked, would fill the screen with warnings about students who are perfectly placed.

    A section with no window is kept whatever tier wins — fail open. We have not asked the
    registrar about it, or the registrar said nothing, and neither is a reason to stop
    expecting a section our own planning holds. `TermCoverage.undated_crns` says which
    ones, so the fail-open is declared rather than silent.
    """
    dated = [crn for crn in crns if crn in windows]
    undated = [crn for crn in crns if crn not in windows]
    running = [crn for crn in dated if windows[crn][0] <= on <= windows[crn][1]]
    upcoming = [crn for crn in dated if windows[crn][0] > on]
    chosen = running or upcoming
    if not chosen:
        return sorted(crns)
    return sorted({*chosen, *undated})


def _judge(  # noqa: PLR0913 - one argument per part of the verdict
    student: str,
    term_id: str,
    term_code: str,
    code: str,
    now: list[str],
    ever: list[str],
    registered: list[str],
) -> Mismatch | None:
    """One student, one course: what we placed them in against what the registrar has.

    Both sides are lists, because a course taught as a lecture and a tutorial puts a
    student in two of its sections and the registrar registers them in both. What matters
    is the difference either way: a section of ours they are not registered in, and a
    section they are registered in that is not one of ours.

    The two sides are asked of DIFFERENT lists, and that asymmetry is the whole of the
    handover fix:

    - **absent** is judged against `now`, the sections running today. A half that has not
      started is not something to be missing from.
    - **surplus** is judged against `ever`, every section our planning holds for this
      student. A half that has finished is still one of ours, and the registrar keeps them
      registered in it for the grade — so it is not a section "that is no group of theirs".

    Judging both against `now` was the first version of this and it was no better than
    being date-blind: it turned every student who had come through a handover into an
    `extra`, sixteen of them on a single course in the real data. One false warning for
    another is not a fix.
    """
    current = sorted(set(now))
    mine = sorted(set(ever))
    held = sorted(set(registered))
    absent = [crn for crn in current if crn not in held]
    surplus = [crn for crn in held if crn not in mine]
    if not mine:
        # Placed in nothing at all, ever — not merely nothing that is running today.
        kind = "unplaced" if held else ""
    elif absent and surplus:
        kind = "wrong"
    elif absent:
        kind = "missing"
    elif surplus:
        kind = "extra"
    else:
        kind = ""
    if not kind:
        return None
    # The sections they should be in NOW, because that is what the sentence is about.
    return Mismatch(student, term_id, term_code, code, kind, current, held)


def _kind(kind: str) -> None:
    if kind not in KINDS:
        raise UnknownKind(kind)


def _people(value: object) -> str:
    """The teachers of a course, as a portal course row writes them.

    The portal ends the list with a comma whether or not anybody follows: one teacher
    arrives as "Bilal Maaz,". Read it as the list it is, so a name shown beside a CRN
    reads like a name.
    """
    names = [_text(name) for name in str(value or "").split(",")]
    return ", ".join(name for name in names if name)


def _int(value: object) -> int:
    try:
        return int(str(value or "0").strip() or 0)
    except ValueError:
        return 0


def _course(row: Any) -> dict[str, Any]:
    return {
        "termCode": row["term_code"],
        "crn": row["crn"],
        "courseCode": row["course_code"],
        "title": row["title"],
        "subject": row["subject"],
        "sequence": row["sequence"],
        "partOfTerm": row["part_of_term"],
        "partOfTermDesc": row["part_of_term_desc"],
        "credits": row["credits"],
        "department": row["department"],
        "level": row["level"],
        "college": row["college"],
        "contactHours": row["contact_hours"],
        "teacherName": row["teacher_name"],
        "registered": row["registered"],
        "begins": row["begins"],
        "ends": row["ends"],
        "status": row["status"],
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
    }


def _teacher(row: Any) -> dict[str, Any]:
    return {
        "teacherId": row["teacher_id"],
        "fullName": row["full_name"],
        "teacherStatus": row["teacher_status"],
        "category": row["category"],
        "type": row["type"],
        "lastTerm": row["last_term"],
        "credits": row["credits"],
        "coursesCount": row["courses_count"],
        "periodsCount": row["periods_count"],
        "studentsCount": row["students_count"],
        "department": row["department"],
        "rank": row["rank"],
        "courses": row["courses"],
        "institution": row["institution"],
        "psuadEmail": row["psuad_email"],
        "status": row["status"],
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
    }


# A section's title says which group it is — "Pre-Calculus 1 G.A-CM", "Analysis 1-TD".
# The course's own row says none of that, which is how the two are told apart.
#
# The group marker needs its dot or its digit: "G.1", "G.A-CM", "G2". Without that, a G
# and some letters is just a word, and "Geometric Optics" was being read as a section of
# something — which is exactly how Geometric Optics lost its parent CRN.
_SECTION_TITLE = re.compile(
    r"(\bG\.\s*[0-9A-Z]+\b|\bG\s*[0-9]\w*\b|[-–]\s*(CM|TD|TP)\b|\b(CM|TD|TP)\s*$)",
    re.IGNORECASE,
)


def _parent_row(connection: Connection, code: str) -> Any:
    """The portal's own row for the course rather than for one of its sections.

    The registrar makes one CRN per course that the sections hang from: it carries the
    course's plain name, no teacher and nobody registered. That CRN is the Parent CRN of
    the timetable workbook, so finding it here is what lets the register propose one.
    """
    rows = (
        connection.execute(
            text("""SELECT term_code, crn, title, teacher_name, registered FROM portal_courses
                    WHERE upper(course_code) = :code AND status = 'in_portal'
                    ORDER BY term_code DESC, crn"""),
            {"code": code},
        )
        .mappings()
        .all()
    )
    parents = [
        row
        for row in rows
        if not _text(row["teacher_name"])
        and not int(row["registered"] or 0)
        and not _SECTION_TITLE.search(row["title"] or "")
    ]
    # More than one, and none is the obvious answer: say nothing rather than pick blind.
    return parents[0] if len(parents) == 1 else None


def _course_title(connection: Connection, code: str) -> str | None:
    """What to call the course: the name on its own row, else the newest section's."""
    parent = _parent_row(connection, code)
    if parent is not None:
        return _text(parent["title"])
    title = connection.execute(
        text("""SELECT title FROM portal_courses WHERE upper(course_code) = :code
                ORDER BY term_code DESC, crn LIMIT 1"""),
        {"code": code},
    ).scalar()
    return None if title is None else _text(title)


def _active_crn(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "termCode": row["term_code"],
        "crn": row["crn"],
        "courseCode": row["course_code"],
        "parentCrn": row["parent_crn"],
        # What the course says, the same on every CRN of it.
        "courseTitle": row["course_title"] or "",
        "ue": row["ue"] or "",
        # Whether both degrees sit in it together — the course's own fact, on every CRN.
        "mutualized": row["mutualized"] or "",
        # What the portal says about this CRN, or nothing when it lists it no longer.
        "portalTitle": row["portal_title"] or "",
        "teacherName": row["teacher_name"] or "",
        "registered": int(row["registered"] or 0),
        "portalStatus": row["portal_status"] or "not_listed",
        "sequence": row["sequence"] or "",
        "partOfTerm": row["part_of_term_desc"] or "",
        "credits": row["credits"] or "",
        "contactHours": row["contact_hours"] or "",
        # The parent as the portal knows it, so a link that leads nowhere shows as one.
        "parentTitle": row["parent_title"] or "",
        "parentStatus": ("" if not row["parent_crn"] else (row["parent_status"] or "not_listed")),
        "parentCourseCode": (row["parent_course_code"] or "").upper(),
        # How many of the register's CRNs hang from this one, which is what makes it a parent.
        "childCount": int(row["child_count"] or 0),
        # How many sections of a course card teach under it.
        "usedBy": int(row["used_by"] or 0),
        "addedAt": row["added_at"],
        "addedBy": row["added_by"],
    }


def _active_course(row: Any, parent: Any = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "courseCode": row["course_code"],
        "title": row["title"],
        "ue": row["ue"],
        # "" unsaid · "yes" taught to both degrees at once · "no" to one of them alone.
        "mutualized": row["mutualized"] or "",
        "addedAt": row["added_at"],
        "addedBy": row["added_by"],
        # How many of its CRNs the register holds, and how many the portal lists.
        "crnCount": int(row["crn_count"] or 0),
        "portalCrnCount": int(row["portal_crn_count"] or 0),
        "termCount": int(row["term_count"] or 0),
        "lastTerm": row["last_term"] or "",
        # The CRN the portal's own row for this course has, which the register offers as
        # each section's parent. Empty when the portal has no such row, or more than one.
        "portalParentCrn": "" if parent is None else parent["crn"],
    }


# Titles the registrar and the department disagree about, which are not part of a name.
_TITLES = {"dr", "pr", "prof", "professor", "mr", "ms", "mrs", "mme", "m"}


#: What people write in a teacher column when there is no teacher yet. Not names, and
#: treating them as names turns "nobody has been assigned" into "the registrar disagrees",
#: which is a different problem with a different answer.
_PLACEHOLDERS = {"tbd", "tba", "na", "n a", "none", "unknown", "vacant", "staff", "?", "-", "--"}


def named(name: str) -> bool:
    """Whether this teacher column actually names somebody."""
    key = _name_key(name)
    return bool(key) and key not in _PLACEHOLDERS


def _runs(name: str) -> set[str]:
    """The name's letters with every space closed up, in both orders the two sides use it.

    The registrar and the department disagree about where the space falls in a good half of
    the Arabic and French surnames here — El Sayed/Elsayed, El Dakkak/ElDakkak, De
    Masi/Demasi, El Rifai/ElRifai, El Sawy/Elsawy. Five of the eleven disagreements in the
    real data are nothing but that, and reporting them would bury the four that are real.

    Closing the spaces has to happen BEFORE the words are sorted, or it does not work at
    all: "Omar El Dakkak" sorts to `dakkak el omar` and "Omar ElDakkak" to `eldakkak omar`,
    and joining those gives two different strings. So the letters are kept in the order
    they were written, and the reversed order is offered as well — which is the one
    reordering that actually happens, the registrar writing some people family-name-first.

    Deliberately not a sorted multiset of letters. That would match these and every anagram
    besides, and a rule that can silently declare two different teachers to be one person
    has no business in a timetable.
    """
    # From `_name_words`, not `_name_key`: the key SORTS, and sorting before the spaces
    # close up is exactly what stops this working — "Safaa El Sayed" sorts to
    # `el safaa sayed` and "Safaa Elsayed" to `elsayed safaa`, which join to two different
    # strings however they are compared afterwards.
    words = _name_words(name)
    return {"".join(words), "".join(reversed(words))} if words else set()


def _words(name: str) -> set[str]:
    return set(_name_key(name).split())


def names_agree(ours: str, theirs: str) -> bool:
    """Whether two teacher columns name the same person, allowing for how each spells it.

    Both sides are LISTS: the registrar ends a teacher column with a comma whether or not
    anybody follows, and a section really can be taught by two people. So this asks whether
    the two lists have anyone in common, not whether they are equal.

    Three ways to be the same person, and each earns its place on the real data:

    - the same key outright;
    - the same letters with the spaces closed up, for the surnames the two sides break
      differently;
    - one name's words inside the other's, for a middle name only one side carries —
      "Claude Vishnu Spaak" is "Claude Spaak".

    What it deliberately does NOT do is measure how close two spellings are. "Wafaa Ahmed"
    against "Wafa Ahmed" is one letter and almost certainly one person; "Sara Khaled"
    against "Diaa Mereib" is two people, and no distance that accepts the first while
    refusing the second is one anybody should trust with a timetable. Those stay on the
    list for a person to settle.
    """
    mine = [part for part in ours.split(",") if named(part)]
    yours = [part for part in theirs.split(",") if named(part)]
    if not mine or not yours:
        return False
    if {_name_key(part) for part in mine} & {_name_key(part) for part in yours}:
        return True
    if {run for part in mine for run in _runs(part)} & {run for part in yours for run in _runs(part)}:
        return True
    return any(
        _words(a) <= _words(b) or _words(b) <= _words(a)
        for a in mine
        for b in yours
        if _words(a) and _words(b)
    )


def _planning_state(linked: str, written: str) -> str:
    """How firmly our own planning names a teacher for a section. Three states, not two.

    *planned* — linked to a row in the department's own teacher list, so the name follows
    the person when the registrar corrects it.
    *named* — written down as text and nobody has joined it to that list yet. This is the
    worklist, and on the real data it is 137 sections against 0 linked ones.
    *unplanned* — nobody at all.

    A boolean would report "not in our planning" for essentially every section in the
    department and read as a bug rather than as a backlog.
    """
    if named(linked):
        return "planned"
    return "named" if named(written) else "unplanned"


def _name_words(name: str) -> list[str]:
    """The words of a name, folded and stripped of titles, IN THE ORDER THEY WERE WRITTEN.

    Split out from `_name_key` because two different questions are asked of the same
    folding: which words a name has, and which order they came in. The key wants the first
    and sorts them; `_runs` wants the second and cannot use a sorted list at all.
    """
    folded = unicodedata.normalize("NFKD", _text(name).casefold())
    stripped = "".join(character for character in folded if not unicodedata.combining(character))
    # Split on anything that is not a letter or a digit, so "PR.Simone" is two words and
    # the title comes off with the rest.
    words = [word for word in re.split(r"[^\w]+", stripped) if word]
    return [word for word in words if word not in _TITLES]


def _name_key(name: str) -> str:
    """A name reduced to what two spellings of the same person have in common.

    Case, accents, punctuation and titles go; the words are sorted, because the registrar
    writes some people family-name-first and the part-time database does not. It is a key
    for offering a match, never for making one.
    """
    return " ".join(sorted(_name_words(name)))


def _active(row: Any) -> dict[str, Any]:
    source = (
        "both"
        if row["portal_teacher_id"] and row["part_time_teacher_id"]
        else "portal"
        if row["portal_teacher_id"]
        else "part-time"
    )
    return {
        "id": row["id"],
        "portalTeacherId": row["portal_teacher_id"],
        "partTimeTeacherId": row["part_time_teacher_id"],
        "fullName": row["shown_name"],
        "email": row["shown_email"],
        "source": source,
        "addedAt": row["added_at"],
        "addedBy": row["added_by"],
        "teacherStatus": row["teacher_status"] or "",
        "category": row["category"] or "",
        "type": row["type"] or "",
        "lastTerm": row["last_term"] or "",
        "department": row["department"] or "",
        "rank": row["rank"] or "",
        "courses": row["courses"] or "",
        "institution": row["institution"] or "",
        "portalStatus": row["portal_status"] or "",
    }
