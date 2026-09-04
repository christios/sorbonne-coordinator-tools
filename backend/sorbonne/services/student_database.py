"""The student record, the cohorts it can belong to, and the CRNs a cohort assigns.

The shape comes from the group-assignment workbooks. A cohort owns *scopes* — blocks of
components taught in parallel groups — and each scope is a matrix: its courses across the
top, its groups down the side, a CRN in every cell. A student in the cohort holds one
group per scope, so their CRNs are read off the matrix rather than stored against them.

A student is a row of their own, kept between syncs: the portal either returns them or it
does not, and that is their status. A cohort is one column on that row.

The only thing recorded about a student is their id. Names stay in the coordinator's
browser, where the registrar extension puts them.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError


class CohortNotFound(Exception):
    pass


class ScopeNotFound(Exception):
    pass


class GroupNotFound(Exception):
    pass


class DuplicateLabel(Exception):
    """Two groups in one scope, or two scopes in one cohort, cannot share a name."""


class FilterNotFound(Exception):
    """Also raised for a view, which is what a saved filter became."""


class DuplicateFilterName(Exception):
    """Saved searches are shared, so their names are how people refer to them."""


@dataclass(frozen=True)
class SavedSearch:
    """One named registrar search: portal codes, and what it returned last time."""

    name: str
    description: str = ""
    criteria: dict[str, list[str]] = field(default_factory=dict)
    expected_count: int = 0


class InvalidFilter(Exception):
    """A saved search must be portal codes and nothing else."""



def _now() -> str:
    return datetime.now(UTC).isoformat()


# Blocks first, then what hangs off them, then the people placed in it.
_WORKBOOK_ORDER = {"setLayout": 0, "addCourse": 1, "addGroup": 2, "setCell": 3, "place": 4}


def _ids_of(scopes, cohort_id: str) -> set[str]:
    return {row["id"] for row in scopes if row["cohort_id"] == cohort_id}


def _text(value: object) -> str:
    return " ".join(str(value or "").split())


_PLACE = """INSERT INTO group_assignments
                (cohort_id, student_id, scope_id, group_id, updated_at, updated_by)
            VALUES (:cohort, :student, :scope, :group, :updated_at, :actor)
            ON CONFLICT (cohort_id, student_id, scope_id)
            DO UPDATE SET group_id = excluded.group_id,
                          updated_at = excluded.updated_at,
                          updated_by = excluded.updated_by"""


class StudentDatabase:
    def __init__(self, database_url: str) -> None:
        # No ping on every checkout: from the deployment to its database a round-trip is
        # about a hundred milliseconds, and the ping was one more on every request.
        # Connections are recycled instead, so one that has gone stale while idle is
        # replaced before it is next used rather than tested each time.
        self.engine: Engine = create_engine(database_url, pool_pre_ping=False, pool_recycle=300)

    # --------------------------------------------------------------- cohorts

    def list_cohorts(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT c.*,
                                (SELECT count(*) FROM students m WHERE m.cohort_id = c.id) AS member_count,
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
                                (SELECT count(*) FROM students m WHERE m.cohort_id = c.id) AS member_count,
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

    def create_cohort(
        self, *, name: str, term: str = "", notes: str = "", program: str = "", year_level: str = ""
    ) -> dict[str, Any]:
        cohort_id, now = str(uuid4()), _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO student_cohorts
                            (id, name, term, notes, program, year_level, created_at, updated_at)
                        VALUES (:id, :name, :term, :notes, :program, :year_level, :now, :now)"""),
                {
                    "id": cohort_id,
                    "name": _text(name),
                    "term": _text(term),
                    "notes": notes.strip(),
                    "program": _text(program),
                    "year_level": _text(year_level),
                    "now": now,
                },
            )
        return self.get_cohort(cohort_id)

    def update_cohort(  # noqa: PLR0913 — one argument per column, the way the form sends them
        self,
        cohort_id: str,
        *,
        name: str,
        term: str,
        notes: str,
        program: str = "",
        year_level: str = "",
    ) -> dict[str, Any]:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("""UPDATE student_cohorts SET name = :name, term = :term, notes = :notes,
                            program = :program, year_level = :year_level,
                            updated_at = :now WHERE id = :id"""),
                {
                    "id": cohort_id,
                    "name": _text(name),
                    "term": _text(term),
                    "notes": notes.strip(),
                    "program": _text(program),
                    "year_level": _text(year_level),
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

    # -------------------------------------------------------- saved searches

    def list_filters(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT * FROM student_views ORDER BY name")).mappings().all()
        return [_filter(row) for row in rows]

    def save_filter(
        self, search: SavedSearch, *, filter_id: str | None = None, actor: str = ""
    ) -> dict[str, Any]:
        """Create one view. The name is how coordinators refer to it.

        A view with no filter is every student the term holds, which is a population like
        any other — the default view is exactly that — so an empty filter is allowed here
        even though an empty *search* never was.
        """
        checked = _check_criteria(search.criteria, allow_empty=True)
        now = _now()
        identifier = filter_id or str(uuid4())
        try:
            self._write_filter(identifier, search, checked, now, filter_id, actor)
        except IntegrityError as exc:
            raise DuplicateFilterName(search.name) from exc
        return self.get_filter(identifier)

    def _write_filter(self, identifier, search, checked, now, filter_id, actor) -> None:  # noqa: PLR0913
        with self.engine.begin() as connection:
            if filter_id:
                updated = connection.execute(
                    text("""UPDATE student_views SET name = :name, description = :description,
                                filter = :filter, expected_count = :expected_count,
                                updated_at = :now, updated_by = :actor
                            WHERE id = :id"""),
                    {
                        "id": filter_id,
                        "name": _text(search.name),
                        "description": _text(search.description),
                        "filter": json.dumps(checked),
                        "expected_count": max(0, search.expected_count),
                        "now": now,
                        "actor": actor,
                    },
                )
                if updated.rowcount == 0:
                    raise FilterNotFound(filter_id)
            else:
                connection.execute(
                    text("""INSERT INTO student_views
                                (id, name, description, filter, expected_count, created_at, updated_at, updated_by)
                            VALUES (:id, :name, :description, :filter, :expected_count, :now, :now, :actor)"""),
                    {
                        "id": identifier,
                        "name": _text(search.name),
                        "description": _text(search.description),
                        "filter": json.dumps(checked),
                        "expected_count": max(0, search.expected_count),
                        "now": now,
                        "actor": actor,
                    },
                )

    def get_filter(self, filter_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM student_views WHERE id = :id"), {"id": filter_id})
                .mappings()
                .first()
            )
        if row is None:
            raise FilterNotFound(filter_id)
        return _filter(row)

    def delete_filter(self, filter_id: str) -> None:
        with self.engine.begin() as connection:
            deleted = connection.execute(
                text("DELETE FROM student_views WHERE id = :id"), {"id": filter_id}
            )
        if deleted.rowcount == 0:
            raise FilterNotFound(filter_id)

    # ----------------------------------------------------------------- views

    def list_views(self) -> list[dict[str, Any]]:
        """Every view, with how many students it holds and how many it has lost."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT v.*,
                                (SELECT count(*) FROM view_members m
                                  WHERE m.view_id = v.id AND m.status = 'in_portal') AS held,
                                (SELECT count(*) FROM view_members m
                                  WHERE m.view_id = v.id AND m.status <> 'in_portal') AS gone
                            FROM student_views v ORDER BY v.name""")
                )
                .mappings()
                .all()
            )
        return [_view(row) for row in rows]

    def sync_view(self, view_id: str, student_ids: list[str]) -> dict[str, Any]:
        """Reconcile one view with what its own filter just returned.

        The filter cannot have changed since the view was made, so an id this view held and
        the portal did not return really has left *this* population — which is the whole
        reason a view's filter is fixed.
        """
        self.get_filter(view_id)
        found = _clean_ids(student_ids)
        now = _now()
        with self.engine.begin() as connection:
            held = set(
                connection.execute(
                    text("SELECT student_id FROM view_members WHERE view_id = :view"),
                    {"view": view_id},
                )
                .scalars()
                .all()
            )
            if found:
                # The student record is global: one row per id, however many views hold them.
                connection.execute(
                    text("""INSERT INTO students
                                (student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)
                            VALUES (:student_id, 'in_portal', NULL, :now, :now, :now)
                            ON CONFLICT (student_id) DO UPDATE
                                SET status = 'in_portal', last_seen_at = :now, updated_at = :now"""),
                    [{"student_id": student, "now": now} for student in found],
                )
                connection.execute(
                    text("""INSERT INTO view_members
                                (view_id, student_id, status, first_seen_at, last_seen_at)
                            VALUES (:view, :student_id, 'in_portal', :now, :now)
                            ON CONFLICT (view_id, student_id) DO UPDATE
                                SET status = 'in_portal', last_seen_at = :now"""),
                    [{"view": view_id, "student_id": student, "now": now} for student in found],
                )
            gone = [student for student in held if student not in set(found)]
            missing = 0
            if gone:
                missing = connection.execute(
                    text("""UPDATE view_members SET status = 'not_in_portal'
                            WHERE view_id = :view AND student_id = ANY(:ids)
                              AND status <> 'not_in_portal'"""),
                    {"view": view_id, "ids": gone},
                ).rowcount
                # Globally they are gone only when no view still returns them.
                connection.execute(
                    text("""UPDATE students SET status = 'not_in_portal', updated_at = :now
                            WHERE student_id = ANY(:ids)
                              AND NOT EXISTS (
                                SELECT 1 FROM view_members m
                                 WHERE m.student_id = students.student_id AND m.status = 'in_portal')"""),
                    {"ids": gone, "now": now},
                )
            connection.execute(
                text("UPDATE student_views SET last_synced_at = :now WHERE id = :view"),
                {"now": now, "view": view_id},
            )
        return {
            "seen": len(found),
            "added": len([student for student in found if student not in held]),
            "missing": missing,
            "syncedAt": now,
        }

    # -------------------------------------------------------------- students

    def list_students(self, view_id: str = "") -> list[dict[str, Any]]:
        """The students of one view, or every student we hold when no view is named.

        A view's own status wins: whether *this* population still returns them is what the
        page is about, and it is not always what another view would say.
        """
        # The groups come with the row, aggregated in the query, rather than in a second
        # query joined up here. Labelled, not as ids: "TD 1" is what a coordinator
        # recognises. One round-trip instead of two: from the deployment to its database
        # each is about a hundred milliseconds, and this list is read on every visit.
        # Aggregated once for everybody and joined, not once per student: a per-row
        # subquery ran three thousand times and cost more than the round-trip it saved.
        groups = """LEFT JOIN (
                        SELECT a.student_id,
                               json_agg(json_build_object(
                                   'termId', sc.term_id, 'scopeCode', sc.code, 'groupLabel', g.label)
                                   ORDER BY sc.code, g.label) AS groups
                        FROM group_assignments a
                        JOIN scope_groups g ON g.id = a.group_id
                        JOIN cohort_scopes sc ON sc.id = a.scope_id
                        GROUP BY a.student_id
                    ) grp ON grp.student_id = s.student_id"""
        query = f"""SELECT s.*, c.name AS cohort_name, grp.groups
                    FROM students s
                    LEFT JOIN student_cohorts c ON c.id = s.cohort_id
                    {groups}
                    ORDER BY s.student_id"""  # noqa: S608 — the fragment is ours, not input
        parameters: dict[str, Any] = {}
        if view_id:
            query = f"""SELECT s.student_id, s.cohort_id, s.cohort_since, s.first_seen_at AS held_since,
                               c.name AS cohort_name,
                               m.status, m.first_seen_at, m.last_seen_at, grp.groups
                        FROM view_members m
                        JOIN students s ON s.student_id = m.student_id
                        LEFT JOIN student_cohorts c ON c.id = s.cohort_id
                        {groups}
                        WHERE m.view_id = :view
                        ORDER BY s.student_id"""  # noqa: S608
            parameters = {"view": view_id}
        with self.engine.connect() as connection:
            rows = connection.execute(text(query), parameters).mappings().all()
        return [_student(row, row["groups"] or []) for row in rows]

    def set_cohort(self, student_ids: list[str], cohort_id: str | None) -> int:
        """Put students in a cohort, or take them out of one when `cohort_id` is None.

        Leaving a cohort drops any group the student held in it: those groups belong to
        that cohort's blocks, so keeping the assignment would place them in a matrix they
        are no longer part of.
        """
        wanted = _clean_ids(student_ids)
        if not wanted:
            return 0
        if cohort_id is not None:
            self.get_cohort(cohort_id)
        now = _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""DELETE FROM group_assignments WHERE student_id = ANY(:ids)
                        AND cohort_id <> COALESCE(:cohort_id, '')"""),
                {"ids": wanted, "cohort_id": cohort_id},
            )
            # The moment of placement is the baseline "what changed since we put them
            # here" is measured from, so it moves only when the cohort does: re-saving a
            # student into the cohort they are already in is not a placement.
            moved = connection.execute(
                text("""UPDATE students
                        SET cohort_since = CASE
                                WHEN cohort_id IS DISTINCT FROM :cohort_id THEN :now
                                ELSE cohort_since END,
                            cohort_id = :cohort_id,
                            updated_at = :now
                        WHERE student_id = ANY(:ids)"""),
                {"ids": wanted, "cohort_id": cohort_id, "now": now},
            ).rowcount
            if cohort_id is not None:
                self._touch(connection, cohort_id)
        return moved

    def list_members(self, cohort_id: str) -> list[dict[str, Any]]:
        """One cohort's students — the same records, narrowed to that cohort."""
        self.get_cohort(cohort_id)
        return [student for student in self.list_students() if student["cohortId"] == cohort_id]

    # ---------------------------------------------------------- discrepancies

    def list_discrepancy_rules(self) -> list[dict[str, Any]]:
        """What counts as a discrepancy, in the order the coordinators put them."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(text("SELECT * FROM discrepancy_rules ORDER BY position, created_at"))
                .mappings()
                .all()
            )
        return [_rule(row) for row in rows]

    def replace_discrepancy_rules(self, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The whole set at once.

        Rules are edited as a list on one page, and a list is what comes back: replacing
        it whole is simpler to reason about than reconciling additions, removals and
        reorderings one by one, and there are never more than a dozen.
        """
        cleaned = [_clean_rule(rule, position) for position, rule in enumerate(rules)]
        now = _now()
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM discrepancy_rules"))
            for rule in cleaned:
                connection.execute(
                    text("""INSERT INTO discrepancy_rules
                                (id, field, kind, "values", position, created_at, updated_at)
                            VALUES (:id, :field, :kind, :values, :position, :now, :now)"""),
                    {**rule, "values": json.dumps(rule["values"]), "now": now},
                )
        return self.list_discrepancy_rules()

    # ------------------------------------------------------------- catalogue

    def read_catalogue(self, cohort_id: str, term_id: str | None = None) -> dict[str, Any]:
        """One cohort's scopes as a matrix, with how many students sit in each group.

        Scoped to a semester when one is given, because a cohort's groups reshuffle between
        them and showing both at once would offer two "TD" that mean different things.
        """
        self.get_cohort(cohort_id)
        clause = "" if term_id is None else " AND term_id = :term_id"
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text(f"SELECT * FROM cohort_scopes WHERE cohort_id = :id{clause} ORDER BY position, code"),  # noqa: S608
                    {"id": cohort_id, "term_id": term_id} if term_id is not None else {"id": cohort_id},
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
                    "termId": scope["term_id"],
                    # Where this block sits in the workbook, so writing one back out puts
                    # it where it was: Readiness is a column on the tutorials tab.
                    "tab": scope["tab"],
                    "groupColumn": scope["group_column"],
                    "columnIndex": scope["group_column_index"],
                    "courses": [_course(row) for row in courses if row["scope_id"] == scope["id"]],
                    "groups": [
                        {
                            "id": group["id"],
                            "label": group["label"],
                            "capacity": group["capacity"],
                            "note": group["note"],
                            "program": group["program"],
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

    def assign(self, *, student_id: str, scope_id: str, group_id: str | None, actor: str = "") -> None:
        """Put one student in one group of one scope, or take them out of it.

        A student holds at most one group per scope — that is what makes their enrolment a
        union rather than a choice — so this replaces rather than adds. `group_id=None`
        removes the assignment, which is different from assigning them to nothing: it says
        the coordinator has not decided yet, and readiness will keep saying so.
        """
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            if group_id is None:
                connection.execute(
                    text("""DELETE FROM group_assignments
                            WHERE student_id = :student AND scope_id = :scope"""),
                    {"student": student_id, "scope": scope_id},
                )
            else:
                owner = connection.execute(
                    text("SELECT scope_id FROM scope_groups WHERE id = :id"), {"id": group_id}
                ).scalar()
                if owner != scope_id:
                    raise GroupNotFound(group_id)
                connection.execute(
                    text("""INSERT INTO group_assignments
                                (cohort_id, student_id, scope_id, group_id, updated_at, updated_by)
                            VALUES (:cohort, :student, :scope, :group, :updated_at, :actor)
                            ON CONFLICT (cohort_id, student_id, scope_id)
                            DO UPDATE SET group_id = excluded.group_id,
                                          updated_at = excluded.updated_at,
                                          updated_by = excluded.updated_by"""),
                    {
                        "cohort": cohort_id,
                        "student": student_id,
                        "scope": scope_id,
                        "group": group_id,
                        "updated_at": _now(),
                        "actor": _text(actor),
                    },
                )
            self._touch(connection, cohort_id)

    def assign_many(
        self, *, scope_id: str, student_ids: list[str], group_id: str | None, actor: str = ""
    ) -> dict[str, Any]:
        """Place several students in one group of one block, in a single pass.

        A student the block's cohort does not hold is skipped and named, not placed. The
        cohort is the roster, and a block belongs to one: placing an outsider would write a
        row claiming they are in a cohort they are not in, which nothing downstream would
        question. Same rule the workbook upload follows, for the same reason.
        """
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            if group_id is not None:
                owner = connection.execute(
                    text("SELECT scope_id FROM scope_groups WHERE id = :id"), {"id": group_id}
                ).scalar()
                if owner != scope_id:
                    raise GroupNotFound(group_id)

            held = {
                row[0]
                for row in connection.execute(
                    text("SELECT student_id FROM students WHERE cohort_id = :cohort"),
                    {"cohort": cohort_id},
                )
            }
            wanted = [student for student in dict.fromkeys(student_ids) if student in held]
            skipped = sorted({student for student in student_ids if student not in held})

            if wanted and group_id is None:
                connection.execute(
                    text("""DELETE FROM group_assignments
                            WHERE scope_id = :scope AND student_id = ANY(:students)"""),
                    {"scope": scope_id, "students": wanted},
                )
            elif wanted:
                now = _now()
                connection.execute(
                    text(_PLACE),
                    [
                        {
                            "cohort": cohort_id,
                            "student": student,
                            "scope": scope_id,
                            "group": group_id,
                            "updated_at": now,
                            "actor": _text(actor),
                        }
                        for student in wanted
                    ],
                )
            self._touch(connection, cohort_id)

        return {"assigned": len(wanted), "skipped": skipped}

    def place_many(
        self, *, scope_id: str, placements: dict[str, list[str]], actor: str = ""
    ) -> dict[str, Any]:
        """A whole fill at once: `group id -> students`, written in one transaction.

        A fill that half-lands is worse than one that does not land, because the page would
        show a block that is neither what it was nor what was previewed. Same rules as
        placing in one group: a student the cohort does not hold is skipped and named, and
        a group of another block is refused outright. A student named under two groups
        goes where they were named first.
        """
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            owned = {
                row[0]
                for row in connection.execute(
                    text("SELECT id FROM scope_groups WHERE scope_id = :scope"), {"scope": scope_id}
                )
            }
            for group_id in placements:
                if group_id not in owned:
                    raise GroupNotFound(group_id)

            held = {
                row[0]
                for row in connection.execute(
                    text("SELECT student_id FROM students WHERE cohort_id = :cohort"),
                    {"cohort": cohort_id},
                )
            }
            now = _now()
            rows: list[dict[str, Any]] = []
            seen: set[str] = set()
            skipped: set[str] = set()
            for group_id, students in placements.items():
                for student in students:
                    if student in seen:
                        continue
                    seen.add(student)
                    if student not in held:
                        skipped.add(student)
                        continue
                    rows.append(
                        {
                            "cohort": cohort_id,
                            "student": student,
                            "scope": scope_id,
                            "group": group_id,
                            "updated_at": now,
                            "actor": _text(actor),
                        }
                    )
            if rows:
                connection.execute(text(_PLACE), rows)
            self._touch(connection, cohort_id)

        return {"assigned": len(rows), "skipped": sorted(skipped)}

    def catalogue_for_diff(self, cohort_id: str, term_id: str) -> dict[str, Any]:
        """One semester's blocks in the shape `workbook_diff` compares against."""
        held: dict[str, Any] = {}
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text("SELECT * FROM cohort_scopes WHERE cohort_id = :id AND term_id = :term"),
                    {"id": cohort_id, "term": term_id},
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

        code_of = {row["id"]: row["code"] for row in courses}
        crns: dict[str, dict[str, str]] = {}
        for cell in cells:
            course_code = code_of.get(cell["course_id"])
            if course_code:
                crns.setdefault(cell["group_id"], {})[course_code] = cell["crn"]

        for scope in scopes:
            held[scope["code"].upper()] = {
                "id": scope["id"],
                "name": scope["name"],
                "tab": scope["tab"],
                "groupColumn": scope["group_column"],
                "columnIndex": scope["group_column_index"],
                "courses": {row["code"]: row["name"] for row in courses if row["scope_id"] == scope["id"]},
                "groups": {
                    group["label"]: {
                        "id": group["id"],
                        "label": group["label"],
                        "capacity": group["capacity"],
                        "note": group["note"],
                        "crns": crns.get(group["id"], {}),
                    }
                    for group in groups
                    if group["scope_id"] == scope["id"]
                },
            }
        return held

    def group_ids_by_label(self, cohort_id: str, term_id: str) -> dict[str, dict[str, str]]:
        """`{scope code: {group label upper: group id}}`, for naming what a sheet cannot match."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT s.code AS scope_code, g.label, g.id FROM scope_groups g
                            JOIN cohort_scopes s ON s.id = g.scope_id
                            WHERE s.cohort_id = :id AND s.term_id = :term"""),
                    {"id": cohort_id, "term": term_id},
                )
                .mappings()
                .all()
            )
        found: dict[str, dict[str, str]] = {}
        for row in rows:
            found.setdefault(row["scope_code"].upper(), {})[row["label"].upper()] = row["id"]
        return found

    def apply_workbook_changes(
        self, cohort_id: str, term_id: str, operations: list[dict[str, Any]], *, actor: str = ""
    ) -> dict[str, int]:
        """Carry out only the rows a coordinator ticked, in one transaction.

        Blocks are created on demand, because a row that adds a group to a block the
        catalogue has never held is meaningless without it — but only when that row is
        actually approved, so an unticked block is never quietly conjured up.
        """
        applied = {"layout": 0, "courses": 0, "groups": 0, "cells": 0, "placements": 0}
        now = _now()

        with self.engine.begin() as connection:
            for operation in sorted(operations, key=lambda item: _WORKBOOK_ORDER.get(item.get("op", ""), 9)):
                kind = operation.get("op")
                if kind == "place":
                    connection.execute(
                        text("""INSERT INTO group_assignments
                                    (cohort_id, student_id, scope_id, group_id, updated_at, updated_by)
                                VALUES (:cohort, :student, :scope, :group, :at, :actor)
                                ON CONFLICT (cohort_id, student_id, scope_id)
                                DO UPDATE SET group_id = excluded.group_id,
                                              updated_at = excluded.updated_at,
                                              updated_by = excluded.updated_by"""),
                        {
                            "cohort": cohort_id,
                            "student": operation["studentId"],
                            "scope": self._scope_of_group(connection, operation["groupId"]),
                            "group": operation["groupId"],
                            "at": now,
                            "actor": _text(actor),
                        },
                    )
                    applied["placements"] += 1
                    continue

                scope_id = self._ensure_scope(
                    connection,
                    cohort_id,
                    term_id,
                    operation["scopeCode"],
                    operation.get("scopeName", ""),
                    tab=operation.get("scopeTab", ""),
                    group_column=operation.get("scopeGroupColumn", ""),
                    column_index=operation.get("scopeColumnIndex", 0),
                )
                if kind == "setLayout":
                    self._set_layout(connection, scope_id, operation)
                    applied["layout"] += 1
                elif kind == "addCourse":
                    self._ensure_course(connection, scope_id, operation)
                    applied["courses"] += 1
                elif kind == "addGroup":
                    self._add_group_with_crns(connection, scope_id, operation)
                    applied["groups"] += 1
                elif kind == "setCell":
                    self._set_cell_by_label(connection, scope_id, operation)
                    applied["cells"] += 1

            self._touch(connection, cohort_id)
        return applied

    def student_ids_of(self, cohort_id: str) -> set[str]:
        """Who this cohort holds. The roster is the registrar's, never a spreadsheet's."""
        with self.engine.connect() as connection:
            return {
                row[0]
                for row in connection.execute(
                    text("SELECT student_id FROM students WHERE cohort_id = :id"), {"id": cohort_id}
                )
            }

    def assignments_of(self, cohort_id: str) -> dict[str, dict[str, str]]:
        """`student id -> {scope id: group id}` for one cohort, for the screens."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT student_id, scope_id, group_id FROM group_assignments
                            WHERE cohort_id = :id"""),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
        held: dict[str, dict[str, str]] = {}
        for row in rows:
            held.setdefault(row["student_id"], {})[row["scope_id"]] = row["group_id"]
        return held

    def term_publication(self, term_id: str) -> list[dict[str, Any]]:
        """Everything a semester needs to be resolved and judged, one entry per cohort.

        Shaped for `enrolment_resolution`: the store's job is the translation, including
        turning `group_crns`' course *ids* into the course *codes* the timetable speaks.
        Only cohorts with scopes on this semester appear — a cohort nobody has set up for it
        has nothing to publish and nothing to warn about.
        """
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text("""SELECT s.*, c.name AS cohort_name FROM cohort_scopes s
                            JOIN student_cohorts c ON c.id = s.cohort_id
                            WHERE s.term_id = :term_id
                            ORDER BY c.name, s.position, s.code"""),
                    {"term_id": term_id},
                )
                .mappings()
                .all()
            )
            if not scopes:
                return []

            scope_ids = [row["id"] for row in scopes]
            cohort_ids = sorted({row["cohort_id"] for row in scopes})
            courses = self._rows(connection, "scope_courses", scope_ids, "position, code")
            groups = self._rows(connection, "scope_groups", scope_ids, "position, label")
            cells = (
                connection.execute(
                    text("""SELECT gc.* FROM group_crns gc
                            JOIN scope_groups g ON g.id = gc.group_id
                            WHERE g.scope_id = ANY(:ids)"""),
                    {"ids": scope_ids},
                )
                .mappings()
                .all()
            )
            members = (
                connection.execute(
                    text("SELECT student_id, cohort_id FROM students WHERE cohort_id = ANY(:ids)"),
                    {"ids": cohort_ids},
                )
                .mappings()
                .all()
            )
            assigned = (
                connection.execute(
                    text("""SELECT student_id, scope_id, group_id FROM group_assignments
                            WHERE scope_id = ANY(:ids)"""),
                    {"ids": scope_ids},
                )
                .mappings()
                .all()
            )

        code_of = {row["id"]: row["code"] for row in courses}
        crns: dict[str, dict[str, str]] = {}
        for cell in cells:
            course_code = code_of.get(cell["course_id"])
            if course_code:
                crns.setdefault(cell["group_id"], {})[course_code] = cell["crn"]

        return [
            {
                "cohortId": cohort_id,
                "cohortName": next(row["cohort_name"] for row in scopes if row["cohort_id"] == cohort_id),
                "students": sorted(row["student_id"] for row in members if row["cohort_id"] == cohort_id),
                "scopes": [
                    {"id": row["id"], "code": row["code"], "name": row["name"]}
                    for row in scopes
                    if row["cohort_id"] == cohort_id
                ],
                "groups": [
                    {
                        "id": group["id"],
                        "scopeId": group["scope_id"],
                        "label": group["label"],
                        "crns": crns.get(group["id"], {}),
                    }
                    for group in groups
                    if group["scope_id"] in _ids_of(scopes, cohort_id)
                ],
                "courseCodes": {
                    scope_id: [row["code"] for row in courses if row["scope_id"] == scope_id]
                    for scope_id in _ids_of(scopes, cohort_id)
                },
                "assignments": [
                    {"studentId": row["student_id"], "scopeId": row["scope_id"], "groupId": row["group_id"]}
                    for row in assigned
                    if row["scope_id"] in _ids_of(scopes, cohort_id)
                ],
            }
            for cohort_id in cohort_ids
        ]

    # ------------------------------------------------------- editing a scope

    def add_scope(self, cohort_id: str, *, code: str, name: str = "", note: str = "", term_id: str = "") -> str:
        self.get_cohort(cohort_id)
        scope_id = str(uuid4())
        with self.engine.begin() as connection:
            if self._scope_id(connection, cohort_id, _text(code), _text(term_id)):
                raise DuplicateLabel(code)
            connection.execute(
                text("""INSERT INTO cohort_scopes (id, cohort_id, code, name, note, term_id, position)
                        VALUES (:id, :cohort_id, :code, :name, :note, :term_id,
                                (SELECT coalesce(max(position), 0) + 1 FROM cohort_scopes
                                 WHERE cohort_id = :cohort_id))"""),
                {
                    "id": scope_id,
                    "cohort_id": cohort_id,
                    "code": _text(code),
                    "name": _text(name),
                    "note": _text(note),
                    "term_id": _text(term_id),
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

    def add_group(
        self, scope_id: str, *, label: str, capacity: int = 0, note: str = "", program: str = ""
    ) -> str:
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
                text("""INSERT INTO scope_groups (id, scope_id, label, capacity, note, program, position)
                        VALUES (:id, :scope_id, :label, :capacity, :note, :program,
                                (SELECT coalesce(max(position), 0) + 1 FROM scope_groups
                                 WHERE scope_id = :scope_id))"""),
                {
                    "id": group_id,
                    "scope_id": scope_id,
                    "label": _text(label),
                    "capacity": max(0, capacity),
                    "note": _text(note),
                    "program": _text(program),
                },
            )
            self._touch(connection, cohort_id)
        return group_id

    def update_group(self, group_id: str, *, label: str, capacity: int, note: str, program: str = "") -> None:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("""UPDATE scope_groups SET label = :label, capacity = :capacity, note = :note,
                                                program = :program
                        WHERE id = :id"""),
                {
                    "id": group_id,
                    "label": _text(label),
                    "capacity": max(0, capacity),
                    "note": _text(note),
                    "program": _text(program),
                },
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

    # --------------------------------------------------------------- helpers

    def _set_layout(self, connection: Connection, scope_id: str, operation: dict[str, Any]) -> None:
        """Where this block's column sits in the workbook: which tab, and what it is called."""
        connection.execute(
            text("""UPDATE cohort_scopes
                    SET tab = :tab, group_column = :column, group_column_index = :position
                    WHERE id = :id"""),
            {
                "id": scope_id,
                "tab": _text(operation.get("tab", "")),
                "column": _text(operation.get("groupColumn", "")),
                "position": int(operation.get("columnIndex", 0) or 0),
            },
        )

    def _ensure_scope(  # noqa: PLR0913 - one argument per column of the block being made
        self,
        connection: Connection,
        cohort_id: str,
        term_id: str,
        code: str,
        name: str,
        tab: str = "",
        group_column: str = "",
        column_index: int = 0,
    ) -> str:
        existing = self._scope_id(connection, cohort_id, _text(code), _text(term_id))
        if existing:
            return existing
        scope_id = str(uuid4())
        connection.execute(
            text("""INSERT INTO cohort_scopes
                        (id, cohort_id, code, name, note, term_id, tab, group_column,
                         group_column_index, position)
                    VALUES (:id, :cohort_id, :code, :name, '', :term_id, :tab, :group_column,
                            :group_column_index,
                            (SELECT coalesce(max(position), 0) + 1 FROM cohort_scopes
                             WHERE cohort_id = :cohort_id))"""),
            {
                "id": scope_id,
                "cohort_id": cohort_id,
                "tab": _text(tab),
                "group_column": _text(group_column),
                "group_column_index": int(column_index or 0),
                "code": _text(code),
                "name": _text(name),
                "term_id": _text(term_id),
            },
        )
        return scope_id

    def _ensure_course(self, connection: Connection, scope_id: str, operation: dict[str, Any]) -> str:
        code = _text(operation["courseCode"])
        row = connection.execute(
            text("SELECT id FROM scope_courses WHERE scope_id = :scope AND code = :code"),
            {"scope": scope_id, "code": code},
        ).first()
        if row:
            return row[0]
        course_id = str(uuid4())
        connection.execute(
            text("""INSERT INTO scope_courses (id, scope_id, code, name, component, position)
                    VALUES (:id, :scope, :code, :name, :component,
                            (SELECT coalesce(max(position), 0) + 1 FROM scope_courses
                             WHERE scope_id = :scope))"""),
            {
                "id": course_id,
                "scope": scope_id,
                "code": code,
                "name": _text(operation.get("courseName", "")),
                "component": _text(operation.get("component", "")),
            },
        )
        return course_id

    def _add_group_with_crns(self, connection: Connection, scope_id: str, operation: dict[str, Any]) -> None:
        label = _text(operation["groupLabel"])
        row = connection.execute(
            text("SELECT id FROM scope_groups WHERE scope_id = :scope AND label = :label"),
            {"scope": scope_id, "label": label},
        ).first()
        group_id = row[0] if row else str(uuid4())
        if not row:
            connection.execute(
                text("""INSERT INTO scope_groups (id, scope_id, label, capacity, note, position)
                        VALUES (:id, :scope, :label, :capacity, :note,
                                (SELECT coalesce(max(position), 0) + 1 FROM scope_groups
                                 WHERE scope_id = :scope))"""),
                {
                    "id": group_id,
                    "scope": scope_id,
                    "label": label,
                    "capacity": int(operation.get("capacity", 0) or 0),
                    "note": _text(operation.get("note", "")),
                },
            )
        teachers = operation.get("teachers", {}) or {}
        for course_code, crn in (operation.get("crns", {}) or {}).items():
            course_id = self._ensure_course(connection, scope_id, {"courseCode": course_code})
            self._write_cell(connection, group_id, course_id, crn, teachers.get(course_code, ""))

    def _set_cell_by_label(self, connection: Connection, scope_id: str, operation: dict[str, Any]) -> None:
        group_id = connection.execute(
            text("SELECT id FROM scope_groups WHERE scope_id = :scope AND label = :label"),
            {"scope": scope_id, "label": _text(operation["groupLabel"])},
        ).scalar()
        if group_id is None:
            raise GroupNotFound(operation["groupLabel"])
        course_id = self._ensure_course(connection, scope_id, operation)
        self._write_cell(connection, group_id, course_id, operation.get("crn", ""), operation.get("teacher", ""))

    def _write_cell(
        self, connection: Connection, group_id: str, course_id: str, crn: str, teacher: str
    ) -> None:
        connection.execute(
            text("""INSERT INTO group_crns (group_id, course_id, crn, teacher)
                    VALUES (:group, :course, :crn, :teacher)
                    ON CONFLICT (group_id, course_id)
                    DO UPDATE SET crn = excluded.crn, teacher = excluded.teacher"""),
            {"group": group_id, "course": course_id, "crn": _text(crn), "teacher": _text(teacher)},
        )

    def _scope_of_group(self, connection: Connection, group_id: str) -> str:
        scope_id = connection.execute(
            text("SELECT scope_id FROM scope_groups WHERE id = :id"), {"id": group_id}
        ).scalar()
        if scope_id is None:
            raise GroupNotFound(group_id)
        return scope_id

    def _scope_id(
        self, connection: Connection, cohort_id: str, code: str, term_id: str = ""
    ) -> str | None:
        row = connection.execute(
            text("""SELECT id FROM cohort_scopes
                    WHERE cohort_id = :cohort_id AND code = :code AND term_id = :term_id"""),
            {"cohort_id": cohort_id, "code": code, "term_id": term_id},
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


FIELD_KEY = re.compile(r"^[A-Z][A-Z0-9_]{1,39}$")
VALUE = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
MAX_FIELDS = 12
MAX_VALUES = 40


# Fields that identify a person rather than describe a population. Filtering by one turns
# the portal into an oracle — ask for a passport number and the answer names its holder —
# so they are refused however the request arrives. The extension keeps the same list.
NEVER_FILTERABLE = frozenset(
    {
        "PASSPORT_ID",
        "DOB_CHAR",
        "BIRTH_DATE",
        "MOBILE_NO",
        "PHONE_NO",
        "PERS_EMAIL",
        "BALANCE",
        "NATIONAL_ID",
        "PASSPORT_NUMBER",
    }
)


def _check_criteria(criteria: dict[str, list[str]], *, allow_empty: bool = False) -> dict[str, list[str]]:
    """Portal codes only.

    The extension checks this again before it asks the portal anything — this copy is so
    that nothing shaped like a student, a name or an injection is ever stored.

    `allow_empty` is for the sync population, where filtering by nothing means everyone.
    A saved search filtering by nothing would just be a slower way of saying the same, so
    it still has to narrow something.
    """
    if not isinstance(criteria, dict):
        raise InvalidFilter("That is not a set of filters.")
    if not criteria and not allow_empty:
        raise InvalidFilter("A saved search needs at least one filter.")
    if len(criteria) > MAX_FIELDS:
        raise InvalidFilter("That is more filters than the portal accepts.")

    checked: dict[str, list[str]] = {}
    for key, values in criteria.items():
        if not FIELD_KEY.match(str(key)):
            raise InvalidFilter(f"{key} is not a portal field name.")
        if str(key).upper() in NEVER_FILTERABLE:
            raise InvalidFilter(f"{key} identifies a person and cannot be filtered on.")
        if not isinstance(values, list) or not values:
            raise InvalidFilter(f"{key} has no values.")
        if len(values) > MAX_VALUES:
            raise InvalidFilter(f"{key} has more values than the portal accepts.")
        for value in values:
            if not isinstance(value, str) or not VALUE.match(value):
                raise InvalidFilter(f"{value!r} is not a portal code.")
        checked[str(key)] = list(dict.fromkeys(values))
    return checked


def _filter(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "filter": row["filter"],
        "expectedCount": row["expected_count"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "updatedBy": row["updated_by"],
    }


def _clean_ids(student_ids: list[str]) -> list[str]:
    """Ids as the registrar writes them, without duplicates or stray spacing."""
    seen: dict[str, None] = {}
    for value in student_ids:
        cleaned = _text(value).upper()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


def _view(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "filter": row["filter"] or {},
        "held": row["held"],
        "gone": row["gone"],
        "lastSyncedAt": row["last_synced_at"],
        "createdAt": row["created_at"],
        "updatedBy": row["updated_by"],
    }


def _student(row, groups: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "studentId": row["student_id"],
        "status": row["status"],
        "cohortId": row["cohort_id"],
        "cohortName": row["cohort_name"] or "",
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
        # Empty for a placement made before this was recorded: no baseline, and the
        # Cohorts page says so rather than treating every change as since then.
        "cohortSince": row["cohort_since"] or "",
        "groups": groups,
    }


RULE_KINDS = ("changed", "changed_to", "is", "is_not", "differs")
# What "differs from the cohort" can compare against: the two things a cohort carries.
DIFFERS_FIELDS = ("MAJOR_CODE_DESC", "YEARLEVEL_CODE")
FIELD_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class InvalidRule(ValueError):
    """A rule that cannot mean anything, and why."""


def _clean_rule(rule: dict[str, Any], position: int) -> dict[str, Any]:
    field = _text(rule.get("field")).upper()
    kind = _text(rule.get("kind"))
    raw_values = rule.get("values") or []
    if not FIELD_NAME.match(field):
        raise InvalidRule(f"'{rule.get('field')}' is not a portal field name.")
    if kind not in RULE_KINDS:
        raise InvalidRule(f"'{kind}' is not a kind of rule.")
    if kind == "differs" and field not in DIFFERS_FIELDS:
        raise InvalidRule(f"A cohort has no {field} to differ from; only a program or a year level.")
    if not isinstance(raw_values, list):
        raise InvalidRule("A rule's values must be a list.")
    values = [_text(value) for value in raw_values if _text(value)]
    if kind in ("changed_to", "is", "is_not") and not values:
        raise InvalidRule(f"A '{kind}' rule needs at least one value.")
    if kind in ("changed", "differs"):
        values = []
    return {
        "id": _text(rule.get("id")) or str(uuid4()),
        "field": field,
        "kind": kind,
        "values": values,
        "position": position,
    }


def _rule(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "field": row["field"],
        "kind": row["kind"],
        "values": json.loads(row["values"] or "[]"),
    }


def _cohort(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "term": row["term"],
        "notes": row["notes"],
        "program": row["program"] or "",
        "yearLevel": row["year_level"] or "",
        "memberCount": row["member_count"],
        "scopeCount": row["scope_count"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _course(row) -> dict[str, Any]:
    return {"id": row["id"], "code": row["code"], "name": row["name"], "component": row["component"]}
