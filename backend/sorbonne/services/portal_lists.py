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
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

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
    # a second section too · unplaced: registered, but in no group of ours
    kind: str
    expected: str
    registered: list[str]

    def as_payload(self) -> dict[str, Any]:
        return {
            "studentId": self.student_id,
            "termId": self.term_id,
            "termCode": self.term_code,
            "courseCode": self.course_code,
            "kind": self.kind,
            "expected": self.expected,
            "registered": self.registered,
        }


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
            "teacher_name": _text(row.get("teacherName")),
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
                                   coalesce(nullif(a.full_name, ''), p.full_name, '') AS shown_name,
                                   coalesce(nullif(a.email, ''), p.psuad_email, '') AS shown_email
                            FROM active_teachers a
                            LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                            ORDER BY shown_name, a.id""")
                )
                .mappings()
                .all()
            )
        return [_active(row) for row in rows]

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
                    text(f"""SELECT r.*, a.title AS course_title, a.ue,
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

    def update_active_course(self, active_id: str, *, title: str, ue: str) -> dict[str, Any]:
        """The course's own facts: what to call it and its Sorbonne UE. The parent CRN is
        a fact of each section, and lives on the register's CRN rows."""
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("UPDATE active_courses SET title = :title, ue = :ue WHERE id = :id"),
                {"id": active_id, "title": _text(title), "ue": _text(ue)},
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

    def registration_check(self, cohort_id: str, database: StudentDatabase) -> list[Mismatch]:
        """Where the portal's registrations differ from the groups we placed a cohort in.

        Judged per course of our blocks, per student the registrations pull has returned:
        placed and not registered is *missing*; registered in another section is *wrong*;
        registered in ours and another is *extra*; registered while in no group of ours is
        *unplaced*. A CRN outside our blocks — a language course, say — is not our business
        and is not mentioned. A student no pull has returned is not judged at all.
        """
        found: list[Mismatch] = []
        for term_id, term_code in self.term_links().items():
            cohort = next(
                (entry for entry in database.term_publication(term_id) if entry["cohortId"] == cohort_id), None
            )
            if cohort is None:
                continue
            groups = {group["id"]: group for group in cohort["groups"]}
            course_codes = sorted({code for group in groups.values() for code in group["crns"]})
            expected: dict[str, dict[str, str]] = {}
            for row in cohort["assignments"]:
                group = groups.get(row["groupId"])
                if group is None:
                    continue
                for code, crn in group["crns"].items():
                    if crn:
                        expected.setdefault(row["studentId"], {})[code] = crn
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
                        expected.get(student, {}).get(code, ""),
                        registered.get(student, {}).get(code, []),
                    )
                    for code in course_codes
                )
        return [mismatch for mismatch in found if mismatch is not None]


def _judge(  # noqa: PLR0913 - one argument per part of the verdict
    student: str, term_id: str, term_code: str, code: str, expected: str, registered: list[str]
) -> Mismatch | None:
    held = sorted(set(registered))
    if expected and not held:
        kind = "missing"
    elif expected and expected not in held:
        kind = "wrong"
    elif expected and len(held) > 1:
        kind = "extra"
    elif not expected and held:
        kind = "unplaced"
    else:
        return None
    return Mismatch(student, term_id, term_code, code, kind, expected, held)


def _kind(kind: str) -> None:
    if kind not in KINDS:
        raise UnknownKind(kind)


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
_SECTION_TITLE = re.compile(r"(\bG\.?\s*[0-9A-Z]+\b|[-–]\s*(CM|TD|TP)\b|\b(CM|TD|TP)\s*$)", re.IGNORECASE)


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
