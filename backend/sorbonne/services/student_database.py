"""Cohorts, and the catalogue of groups and CRNs they assign students into.

The shape comes from the group-assignment workbooks. A cohort owns *scopes* — blocks of
components taught in parallel groups — and each scope is a matrix: its courses across the
top, its groups down the side, a CRN in every cell. A student in the cohort holds one
group per scope, so their CRNs are read off the matrix rather than stored against them.

The only thing recorded about a student is their id. Names stay in the coordinator's
browser, where the registrar extension puts them.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, Engine, create_engine, text

from sorbonne.services.group_reference_import import ReferenceImport


class CohortNotFound(Exception):
    pass


class ScopeNotFound(Exception):
    pass


class GroupNotFound(Exception):
    pass


class DuplicateLabel(Exception):
    """Two groups in one scope, or two scopes in one cohort, cannot share a name."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _text(value: object) -> str:
    return " ".join(str(value or "").split())


class StudentDatabase:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    # --------------------------------------------------------------- cohorts

    def list_cohorts(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT c.*,
                                (SELECT count(*) FROM cohort_members m WHERE m.cohort_id = c.id) AS member_count,
                                (SELECT count(*) FROM cohort_scopes s WHERE s.cohort_id = c.id) AS scope_count
                            FROM student_cohorts c ORDER BY c.name""")
                )
                .mappings()
                .all()
            )
        return [_cohort(row) for row in rows]

    def get_cohort(self, cohort_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("""SELECT c.*,
                                (SELECT count(*) FROM cohort_members m WHERE m.cohort_id = c.id) AS member_count,
                                (SELECT count(*) FROM cohort_scopes s WHERE s.cohort_id = c.id) AS scope_count
                            FROM student_cohorts c WHERE c.id = :id"""),
                    {"id": cohort_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise CohortNotFound(cohort_id)
        return _cohort(row)

    def create_cohort(self, *, name: str, term: str = "", notes: str = "") -> dict[str, Any]:
        cohort_id, now = str(uuid4()), _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO student_cohorts (id, name, term, notes, created_at, updated_at)
                        VALUES (:id, :name, :term, :notes, :now, :now)"""),
                {"id": cohort_id, "name": _text(name), "term": _text(term), "notes": notes.strip(), "now": now},
            )
        return self.get_cohort(cohort_id)

    def update_cohort(self, cohort_id: str, *, name: str, term: str, notes: str) -> dict[str, Any]:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("""UPDATE student_cohorts SET name = :name, term = :term, notes = :notes,
                            updated_at = :now WHERE id = :id"""),
                {
                    "id": cohort_id,
                    "name": _text(name),
                    "term": _text(term),
                    "notes": notes.strip(),
                    "now": _now(),
                },
            )
        if updated.rowcount == 0:
            raise CohortNotFound(cohort_id)
        return self.get_cohort(cohort_id)

    def delete_cohort(self, cohort_id: str) -> None:
        with self.engine.begin() as connection:
            deleted = connection.execute(
                text("DELETE FROM student_cohorts WHERE id = :id"), {"id": cohort_id}
            )
        if deleted.rowcount == 0:
            raise CohortNotFound(cohort_id)

    # --------------------------------------------------------------- members

    def list_members(self, cohort_id: str) -> list[dict[str, Any]]:
        """The cohort's students, as ids and the group they hold in each block."""
        self.get_cohort(cohort_id)
        with self.engine.connect() as connection:
            members = (
                connection.execute(
                    text("""SELECT student_id, added_at, added_by FROM cohort_members
                            WHERE cohort_id = :id ORDER BY student_id"""),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
            assignments = (
                connection.execute(
                    text("SELECT student_id, scope_id, group_id FROM group_assignments WHERE cohort_id = :id"),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
        held: dict[str, dict[str, str]] = {}
        for row in assignments:
            held.setdefault(row["student_id"], {})[row["scope_id"]] = row["group_id"]
        return [
            {
                "studentId": row["student_id"],
                "addedAt": row["added_at"],
                "addedBy": row["added_by"],
                "groups": held.get(row["student_id"], {}),
            }
            for row in members
        ]

    def add_members(self, cohort_id: str, student_ids: list[str], *, actor: str = "") -> int:
        """Add ids to a cohort. Already-members are left alone, so re-adding is harmless."""
        self.get_cohort(cohort_id)
        wanted = _clean_ids(student_ids)
        if not wanted:
            return 0
        now = _now()
        with self.engine.begin() as connection:
            before = connection.execute(
                text("SELECT count(*) FROM cohort_members WHERE cohort_id = :id"), {"id": cohort_id}
            ).scalar_one()
            connection.execute(
                text("""INSERT INTO cohort_members (cohort_id, student_id, added_at, added_by)
                        VALUES (:cohort_id, :student_id, :added_at, :added_by)
                        ON CONFLICT (cohort_id, student_id) DO NOTHING"""),
                [
                    {"cohort_id": cohort_id, "student_id": student, "added_at": now, "added_by": actor}
                    for student in wanted
                ],
            )
            after = connection.execute(
                text("SELECT count(*) FROM cohort_members WHERE cohort_id = :id"), {"id": cohort_id}
            ).scalar_one()
            self._touch(connection, cohort_id)
        return after - before

    def remove_members(self, cohort_id: str, student_ids: list[str]) -> int:
        """Remove ids from a cohort, and with them any group they were holding."""
        wanted = _clean_ids(student_ids)
        if not wanted:
            return 0
        with self.engine.begin() as connection:
            removed = connection.execute(
                text("DELETE FROM cohort_members WHERE cohort_id = :id AND student_id = ANY(:ids)"),
                {"id": cohort_id, "ids": wanted},
            )
            connection.execute(
                text("DELETE FROM group_assignments WHERE cohort_id = :id AND student_id = ANY(:ids)"),
                {"id": cohort_id, "ids": wanted},
            )
            self._touch(connection, cohort_id)
        return removed.rowcount

    # ------------------------------------------------------------- catalogue

    def read_catalogue(self, cohort_id: str) -> dict[str, Any]:
        """Every scope of one cohort as a matrix, with how many students sit in each group."""
        self.get_cohort(cohort_id)
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text("SELECT * FROM cohort_scopes WHERE cohort_id = :id ORDER BY position, code"),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
            scope_ids = [row["id"] for row in scopes]
            courses = self._rows(connection, "scope_courses", scope_ids, "position, code")
            groups = self._rows(connection, "scope_groups", scope_ids, "position, label")
            cells = (
                connection.execute(
                    text("""SELECT gc.* FROM group_crns gc
                            JOIN scope_groups g ON g.id = gc.group_id
                            WHERE g.scope_id = ANY(:ids)"""),
                    {"ids": scope_ids or [""]},
                )
                .mappings()
                .all()
            )
            counts = dict(
                connection.execute(
                    text("""SELECT group_id, count(*) FROM group_assignments
                            WHERE cohort_id = :id GROUP BY group_id"""),
                    {"id": cohort_id},
                ).all()
            )

        crns: dict[str, dict[str, dict[str, str]]] = {}
        for cell in cells:
            crns.setdefault(cell["group_id"], {})[cell["course_id"]] = {
                "crn": cell["crn"],
                "teacher": cell["teacher"],
            }

        return {
            "scopes": [
                {
                    "id": scope["id"],
                    "code": scope["code"],
                    "name": scope["name"],
                    "note": scope["note"],
                    "courses": [_course(row) for row in courses if row["scope_id"] == scope["id"]],
                    "groups": [
                        {
                            "id": group["id"],
                            "label": group["label"],
                            "capacity": group["capacity"],
                            "note": group["note"],
                            "assigned": counts.get(group["id"], 0),
                            "crns": crns.get(group["id"], {}),
                        }
                        for group in groups
                        if group["scope_id"] == scope["id"]
                    ],
                }
                for scope in scopes
            ]
        }

    def _rows(self, connection: Connection, table: str, scope_ids: list[str], order: str):
        return (
            connection.execute(
                text(f"SELECT * FROM {table} WHERE scope_id = ANY(:ids) ORDER BY {order}"),  # noqa: S608
                {"ids": scope_ids or [""]},
            )
            .mappings()
            .all()
        )

    # ------------------------------------------------------- editing a scope

    def add_scope(self, cohort_id: str, *, code: str, name: str = "", note: str = "") -> str:
        self.get_cohort(cohort_id)
        scope_id = str(uuid4())
        with self.engine.begin() as connection:
            if self._scope_id(connection, cohort_id, _text(code)):
                raise DuplicateLabel(code)
            connection.execute(
                text("""INSERT INTO cohort_scopes (id, cohort_id, code, name, note, position)
                        VALUES (:id, :cohort_id, :code, :name, :note,
                                (SELECT coalesce(max(position), 0) + 1 FROM cohort_scopes
                                 WHERE cohort_id = :cohort_id))"""),
                {
                    "id": scope_id,
                    "cohort_id": cohort_id,
                    "code": _text(code),
                    "name": _text(name),
                    "note": _text(note),
                },
            )
            self._touch(connection, cohort_id)
        return scope_id

    def update_scope(self, scope_id: str, *, code: str, name: str, note: str) -> None:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("UPDATE cohort_scopes SET code = :code, name = :name, note = :note WHERE id = :id"),
                {"id": scope_id, "code": _text(code), "name": _text(name), "note": _text(note)},
            )
            if updated.rowcount == 0:
                raise ScopeNotFound(scope_id)
            self._touch_by_scope(connection, scope_id)

    def delete_scope(self, scope_id: str) -> None:
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            connection.execute(text("DELETE FROM cohort_scopes WHERE id = :id"), {"id": scope_id})
            self._touch(connection, cohort_id)

    def add_course(self, scope_id: str, *, code: str, name: str = "", component: str = "") -> str:
        course_id = str(uuid4())
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            connection.execute(
                text("""INSERT INTO scope_courses (id, scope_id, code, name, component, position)
                        VALUES (:id, :scope_id, :code, :name, :component,
                                (SELECT coalesce(max(position), 0) + 1 FROM scope_courses
                                 WHERE scope_id = :scope_id))
                        ON CONFLICT (scope_id, code) DO NOTHING"""),
                {
                    "id": course_id,
                    "scope_id": scope_id,
                    "code": _text(code),
                    "name": _text(name),
                    "component": _text(component),
                },
            )
            self._touch(connection, cohort_id)
        return course_id

    def delete_course(self, course_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM scope_courses WHERE id = :id"), {"id": course_id})

    def add_group(self, scope_id: str, *, label: str, capacity: int = 0, note: str = "") -> str:
        group_id = str(uuid4())
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            existing = connection.execute(
                text("SELECT id FROM scope_groups WHERE scope_id = :scope_id AND label = :label"),
                {"scope_id": scope_id, "label": _text(label)},
            ).first()
            if existing:
                raise DuplicateLabel(label)
            connection.execute(
                text("""INSERT INTO scope_groups (id, scope_id, label, capacity, note, position)
                        VALUES (:id, :scope_id, :label, :capacity, :note,
                                (SELECT coalesce(max(position), 0) + 1 FROM scope_groups
                                 WHERE scope_id = :scope_id))"""),
                {
                    "id": group_id,
                    "scope_id": scope_id,
                    "label": _text(label),
                    "capacity": max(0, capacity),
                    "note": _text(note),
                },
            )
            self._touch(connection, cohort_id)
        return group_id

    def update_group(self, group_id: str, *, label: str, capacity: int, note: str) -> None:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("UPDATE scope_groups SET label = :label, capacity = :capacity, note = :note WHERE id = :id"),
                {"id": group_id, "label": _text(label), "capacity": max(0, capacity), "note": _text(note)},
            )
            if updated.rowcount == 0:
                raise GroupNotFound(group_id)

    def delete_group(self, group_id: str) -> None:
        """Removing a group also unassigns whoever was in it — they need placing again."""
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM scope_groups WHERE id = :id"), {"id": group_id})

    def set_cell(self, *, group_id: str, course_id: str, crn: str, teacher: str = "") -> None:
        """One cell of the matrix: which CRN this group holds for this course."""
        value = _text(crn)
        with self.engine.begin() as connection:
            if not value:
                connection.execute(
                    text("DELETE FROM group_crns WHERE group_id = :group_id AND course_id = :course_id"),
                    {"group_id": group_id, "course_id": course_id},
                )
                return
            connection.execute(
                text("""INSERT INTO group_crns (group_id, course_id, crn, teacher)
                        VALUES (:group_id, :course_id, :crn, :teacher)
                        ON CONFLICT (group_id, course_id) DO UPDATE
                        SET crn = :crn, teacher = :teacher"""),
                {"group_id": group_id, "course_id": course_id, "crn": value, "teacher": _text(teacher)},
            )

    # ---------------------------------------------------------------- import

    def import_reference(self, cohort_id: str, report: ReferenceImport) -> dict[str, int]:
        """Merge a workbook's Reference sheet into a cohort, leaving assignments alone.

        Re-importing is safe and is the point: a corrected workbook updates the CRNs in
        place, and any group a coordinator added by hand in the meantime survives.
        """
        self.get_cohort(cohort_id)
        added = {"scopes": 0, "courses": 0, "groups": 0, "crns": 0}

        with self.engine.begin() as connection:
            for position, imported in enumerate(report.scopes, start=1):
                scope_id = self._scope_id(connection, cohort_id, imported.code)
                if scope_id is None:
                    scope_id = str(uuid4())
                    connection.execute(
                        text("""INSERT INTO cohort_scopes (id, cohort_id, code, name, note, position)
                                VALUES (:id, :cohort_id, :code, :name, '', :position)"""),
                        {
                            "id": scope_id,
                            "cohort_id": cohort_id,
                            "code": imported.code,
                            "name": imported.name,
                            "position": position,
                        },
                    )
                    added["scopes"] += 1

                courses: dict[str, str] = {}
                for index, course in enumerate(imported.courses, start=1):
                    course_id = self._upsert_course(connection, scope_id, course, index)
                    courses[course.code] = course_id[0]
                    added["courses"] += course_id[1]

                for index, group in enumerate(imported.groups, start=1):
                    group_id, created = self._upsert_group(connection, scope_id, group, index)
                    added["groups"] += created
                    for course_code, (crn, teacher) in group.crns.items():
                        course_id = courses.get(course_code)
                        if course_id is None:
                            continue
                        connection.execute(
                            text("""INSERT INTO group_crns (group_id, course_id, crn, teacher)
                                    VALUES (:group_id, :course_id, :crn, :teacher)
                                    ON CONFLICT (group_id, course_id) DO UPDATE
                                    SET crn = :crn, teacher = :teacher"""),
                            {"group_id": group_id, "course_id": course_id, "crn": crn, "teacher": teacher},
                        )
                        added["crns"] += 1
            self._touch(connection, cohort_id)
        return added

    def _upsert_course(self, connection: Connection, scope_id: str, course, position: int) -> tuple[str, int]:
        row = connection.execute(
            text("SELECT id FROM scope_courses WHERE scope_id = :scope_id AND code = :code"),
            {"scope_id": scope_id, "code": course.code},
        ).first()
        if row:
            connection.execute(
                text("UPDATE scope_courses SET name = :name, component = :component WHERE id = :id"),
                {"id": row[0], "name": course.name, "component": course.component},
            )
            return row[0], 0
        course_id = str(uuid4())
        connection.execute(
            text("""INSERT INTO scope_courses (id, scope_id, code, name, component, position)
                    VALUES (:id, :scope_id, :code, :name, :component, :position)"""),
            {
                "id": course_id,
                "scope_id": scope_id,
                "code": course.code,
                "name": course.name,
                "component": course.component,
                "position": position,
            },
        )
        return course_id, 1

    def _upsert_group(self, connection: Connection, scope_id: str, group, position: int) -> tuple[str, int]:
        row = connection.execute(
            text("SELECT id FROM scope_groups WHERE scope_id = :scope_id AND label = :label"),
            {"scope_id": scope_id, "label": group.label},
        ).first()
        if row:
            connection.execute(
                text("UPDATE scope_groups SET capacity = :capacity, note = :note WHERE id = :id"),
                {"id": row[0], "capacity": group.capacity, "note": group.note},
            )
            return row[0], 0
        group_id = str(uuid4())
        connection.execute(
            text("""INSERT INTO scope_groups (id, scope_id, label, capacity, note, position)
                    VALUES (:id, :scope_id, :label, :capacity, :note, :position)"""),
            {
                "id": group_id,
                "scope_id": scope_id,
                "label": group.label,
                "capacity": group.capacity,
                "note": group.note,
                "position": position,
            },
        )
        return group_id, 1

    # --------------------------------------------------------------- helpers

    def _scope_id(self, connection: Connection, cohort_id: str, code: str) -> str | None:
        row = connection.execute(
            text("SELECT id FROM cohort_scopes WHERE cohort_id = :cohort_id AND code = :code"),
            {"cohort_id": cohort_id, "code": code},
        ).first()
        return row[0] if row else None

    def _cohort_of_scope(self, connection: Connection, scope_id: str) -> str:
        row = connection.execute(
            text("SELECT cohort_id FROM cohort_scopes WHERE id = :id"), {"id": scope_id}
        ).first()
        if row is None:
            raise ScopeNotFound(scope_id)
        return row[0]

    def _touch(self, connection: Connection, cohort_id: str) -> None:
        connection.execute(
            text("UPDATE student_cohorts SET updated_at = :now WHERE id = :id"),
            {"id": cohort_id, "now": _now()},
        )

    def _touch_by_scope(self, connection: Connection, scope_id: str) -> None:
        self._touch(connection, self._cohort_of_scope(connection, scope_id))


def _clean_ids(student_ids: list[str]) -> list[str]:
    """Ids as the registrar writes them, without duplicates or stray spacing."""
    seen: dict[str, None] = {}
    for value in student_ids:
        cleaned = _text(value).upper()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


def _cohort(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "term": row["term"],
        "notes": row["notes"],
        "memberCount": row["member_count"],
        "scopeCount": row["scope_count"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _course(row) -> dict[str, Any]:
    return {"id": row["id"], "code": row["code"], "name": row["name"], "component": row["component"]}
