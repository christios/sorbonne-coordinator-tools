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


class TeacherNotFound(Exception):
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

    def link_teacher(self, teacher_id: str, part_time_teacher_id: str) -> dict[str, Any]:
        """Say which record in the part-time teacher database this teacher is. Empty unlinks."""
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("UPDATE portal_teachers SET part_time_teacher_id = :p WHERE teacher_id = :t"),
                {"p": _text(part_time_teacher_id), "t": teacher_id},
            ).rowcount
            if updated == 0:
                raise TeacherNotFound(teacher_id)
            row = (
                connection.execute(text("SELECT * FROM portal_teachers WHERE teacher_id = :t"), {"t": teacher_id})
                .mappings()
                .first()
            )
        return _teacher(row)

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
        "partTimeTeacherId": row["part_time_teacher_id"],
        "status": row["status"],
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
    }
