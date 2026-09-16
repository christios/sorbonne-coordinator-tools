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

from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import IntegrityError

from sorbonne.services.engine import engine_for


# A set is plain — its groups numbered across whatever courses it carries, one or many —
# or nested inside another set. "Independent" was a third word for a plain set with one
# course; nothing behaved differently, so it is read as plain.
SCOPE_KINDS = ("shared", "nested")

#: The most parts one section may be taught in. Two is the case that exists — a course
#: handed over at mid-semester — and the cap is here so a typo cannot make a hundred.
MAX_PARTS = 9


def _part_number(part: Any) -> int:
    """Parts are numbered from 1. Anything else is a caller's mistake, not a new part."""
    number = int(part or 1)
    if number < 1 or number > MAX_PARTS:
        raise ValueError(f"A part is numbered 1 to {MAX_PARTS}, not {number}.")
    return number


SECTION_FIELDS = (
    "teacher_id",
    "hours",
    "sessions_per_week",
    "duration",
    "weeks",
    "room_pref",
    "day_pref",
    "time_pref",
    "constraints",
    "comments",
)


class CohortNotFound(Exception):
    pass


class ScopeNotFound(Exception):
    pass


class GroupNotFound(Exception):
    pass


class CommentNotFound(Exception):
    pass


class NotTheAuthor(Exception):
    """Only the one who wrote a line of a thread may take it back."""


class CourseNotFound(Exception):
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


def _comment(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "studentId": row["student_id"],
        "body": row["body"],
        "authorEmail": row["author_email"],
        "authorName": row["author_name"],
        "createdAt": row["created_at"],
    }


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ids(raw: Any) -> list[str]:
    """A JSON list of ids as stored, or nothing for anything that is not one."""
    try:
        held = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in held if str(item).strip()] if isinstance(held, list) else []


def _group_ids(ids: list[str] | None) -> list[str]:
    """Group ids as given, once each, blanks dropped. Not `_clean_ids`: those are student ids and are upper-cased."""
    seen: list[str] = []
    for item in ids or []:
        text_id = _text(item)
        if text_id and text_id not in seen:
            seen.append(text_id)
    return seen


# Blocks first, then what hangs off them, then the people placed in it.
_WORKBOOK_ORDER = {"setLayout": 0, "addCourse": 1, "addGroup": 2, "setCell": 3, "place": 4}


def _ids_of(scopes, cohort_id: str) -> set[str]:
    return {row["id"] for row in scopes if row["cohort_id"] == cohort_id}


def _text(value: object) -> str:
    return " ".join(str(value or "").split())


def _codes(values: list[str] | None) -> list[str]:
    """Portal codes as a tidy list: trimmed, non-empty, each once, in the order given."""
    seen: dict[str, None] = {}
    for value in values or []:
        cleaned = _text(value)
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


def _course_codes(values: list[str] | None) -> list[str]:
    """Course codes and subject prefixes as the portal writes them: upper-case, each once."""
    return _codes([_text(value).upper() for value in values or []])


def allows(allowed: list[str], course_code: str) -> bool:
    """Whether a cohort's allowed list covers this course.

    An entry is a whole code ("SPRT-101") or a subject ("SPRT", which covers every SPRT
    course). Written once here so the register and the pages read the list the same way.
    """
    code = _text(course_code).upper()
    if not code:
        return False
    subject = code.split("-", 1)[0]
    return any(entry in (code, subject) for entry in allowed)


_PLACE = """INSERT INTO group_assignments
                (cohort_id, student_id, scope_id, group_id, major_id, updated_at, updated_by)
            VALUES (:cohort, :student, :scope, :group, :major, :updated_at, :actor)
            ON CONFLICT (cohort_id, student_id, scope_id)
            DO UPDATE SET group_id = excluded.group_id,
                          major_id = excluded.major_id,
                          updated_at = excluded.updated_at,
                          updated_by = excluded.updated_by"""


class StudentDatabase:
    def __init__(self, database_url: str) -> None:
        # The process's pool, not an engine of this store's own: a store is built afresh
        # on every request, and an engine built with it opened a new connection across the
        # network each time. See sorbonne/services/engine.py.
        self.engine: Engine = engine_for(database_url)

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

    def create_cohort(  # noqa: PLR0913 — one argument per column, the way the form sends them
        self,
        *,
        name: str,
        term: str = "",
        notes: str = "",
        majors: list[str] | None = None,
        terms: list[str] | None = None,
        year_level: str = "",
        allowed_codes: list[str] | None = None,
    ) -> dict[str, Any]:
        cohort_id, now = str(uuid4()), _now()
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO student_cohorts
                            (id, name, term, notes, major_codes, term_codes, year_level, allowed_codes,
                             created_at, updated_at)
                        VALUES (:id, :name, :term, :notes, :majors, :terms, :year_level, :allowed, :now, :now)"""),
                {
                    "id": cohort_id,
                    "name": _text(name),
                    "term": _text(term),
                    "notes": notes.strip(),
                    "majors": json.dumps(_codes(majors)),
                    "terms": json.dumps(_codes(terms)),
                    "year_level": _text(year_level),
                    "allowed": json.dumps(_course_codes(allowed_codes)),
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
        majors: list[str] | None = None,
        terms: list[str] | None = None,
        year_level: str = "",
        workbook_tab: str = "",
        first_semester: int = 0,
        allowed_codes: list[str] | None = None,
    ) -> dict[str, Any]:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("""UPDATE student_cohorts SET name = :name, term = :term, notes = :notes,
                            major_codes = :majors, term_codes = :terms, year_level = :year_level,
                            workbook_tab = :workbook_tab, first_semester = :first_semester,
                            allowed_codes = :allowed, updated_at = :now WHERE id = :id"""),
                {
                    "id": cohort_id,
                    "name": _text(name),
                    "term": _text(term),
                    "notes": notes.strip(),
                    "majors": json.dumps(_codes(majors)),
                    "terms": json.dumps(_codes(terms)),
                    "year_level": _text(year_level),
                    "workbook_tab": _text(workbook_tab),
                    "first_semester": max(0, int(first_semester or 0)),
                    "allowed": json.dumps(_course_codes(allowed_codes)),
                    "now": _now(),
                },
            )
        if updated.rowcount == 0:
            raise CohortNotFound(cohort_id)
        return self.get_cohort(cohort_id)

    def delete_cohort(self, cohort_id: str) -> None:
        with self.engine.begin() as connection:
            # Its own rules go with it; the shared ones are everybody's.
            connection.execute(text("DELETE FROM discrepancy_rules WHERE cohort_id = :id"), {"id": cohort_id})
            deleted = connection.execute(text("DELETE FROM student_cohorts WHERE id = :id"), {"id": cohort_id})
        if deleted.rowcount == 0:
            raise CohortNotFound(cohort_id)

    # -------------------------------------------------------- saved searches

    def list_filters(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT * FROM student_views ORDER BY name")).mappings().all()
        return [_filter(row) for row in rows]

    def save_filter(self, search: SavedSearch, *, filter_id: str | None = None, actor: str = "") -> dict[str, Any]:
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
            deleted = connection.execute(text("DELETE FROM student_views WHERE id = :id"), {"id": filter_id})
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
                                   'termId', sc.term_id, 'scopeCode', sc.code, 'groupLabel', g.label,
                                   -- The sub-row they took, where the group has them: "CM 1 · Maths".
                                   -- With how many the group has, so a label names the sub-row only
                                   -- where there is another to tell it from.
                                   'major', coalesce(m.program, ''),
                                   'subRows', (SELECT count(*) FROM group_majors gm WHERE gm.group_id = g.id),
                                   -- Additive, and the only server change the Meets column
                                   -- needs: the label alone cannot be joined to the CRNs the
                                   -- group holds, and "TD 1" means different groups in
                                   -- different sets and different semesters.
                                   'groupId', g.id,
                                   -- Whether the set is open to every cohort, so a move can
                                   -- count what it would KEEP as well as what it would drop.
                                   'openToAll', sc.open_to_all)
                                   ORDER BY sc.code, g.label) AS groups
                        FROM group_assignments a
                        JOIN scope_groups g ON g.id = a.group_id
                        JOIN cohort_scopes sc ON sc.id = a.scope_id
                        LEFT JOIN group_majors m ON m.id = a.major_id
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

    def set_cohort(
        self, student_ids: list[str], cohort_id: str | None, keep_shared: bool = False, *, actor: str = ""
    ) -> int:
        """Put students in a cohort, or take them out of one when `cohort_id` is None.

        Leaving a cohort drops any group the student held in it: those groups belong to
        that cohort's blocks, so keeping the assignment would place them in a matrix they
        are no longer part of.

        `keep_shared` excepts the sets open to EVERY cohort — the languages. Those are not
        the leaving cohort's matrix; they are the university's, and a student moving from
        L1 to L2 does not thereby stop being in French A1. Dropping them was silent and
        cost a placement nobody knew to redo.

        Only `open_to_all` scopes may be kept. A group of a cohort-owned scope cannot be:
        `_placeable` would refuse to admit the mover to that scope at all, so the row would
        assert a membership the rest of the system denies.

        The UPDATE below can collide in principle — `cohort_id` is in the primary key — but
        not in practice, and the reason is worth writing down because it was nearly guarded
        against instead: `assign` files a row under the STUDENT's own cohort rather than the
        scope's owner, so a student never holds two rows for one scope and there is nothing
        for the update to land on. `test_a_placement_is_filed_under_the_students_own_cohort`
        is what keeps that true; if it ever goes red, this needs a delete-the-stale-row pass
        before the update.
        """
        wanted = _clean_ids(student_ids)
        if not wanted:
            return 0
        if cohort_id is not None:
            self.get_cohort(cohort_id)
        now = _now()
        with self.engine.begin() as connection:
            # The languages are the university's sets, not the leaving cohort's, so they
            # are the one thing a move may keep.
            spare_shared = " AND NOT s.open_to_all" if keep_shared else ""
            # For the history: where each of them was, and which groups the move costs.
            names = {row[0]: row[1] for row in connection.execute(text("SELECT id, name FROM student_cohorts"))}
            before = {
                row[0]: row[1] or ""
                for row in connection.execute(
                    text("SELECT student_id, cohort_id FROM students WHERE student_id = ANY(:ids)"), {"ids": wanted}
                )
            }
            lost = connection.execute(
                text(
                    "SELECT a.student_id, s.code, g.label FROM group_assignments a "
                    "JOIN cohort_scopes s ON s.id = a.scope_id JOIN scope_groups g ON g.id = a.group_id "
                    "WHERE a.student_id = ANY(:ids) AND a.cohort_id <> COALESCE(:cohort_id, '')" + spare_shared  # noqa: S608
                ),
                {"ids": wanted, "cohort_id": cohort_id},
            ).all()
            connection.execute(
                text(
                    "DELETE FROM group_assignments a USING cohort_scopes s "
                    "WHERE s.id = a.scope_id AND a.student_id = ANY(:ids) "
                    "AND a.cohort_id <> COALESCE(:cohort_id, '')" + spare_shared  # noqa: S608
                ),
                {"ids": wanted, "cohort_id": cohort_id},
            )
            if keep_shared and cohort_id is not None:
                # An UPDATE and not a bare keep: `cohort_id` is IN the primary key and
                # `assignments_of` reads by it, so a row left filed under the old cohort is
                # invisible to every screen of the new one — kept in the table and lost on
                # the page, which is worse than deleting it.
                connection.execute(
                    text("""UPDATE group_assignments a
                            SET cohort_id = :cohort_id, updated_at = :now
                            FROM cohort_scopes s
                            WHERE s.id = a.scope_id AND s.open_to_all
                              AND a.student_id = ANY(:ids) AND a.cohort_id <> :cohort_id"""),
                    {"ids": wanted, "cohort_id": cohort_id, "now": now},
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
            lines: list[dict[str, Any]] = [
                {"studentId": student, "kind": "removed", "detail": {"scopeCode": code, "from": label, "to": ""}}
                for student, code, label in lost
            ]
            lines.extend(
                {
                    "studentId": student,
                    "kind": "cohort",
                    "detail": {"from": names.get(before[student], ""), "to": names.get(cohort_id or "", "")},
                }
                for student in wanted
                if student in before and before[student] != (cohort_id or "")
            )
            self._record(connection, lines, actor=actor)
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
                                (id, field, kind, "values", cohort_id, position, created_at, updated_at)
                            VALUES (:id, :field, :kind, :values, :cohort_id, :position, :now, :now)"""),
                    {**rule, "values": json.dumps(rule["values"]), "now": now},
                )
        return self.list_discrepancy_rules()

    # ------------------------------------------------------------- catalogue

    def read_catalogue(
        self, cohort_id: str, term_id: str | None = None, own_only: bool = False
    ) -> dict[str, Any]:
        """The sets this cohort's students are taught in, with how many sit in each group.

        Scoped to a semester when one is given, because a cohort's groups reshuffle between
        them and showing both at once would offer two "TD" that mean different things.

        **The sets open to every cohort are included by default, and `own_only` leaves them
        out.** It used to be the other way round, and the default was the wrong one: the
        languages are one class for the whole department, the row saying so has to live
        under some cohort, and every reader that forgot to ask for them quietly reported a
        cohort as though its students took no language at all. That mistake was made three
        times — the exemptions filed under the owning cohort, the register not expecting a
        language section, and the readiness never asking who had no language group, which
        left seventeen students unflagged on the real data.

        So the safe reading is what you get for not thinking about it, and a caller that
        genuinely means "this cohort's own rows" has to say so. Two do, and both are about
        a cohort's own paperwork rather than its students: the course cards, which would
        otherwise show the languages under all four cohorts, and the timetable workbook,
        which would put them on every sheet.

        Each scope still says whose it is, so a page can keep the two apart.
        """
        self.get_cohort(cohort_id)
        clause = "" if term_id is None else " AND term_id = :term_id"
        own = f"cohort_id = :id{clause}"
        where = own if own_only else f"({own}) OR (open_to_all{clause})"
        params: dict[str, Any] = {"id": cohort_id}
        if term_id is not None:
            params["term_id"] = term_id
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text(f"SELECT * FROM cohort_scopes WHERE {where} ORDER BY position, code"),  # noqa: S608
                    params,
                )
                .mappings()
                .all()
            )
            scope_ids = [row["id"] for row in scopes]
            courses = self._rows(connection, "scope_courses", scope_ids, "position, code")
            groups = self._rows(connection, "scope_groups", scope_ids, "position, label")
            majors = self._majors(connection, scope_ids)
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
            # How many sit on each sub-row, for the seats beside each major.
            by_major = dict(
                connection.execute(
                    text("""SELECT a.major_id, count(*) FROM group_assignments a
                            JOIN scope_groups g ON g.id = a.group_id
                            JOIN cohort_scopes s ON s.id = g.scope_id
                            WHERE a.major_id <> '' AND (s.open_to_all OR a.cohort_id = :id)
                            GROUP BY a.major_id"""),
                    {"id": cohort_id},
                ).all()
            )
            # How many of each group's students do not take each of its courses. The
            # group's own count is unchanged by an exemption — they are still in it, and
            # still take everything else — so this is per section, which is the number a
            # room is booked against.
            exempt = dict(
                connection.execute(
                    text("""SELECT a.group_id || '|' || e.course_id, count(*)
                            FROM course_exemptions e
                            JOIN scope_courses c ON c.id = e.course_id
                            JOIN group_assignments a
                              ON a.scope_id = c.scope_id AND a.student_id = e.student_id
                            WHERE c.scope_id = ANY(:ids)
                            GROUP BY a.group_id, e.course_id"""),
                    {"ids": scope_ids or [""]},
                ).all()
            )
            # A set open to every cohort counts everyone in it, wherever they come from;
            # any other set holds only this cohort's students anyway.
            counts = dict(
                connection.execute(
                    text("""SELECT a.group_id, count(*) FROM group_assignments a
                            JOIN scope_groups g ON g.id = a.group_id
                            JOIN cohort_scopes s ON s.id = g.scope_id
                            WHERE s.open_to_all OR a.cohort_id = :id
                            GROUP BY a.group_id"""),
                    {"id": cohort_id},
                ).all()
            )

        return self._catalogue_of(scopes, courses, groups, majors, cells, by_major, exempt, counts)

    def _catalogue_of(  # noqa: PLR0913 - one argument per table the cards are built from
        self,
        scopes: list[Any],
        courses: list[Any],
        groups: list[Any],
        majors: list[Any],
        cells: list[Any],
        by_major: dict[str, int],
        exempt: dict[str, int],
        counts: dict[str, int],
    ) -> dict[str, Any]:
        """The cards, once the eight tables behind them have been read.

        Split out from the reading because `list_catalogues` reads those tables once for
        every cohort at once and then hands each cohort its own share, which is the same
        assembly over a smaller pile of rows.
        """
        shared = [cell for cell in cells if not cell["major_id"]]
        crns = _sections_of(shared)
        for group_id, sections in crns.items():
            for course_id, section in sections.items():
                section["exempt"] = int(exempt.get(f"{group_id}|{course_id}", 0))
        # The cells that belong to one sub-row: `{group: {major: {course: section}}}`. A
        # section here overrides the group's shared one for that major, or says the major
        # is not taught the course at all.
        own: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
        for major_id, sections in _sections_by_major([cell for cell in cells if cell["major_id"]]).items():
            for group_id, by_course in sections.items():
                own.setdefault(group_id, {})[major_id] = by_course
        majors_of: dict[str, list[dict[str, Any]]] = {}
        for major in majors:
            majors_of.setdefault(major["group_id"], []).append(
                {
                    "id": major["id"],
                    "program": major["program"],
                    "seats": int(major["seats"]),
                    "assigned": int(by_major.get(major["id"], 0)),
                }
            )

        return {
            "scopes": [
                {
                    "id": scope["id"],
                    "code": scope["code"],
                    "name": scope["name"],
                    "note": scope["note"],
                    "termId": scope["term_id"],
                    "kind": scope["kind"],
                    "parentScopeId": scope["parent_scope_id"],
                    # True for a set the whole department shares, as the languages are.
                    "openToAll": bool(scope["open_to_all"]),
                    # Whose row this is. A shared set is answered for every cohort, so a
                    # page can say plainly that it belongs to the department, not to the
                    # cohort being looked at.
                    "cohortId": scope["cohort_id"],
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
                            # A group with sub-rows has as many seats as they add up to.
                            "capacity": _capacity_of(group, majors_of.get(group["id"], [])),
                            "note": group["note"],
                            "parentGroupId": group["parent_group_id"],
                            # The groups this one must be scheduled at the same hour as.
                            "parallelWith": _ids(group["parallel_with"]),
                            # The majors this group holds, each with its seats and who sits
                            # on it. Empty for a group that is one thing for everybody.
                            "majors": majors_of.get(group["id"], []),
                            # `{major id: {course id: section}}` — the cells of one sub-row,
                            # over the group's shared ones in `crns`.
                            "byMajor": own.get(group["id"], {}),
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

    def list_catalogues(self) -> list[dict[str, Any]]:
        """Every cohort's blocks, every semester — the cards page reads them all at once.

        Read for all cohorts together rather than one cohort at a time. Every table here
        is asked for once and then shared out, because the round trip to the database is
        the expensive part and the rows are few: four cohorts cost thirty-seven trips when
        each was read on its own, and nine when they are read together.

        The two counts have to be asked for by cohort — a set open to the whole department
        counts everyone in it, and any other set only its own cohort's students — so they
        are grouped by cohort as well, and each cohort adds up the shares that are its own.

        Each cohort gets its OWN rows, as `read_catalogue(own_only=True)` gives: a card
        page that showed the languages under all four cohorts would be showing one set
        four times. That is exactly a partition of the scopes by the cohort that owns them,
        so reading every scope once and dealing them out loses nothing.
        """
        with self.engine.connect() as connection:
            cohorts = [
                _cohort(row)
                for row in connection.execute(
                    text("""SELECT c.*,
                                (SELECT count(*) FROM students m WHERE m.cohort_id = c.id) AS member_count,
                                (SELECT count(*) FROM cohort_scopes s WHERE s.cohort_id = c.id) AS scope_count
                            FROM student_cohorts c ORDER BY c.name""")
                )
                .mappings()
                .all()
            ]
            scopes = (
                connection.execute(text("SELECT * FROM cohort_scopes ORDER BY position, code")).mappings().all()
            )
            scope_ids = [row["id"] for row in scopes]
            courses = self._rows(connection, "scope_courses", scope_ids, "position, code")
            groups = self._rows(connection, "scope_groups", scope_ids, "position, label")
            majors = self._majors(connection, scope_ids)
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
            exempt = dict(
                connection.execute(
                    text("""SELECT a.group_id || '|' || e.course_id, count(*)
                            FROM course_exemptions e
                            JOIN scope_courses c ON c.id = e.course_id
                            JOIN group_assignments a
                              ON a.scope_id = c.scope_id AND a.student_id = e.student_id
                            GROUP BY a.group_id, e.course_id"""),
                ).all()
            )
            # Whose the assignment is, and whether the set it sits in is the department's
            # — the two things that decide which cohorts may count it.
            by_major = connection.execute(
                text("""SELECT s.open_to_all, a.cohort_id, a.major_id, count(*)
                        FROM group_assignments a
                        JOIN scope_groups g ON g.id = a.group_id
                        JOIN cohort_scopes s ON s.id = g.scope_id
                        WHERE a.major_id <> ''
                        GROUP BY s.open_to_all, a.cohort_id, a.major_id"""),
            ).all()
            counts = connection.execute(
                text("""SELECT s.open_to_all, a.cohort_id, a.group_id, count(*)
                        FROM group_assignments a
                        JOIN scope_groups g ON g.id = a.group_id
                        JOIN cohort_scopes s ON s.id = g.scope_id
                        GROUP BY s.open_to_all, a.cohort_id, a.group_id"""),
            ).all()

        def tally(rows: list[Any], cohort_id: str) -> dict[str, int]:
            """One cohort's share of a count: its own students, and everyone in a shared set."""
            totals: dict[str, int] = {}
            for open_to_all, whose, key, many in rows:
                if open_to_all or whose == cohort_id:
                    totals[key] = totals.get(key, 0) + int(many)
            return totals

        catalogues = []
        for cohort in cohorts:
            mine = [scope for scope in scopes if scope["cohort_id"] == cohort["id"]]
            ids = {scope["id"] for scope in mine}
            group_ids = {group["id"] for group in groups if group["scope_id"] in ids}
            catalogues.append(
                {
                    "cohort": {"id": cohort["id"], "name": cohort["name"], "term": cohort["term"]},
                    **self._catalogue_of(
                        mine,
                        [row for row in courses if row["scope_id"] in ids],
                        [row for row in groups if row["scope_id"] in ids],
                        [row for row in majors if row["group_id"] in group_ids],
                        [row for row in cells if row["group_id"] in group_ids],
                        tally(by_major, cohort["id"]),
                        exempt,
                        tally(counts, cohort["id"]),
                    ),
                }
            )
        return catalogues

    def _rows(self, connection: Connection, table: str, scope_ids: list[str], order: str):
        return (
            connection.execute(
                text(f"SELECT * FROM {table} WHERE scope_id = ANY(:ids) ORDER BY {order}"),  # noqa: S608
                {"ids": scope_ids or [""]},
            )
            .mappings()
            .all()
        )

    def assign(  # noqa: PLR0913 - one keyword per thing a placement says
        self, *, student_id: str, scope_id: str, group_id: str | None, major_id: str = "", actor: str = ""
    ) -> None:
        """Put one student in one group of one scope, or take them out of it.

        A student holds at most one group per scope — that is what makes their enrolment a
        union rather than a choice — so this replaces rather than adds. `group_id=None`
        removes the assignment, which is different from assigning them to nothing: it says
        the coordinator has not decided yet, and readiness will keep saying so.
        """
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            before = self._held_in_scope(connection, scope_id, [student_id])
            major = self._major_of(connection, group_id, major_id)
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
                    text(_PLACE),
                    {
                        "cohort": self._cohorts_of(connection, [student_id]).get(student_id, cohort_id),
                        "student": student_id,
                        "scope": scope_id,
                        "group": group_id,
                        "major": major,
                        "updated_at": _now(),
                        "actor": _text(actor),
                    },
                )
            self._record(
                connection,
                self._placement_lines(connection, scope_id, before, {student_id: (group_id, major)}),
                actor=actor,
            )
            self._touch(connection, cohort_id)

    def assign_many(  # noqa: PLR0913 - one keyword per thing a placement says
        self,
        *,
        scope_id: str,
        student_ids: list[str],
        group_id: str | None,
        major_id: str = "",
        majors: dict[str, str] | None = None,
        actor: str = "",
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

            # A set open to every cohort takes anybody the department holds; every other
            # set takes its own cohort's students, and says who it turned away.
            held = self._placeable(connection, scope_id, cohort_id)
            wanted = [student for student in dict.fromkeys(student_ids) if student in held]
            skipped = sorted({student for student in student_ids if student not in held})
            before = self._held_in_scope(connection, scope_id, wanted)
            after: dict[str, tuple[str | None, str]] = {}

            if wanted and group_id is None:
                connection.execute(
                    text("""DELETE FROM group_assignments
                            WHERE scope_id = :scope AND student_id = ANY(:students)"""),
                    {"scope": scope_id, "students": wanted},
                )
                after = {student: (None, "") for student in wanted}
            elif wanted:
                now = _now()
                mine = self._cohorts_of(connection, wanted)
                # The sub-row each takes: named per student, else the one for all, else none.
                after = {
                    student: (group_id, self._major_of(connection, group_id, (majors or {}).get(student, major_id)))
                    for student in wanted
                }
                connection.execute(
                    text(_PLACE),
                    [
                        {
                            "cohort": mine.get(student, cohort_id),
                            "student": student,
                            "scope": scope_id,
                            "group": group_id,
                            "major": after[student][1],
                            "updated_at": now,
                            "actor": _text(actor),
                        }
                        for student in wanted
                    ],
                )
            self._record(connection, self._placement_lines(connection, scope_id, before, after), actor=actor)
            self._touch(connection, cohort_id)

        return {"assigned": len(wanted), "skipped": skipped}

    def place_many(
        self,
        *,
        scope_id: str,
        placements: dict[str, list[str]],
        majors: dict[str, str] | None = None,
        actor: str = "",
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

            # A set open to every cohort takes anybody the department holds; every other
            # set takes its own cohort's students, and says who it turned away.
            held = self._placeable(connection, scope_id, cohort_id)
            cohort_of = self._cohorts_of(connection, sorted({s for ids in placements.values() for s in ids}))
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
                            # Whose student they are, which is not always whose set it is.
                            "cohort": cohort_of.get(student, cohort_id),
                            "student": student,
                            "scope": scope_id,
                            "group": group_id,
                            "major": self._major_of(connection, group_id, (majors or {}).get(student, "")),
                            "updated_at": now,
                            "actor": _text(actor),
                        }
                    )
            if rows:
                before = self._held_in_scope(connection, scope_id, [row["student"] for row in rows])
                connection.execute(text(_PLACE), rows)
                after = {row["student"]: (row["group"], row["major"]) for row in rows}
                self._record(connection, self._placement_lines(connection, scope_id, before, after), actor=actor)
            self._touch(connection, cohort_id)

        return {"assigned": len(rows), "skipped": sorted(skipped)}

    def _majors(self, connection: Connection, scope_ids: list[str]) -> list[Any]:
        """Every sub-row of every group of these sets, in the order they are shown."""
        return (
            connection.execute(
                text("""SELECT m.* FROM group_majors m
                        JOIN scope_groups g ON g.id = m.group_id
                        WHERE g.scope_id = ANY(:ids)
                        ORDER BY m.position, m.program"""),
                {"ids": scope_ids or [""]},
            )
            .mappings()
            .all()
        )

    def _major_of(self, connection: Connection, group_id: str | None, major_id: str) -> str:
        """The sub-row a placement names, if the group has it; else none.

        A sub-row of another group is refused silently rather than written: a placement
        pointing at a sub-row its group does not hold would be resolved as nothing.
        """
        wanted = _text(major_id)
        if not wanted or not group_id:
            return ""
        held = connection.execute(
            text("SELECT group_id FROM group_majors WHERE id = :id"), {"id": wanted}
        ).scalar()
        return wanted if held == group_id else ""

    def add_major(self, group_id: str, *, program: str, seats: int = 0) -> str:
        """One more sub-row on a group: a major it holds, and how many seats it has for it."""
        name = _text(program)
        if not name:
            raise ValueError("A sub-row names a programme.")
        major_id = str(uuid4())
        with self.engine.begin() as connection:
            scope_id = self._scope_of_group(connection, group_id)
            try:
                connection.execute(
                    text("""INSERT INTO group_majors (id, group_id, program, seats, position)
                            VALUES (:id, :group, :program, :seats,
                                    (SELECT coalesce(max(position), 0) + 1
                                     FROM group_majors WHERE group_id = :group))"""),
                    {"id": major_id, "group": group_id, "program": name, "seats": max(0, int(seats or 0))},
                )
            except IntegrityError as exc:
                raise DuplicateLabel(name) from exc
            self._touch_by_scope(connection, scope_id)
        return major_id

    def update_major(self, major_id: str, *, program: str, seats: int) -> None:
        name = _text(program)
        if not name:
            raise ValueError("A sub-row names a programme.")
        with self.engine.begin() as connection:
            group_id = connection.execute(
                text("SELECT group_id FROM group_majors WHERE id = :id"), {"id": major_id}
            ).scalar()
            if group_id is None:
                raise GroupNotFound(major_id)
            try:
                connection.execute(
                    text("UPDATE group_majors SET program = :program, seats = :seats WHERE id = :id"),
                    {"id": major_id, "program": name, "seats": max(0, int(seats or 0))},
                )
            except IntegrityError as exc:
                raise DuplicateLabel(name) from exc
            self._touch_by_scope(connection, self._scope_of_group(connection, group_id))

    def remove_major(self, major_id: str) -> None:
        """Take a sub-row off a group.

        Its own cells go with it. The students on it stay in the group, on no sub-row —
        they are still placed; they have simply stopped being told apart — and the page
        says so until somebody moves them.
        """
        with self.engine.begin() as connection:
            group_id = connection.execute(
                text("SELECT group_id FROM group_majors WHERE id = :id"), {"id": major_id}
            ).scalar()
            if group_id is None:
                raise GroupNotFound(major_id)
            connection.execute(text("DELETE FROM group_crns WHERE major_id = :id"), {"id": major_id})
            connection.execute(
                text("UPDATE group_assignments SET major_id = '' WHERE major_id = :id"), {"id": major_id}
            )
            connection.execute(text("DELETE FROM group_majors WHERE id = :id"), {"id": major_id})
            self._touch_by_scope(connection, self._scope_of_group(connection, group_id))

    def assignment_majors_of(self, cohort_id: str) -> dict[str, dict[str, str]]:
        """`student id -> {scope id: major id}`, for the placements that took a sub-row."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT student_id, scope_id, major_id FROM group_assignments
                            WHERE cohort_id = :id AND major_id <> ''"""),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
        held: dict[str, dict[str, str]] = {}
        for row in rows:
            held.setdefault(row["student_id"], {})[row["scope_id"]] = row["major_id"]
        return held

    def _cohorts_of(self, connection: Connection, student_ids: list[str]) -> dict[str, str]:
        """Whose student each of these is, so a shared set files them under themselves."""
        if not student_ids:
            return {}
        return {
            row[0]: row[1]
            for row in connection.execute(
                text("SELECT student_id, cohort_id FROM students WHERE student_id = ANY(:ids)"),
                {"ids": student_ids},
            )
            if row[1]
        }

    def _placeable(self, connection: Connection, scope_id: str, cohort_id: str) -> set[str]:
        """The students this set may hold: its cohort's, or the whole department's."""
        if self._open_to_all(connection, scope_id):
            return {row[0] for row in connection.execute(text("SELECT student_id FROM students"))}
        return {
            row[0]
            for row in connection.execute(
                text("SELECT student_id FROM students WHERE cohort_id = :cohort"), {"cohort": cohort_id}
            )
        }

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
        crns = _crns_of(list(cells), code_of)

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
                    scope_id = self._scope_of_group(connection, operation["groupId"])
                    before = self._held_in_scope(connection, scope_id, [operation["studentId"]])
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
                            "scope": scope_id,
                            "group": operation["groupId"],
                            "at": now,
                            "actor": _text(actor),
                        },
                    )
                    self._record(
                        connection,
                        self._placement_lines(
                            connection, scope_id, before, {operation["studentId"]: (operation["groupId"], "")}
                        ),
                        actor=actor,
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
            majors = self._majors(connection, scope_ids)
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
                    text("""SELECT student_id, scope_id, group_id, major_id FROM group_assignments
                            WHERE scope_id = ANY(:ids)"""),
                    {"ids": scope_ids},
                )
                .mappings()
                .all()
            )

        code_of = {row["id"]: row["code"] for row in courses}
        crns = _crns_of([cell for cell in cells if not cell["major_id"]], code_of)
        majors_of: dict[str, list[Any]] = {}
        for major in majors:
            majors_of.setdefault(major["group_id"], []).append(major)
        # Per group, what each sub-row comes to: the shared CRNs, overridden or struck
        # out by the sub-row's own cells. What a student on that sub-row is expected in.
        by_major = _crns_by_major(list(cells), code_of, majors_of)
        crn_programs = _crn_programs(list(cells), code_of, majors_of)
        struck: dict[str, set[str]] = {}
        for cell in cells:
            if cell["major_id"] and cell["not_taught"] and code_of.get(cell["course_id"]):
                struck.setdefault(cell["major_id"], set()).add(code_of[cell["course_id"]])

        def publish_group(group: Any) -> dict[str, Any]:
            return {
                "id": group["id"],
                "scopeId": group["scope_id"],
                "label": group["label"],
                "crns": crns.get(group["id"], {}),
                "majors": [
                    {
                        "id": major["id"],
                        "program": major["program"],
                        "crns": by_major.get(group["id"], {}).get(major["id"], {}),
                        # The sub-row's own word: these courses are not its, so no CRN is wanted.
                        "notTaught": sorted(struck.get(major["id"], set())),
                    }
                    for major in majors_of.get(group["id"], [])
                ],
            }

        def publish_assignment(row: Any) -> dict[str, Any]:
            return {
                "studentId": row["student_id"],
                "scopeId": row["scope_id"],
                "groupId": row["group_id"],
                "majorId": row["major_id"],
            }

        # A set open to every cohort sits on ONE cohort's row, so anything that reads a
        # semester cohort by cohort loses it for everybody else — which is how a student's
        # language hour came to be checked against the owning cohort's lectures and nobody
        # else's. These are carried separately rather than folded into `scopes`: readiness
        # and resolution must go on seeing a cohort's own sets and only those, or every
        # cohort would suddenly be required to have placed everyone in a language group.
        shared = [row for row in scopes if row["open_to_all"]]
        shared_ids = {row["id"] for row in shared}

        # Per cohort, once: the shared sets somebody ELSE's row holds, and who here is in them.
        elsewhere = {
            cohort_id: shared_ids - {row["id"] for row in scopes if row["cohort_id"] == cohort_id}
            for cohort_id in cohort_ids
        }
        mine = {
            cohort_id: {row["student_id"] for row in members if row["cohort_id"] == cohort_id}
            for cohort_id in cohort_ids
        }

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
                    publish_group(group) for group in groups if group["scope_id"] in _ids_of(scopes, cohort_id)
                ],
                "courseCodes": {
                    scope_id: [row["code"] for row in courses if row["scope_id"] == scope_id]
                    for scope_id in _ids_of(scopes, cohort_id)
                },
                # Which programme a CRN is taught to, where its cell belongs to one sub-row
                # or the other sub-rows of its group are not taught the course. Two CRNs
                # for different programmes have no student in common, whatever hour they
                # meet at — which is what the clash reading needs to know.
                "crnPrograms": {
                    crn: program
                    for crn, program in crn_programs.items()
                    if any(
                        crn in crns_of_code
                        for group in groups
                        if group["scope_id"] in _ids_of(scopes, cohort_id) or group["scope_id"] in shared_ids
                        for crns_of_code in [
                            *crns.get(group["id"], {}).values(),
                            *[
                                held
                                for by_code in by_major.get(group["id"], {}).values()
                                for held in by_code.values()
                            ],
                        ]
                    )
                },
                "assignments": [
                    publish_assignment(row) for row in assigned if row["scope_id"] in _ids_of(scopes, cohort_id)
                ],
                # The same three, for the sets somebody else's row holds: enough to check
                # this cohort's students against them, and nothing more.
                "sharedScopes": [
                    {"id": row["id"], "code": row["code"], "name": row["name"]}
                    for row in shared
                    if row["id"] in elsewhere[cohort_id]
                ],
                "sharedGroups": [
                    publish_group(group) for group in groups if group["scope_id"] in elsewhere[cohort_id]
                ],
                "sharedAssignments": [
                    publish_assignment(row)
                    for row in assigned
                    if row["scope_id"] in elsewhere[cohort_id] and row["student_id"] in mine[cohort_id]
                ],
            }
            for cohort_id in cohort_ids
        ]

    # --------------------------------------------------------------- comments
    def comments_of(self, student_id: str) -> list[dict[str, Any]]:
        """Everything said about one student, oldest first — a thread reads down."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, student_id, body, author_email, author_name, created_at
                            FROM student_comments WHERE student_id = :student
                            ORDER BY created_at, id"""),
                    {"student": _text(student_id)},
                )
                .mappings()
                .all()
            )
        return [_comment(row) for row in rows]

    def add_comment(self, *, student_id: str, body: str, author_email: str, author_name: str) -> dict[str, Any]:
        """One line on the student's thread, signed by whoever is signed in and dated now.

        The body keeps its line breaks: a comment is prose, not a field.
        """
        row = {
            "id": str(uuid4()),
            "student_id": _text(student_id),
            "body": str(body or "").strip(),
            "author_email": _text(author_email),
            "author_name": _text(author_name),
            "created_at": _now(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO student_comments (id, student_id, body, author_email, author_name, created_at)
                        VALUES (:id, :student_id, :body, :author_email, :author_name, :created_at)"""),
                row,
            )
        return _comment(row)

    def remove_comment(self, comment_id: str, *, author_email: str) -> None:
        with self.engine.begin() as connection:
            held = connection.execute(
                text("SELECT author_email FROM student_comments WHERE id = :id"), {"id": comment_id}
            ).scalar()
            if held is None:
                raise CommentNotFound(comment_id)
            if str(held).casefold() != _text(author_email).casefold():
                raise NotTheAuthor(comment_id)
            connection.execute(text("DELETE FROM student_comments WHERE id = :id"), {"id": comment_id})

    def comment_counts(self) -> dict[str, dict[str, Any]]:
        """How many lines each student carries, and when the last was written — for the rows."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT student_id, COUNT(*) AS lines, MAX(created_at) AS last_at
                            FROM student_comments GROUP BY student_id""")
                )
                .mappings()
                .all()
            )
        return {row["student_id"]: {"count": int(row["lines"]), "lastAt": row["last_at"]} for row in rows}

    # ------------------------------------------------------------- exemptions

    def set_exemption(self, *, student_id: str, course_id: str, reason: str = "") -> None:
        """This student is in the group and does not take this course of its set.

        Credit from elsewhere, a course already passed, a waiver. Recorded rather than
        dismissed, because a dismissal lives in one browser's storage and this is the
        department's decision: the next coordinator to open the page must see it too.
        """
        with self.engine.begin() as connection:
            course = connection.execute(
                text("SELECT scope_id FROM scope_courses WHERE id = :id"), {"id": course_id}
            ).scalar()
            if course is None:
                raise CourseNotFound(course_id)
            connection.execute(
                text("""INSERT INTO course_exemptions (student_id, course_id, reason, created_at)
                        VALUES (:student, :course, :reason, :now)
                        ON CONFLICT (student_id, course_id) DO UPDATE SET reason = :reason"""),
                {"student": _text(student_id), "course": course_id, "reason": _text(reason), "now": _now()},
            )

    def clear_exemption(self, *, student_id: str, course_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM course_exemptions WHERE student_id = :student AND course_id = :course"),
                {"student": _text(student_id), "course": course_id},
            )

    def exemptions_of(self, cohort_id: str) -> list[dict[str, Any]]:
        """Every exemption against a course of a set this cohort's students are taught in.

        Its own sets AND every set open to every cohort — which is the whole of the fix
        here, and the third time this exact shape has been got wrong. A shared set is filed
        under whichever cohort happens to hold its row: the languages sit on Foundation
        Year's, so an L1 student's language exemption is stored against FYS. Asking for
        "L1's exemptions" by the set's owning cohort found none of them, and their record
        showed the course as one they still take.

        The register never had the bug, because it reads exemptions by SEMESTER — which is
        why the warning stopped and the strikethrough did not appear, and why the two
        disagreed on screen about the same fact.
        """
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT e.student_id, e.course_id, e.reason, c.code AS course_code,
                                   c.scope_id, s.code AS scope_code, s.term_id
                            FROM course_exemptions e
                            JOIN scope_courses c ON c.id = e.course_id
                            JOIN cohort_scopes s ON s.id = c.scope_id
                            WHERE s.cohort_id = :id OR s.open_to_all
                            ORDER BY e.student_id, c.code"""),
                    {"id": cohort_id},
                )
                .mappings()
                .all()
            )
        return [
            {
                "studentId": row["student_id"],
                "courseId": row["course_id"],
                "courseCode": row["course_code"],
                "scopeId": row["scope_id"],
                "scopeCode": row["scope_code"],
                "termId": row["term_id"],
                "reason": row["reason"],
            }
            for row in rows
        ]

    def exempt_codes(self, term_id: str) -> dict[str, set[str]]:
        """`{student id: {course code}}` for one semester — what the register must not expect.

        Every set of the semester, whichever cohort's row holds it, for the same reason
        `exemptions_of` reads by set: the languages belong to one cohort's row and are
        taken by all of them.
        """
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""SELECT e.student_id, c.code FROM course_exemptions e
                        JOIN scope_courses c ON c.id = e.course_id
                        JOIN cohort_scopes s ON s.id = c.scope_id
                        WHERE s.term_id = :term"""),
                {"term": term_id},
            ).all()
        found: dict[str, set[str]] = {}
        for student, code in rows:
            found.setdefault(student, set()).add(code)
        return found

    def scope_terms(self, cohort_id: str) -> list[str]:
        """Every semester this cohort is present on, linked to a portal term or not.

        There are two ways to be present and coverage needs both. Usually the cohort has
        sets of its own on the semester. But a set open to every cohort sits on ONE
        cohort's row, so a cohort whose only presence in a semester is the shared language
        hour has no `cohort_scopes` row for it at all — and reading `cohort_scopes WHERE
        cohort_id = :id` alone would lose exactly the semester nobody would think to check.
        Its placements are still its own: `group_assignments` carries the cohort.

        The unlinked semesters are the whole point. `registration_check` walks the linked
        terms, so a semester nobody has joined to a portal term produced no mismatches and
        no message — a clean Warnings column for a cohort that had never been asked about.
        """
        with self.engine.connect() as connection:
            return sorted(
                row[0]
                for row in connection.execute(
                    text("""SELECT DISTINCT term_id FROM cohort_scopes WHERE cohort_id = :id
                            UNION
                            SELECT DISTINCT s.term_id FROM group_assignments a
                              JOIN cohort_scopes s ON s.id = a.scope_id
                             WHERE a.cohort_id = :id"""),
                    {"id": cohort_id},
                )
            )

    def cohort_members(self, cohort_id: str) -> set[str]:
        """Who belongs to this cohort — the ids only, which is all a check needs."""
        with self.engine.connect() as connection:
            return {
                row[0]
                for row in connection.execute(
                    text("SELECT student_id FROM students WHERE cohort_id = :id"), {"id": cohort_id}
                )
            }

    def term_scope_crns(self, term_id: str) -> list[dict[str, Any]]:
        """Every live CRN of every group of every set on this semester, whichever cohort holds it.

        Not grouped by cohort, deliberately. A set open to every cohort — the languages —
        sits on one cohort's row, so anything that reads a semester cohort by cohort loses
        it for everybody else. The question this answers is about a set, not about whose.

        Down to the group, because a set carries several courses and one group of it gives a
        student a CRN for each: what no student can hold is two CRNs from two *groups* of the
        same set.
        """
        with self.engine.connect() as connection:
            scopes = (
                connection.execute(
                    text("SELECT id, code, name, cohort_id, open_to_all FROM cohort_scopes WHERE term_id = :t"),
                    {"t": term_id},
                )
                .mappings()
                .all()
            )
            if not scopes:
                return []
            scope_ids = [row["id"] for row in scopes]
            cells = (
                connection.execute(
                    text("""SELECT g.scope_id, g.id AS group_id, g.label, gc.course_id, gc.major_id, gc.crn,
                                   gc.not_taught
                            FROM group_crns gc
                            JOIN scope_groups g ON g.id = gc.group_id
                            WHERE g.scope_id = ANY(:ids) AND NOT gc.retired
                              AND (gc.crn <> '' OR gc.not_taught)"""),
                    {"ids": scope_ids},
                )
                .mappings()
                .all()
            )
            majors = self._majors(connection, scope_ids)
        # A bundle is what one placement hands a student: a group, or one sub-row of a
        # group that has them — the shared CRNs with the sub-row's own on top and the
        # courses it is not taught struck out. Two sub-rows of one group are two bundles.
        majors_of: dict[str, list[Any]] = {}
        for major in majors:
            majors_of.setdefault(major["group_id"], []).append(major)
        held: dict[str, dict[str, dict[str, Any]]] = {}
        by_group: dict[str, list[Any]] = {}
        for cell in cells:
            by_group.setdefault(cell["group_id"], []).append(cell)
        for group_id, own_cells in by_group.items():
            scope_id = own_cells[0]["scope_id"]
            label = own_cells[0]["label"]
            shared = {cell["course_id"]: cell["crn"] for cell in own_cells if not cell["major_id"] and cell["crn"]}
            groups = held.setdefault(scope_id, {})
            if not majors_of.get(group_id):
                groups[group_id] = {"label": label, "crns": set(shared.values())}
                continue
            for major in majors_of[group_id]:
                mine = dict(shared)
                for cell in own_cells:
                    if cell["major_id"] != major["id"]:
                        continue
                    if cell["not_taught"]:
                        mine.pop(cell["course_id"], None)
                    elif cell["crn"]:
                        mine[cell["course_id"]] = cell["crn"]
                # Named by the sub-row only where the group has more than one: "Mathematics"
                # for a group that holds mathematicians alone, "1 · Physics" for a shared one.
                named = f"{label} · {major['program']}" if len(majors_of[group_id]) > 1 else label
                groups[f"{group_id}|{major['id']}"] = {"label": named, "crns": set(mine.values())}
        return [
            {
                "scopeId": row["id"],
                "code": row["code"],
                "name": row["name"],
                "cohortId": row["cohort_id"],
                "openToAll": row["open_to_all"],
                "groups": [
                    {"groupId": group_id, "label": group["label"], "crns": sorted(group["crns"])}
                    for group_id, group in sorted(held.get(row["id"], {}).items(), key=lambda pair: pair[1]["label"])
                ],
            }
            for row in scopes
        ]

    # ------------------------------------------------------- editing a scope

    def _open_to_all(self, connection: Connection, scope_id: str) -> bool:
        """Whether this set takes students from every cohort, as the languages do."""
        return bool(
            connection.execute(
                text("SELECT open_to_all FROM cohort_scopes WHERE id = :id"), {"id": scope_id}
            ).scalar()
        )

    def add_scope(  # noqa: PLR0913 - one argument per column of the block
        self,
        cohort_id: str,
        *,
        code: str,
        name: str = "",
        note: str = "",
        term_id: str = "",
        kind: str = "shared",
        parent_scope_id: str = "",
        open_to_all: bool = False,
    ) -> str:
        self.get_cohort(cohort_id)
        scope_id = str(uuid4())
        with self.engine.begin() as connection:
            if self._scope_id(connection, cohort_id, _text(code), _text(term_id)):
                raise DuplicateLabel(code)
            connection.execute(
                text("""INSERT INTO cohort_scopes
                            (id, cohort_id, code, name, note, term_id, kind, parent_scope_id,
                             open_to_all, position)
                        VALUES (:id, :cohort_id, :code, :name, :note, :term_id, :kind, :parent,
                                :open_to_all,
                                (SELECT coalesce(max(position), 0) + 1 FROM cohort_scopes
                                 WHERE cohort_id = :cohort_id))"""),
                {
                    "id": scope_id,
                    "cohort_id": cohort_id,
                    "code": _text(code),
                    "name": _text(name),
                    "note": _text(note),
                    "term_id": _text(term_id),
                    "kind": _scope_kind(kind),
                    "parent": _text(parent_scope_id) if _scope_kind(kind) == "nested" else "",
                    "open_to_all": bool(open_to_all),
                },
            )
            self._touch(connection, cohort_id)
        return scope_id

    def update_scope(  # noqa: PLR0913 - one argument per column of the block
        self,
        scope_id: str,
        *,
        code: str,
        name: str,
        note: str,
        kind: str = "shared",
        parent_scope_id: str = "",
        open_to_all: bool = False,
    ) -> None:
        with self.engine.begin() as connection:
            # A rename onto a sibling is refused the way making a duplicate is. Without
            # this the unique constraint answers instead, and a coordinator renaming CM to
            # TD while TD exists gets a server error rather than a sentence.
            held = connection.execute(
                text("SELECT cohort_id, term_id FROM cohort_scopes WHERE id = :id"), {"id": scope_id}
            ).mappings().first()
            standing = (
                self._scope_id(connection, held["cohort_id"], _text(code), held["term_id"] or "") if held else None
            )
            if standing and standing != scope_id:
                raise DuplicateLabel(code)
            updated = connection.execute(
                text("""UPDATE cohort_scopes SET code = :code, name = :name, note = :note,
                                                 kind = :kind, parent_scope_id = :parent,
                                                 open_to_all = :open_to_all
                        WHERE id = :id"""),
                {
                    "id": scope_id,
                    "code": _text(code),
                    "name": _text(name),
                    "note": _text(note),
                    "kind": _scope_kind(kind),
                    "parent": _text(parent_scope_id) if _scope_kind(kind) == "nested" else "",
                    "open_to_all": bool(open_to_all),
                },
            )
            if updated.rowcount == 0:
                raise ScopeNotFound(scope_id)
            self._touch_by_scope(connection, scope_id)

    def move_scope(self, scope_id: str, by: int) -> None:
        """Swap a set with the one beside it, among its own cohort's sets for its semester.

        The catalogue has always been read in `position` order and Groups & CRNs draws the
        sets in the order it receives them, so this is the whole of it: the page reading a
        cohort's tutorials before its lectures was a fact nobody had a way to change.

        A swap rather than a renumber, because two sets that somehow share a position
        should not have every other set's number rewritten to fix it — and the ordering
        falls back to the code, so a tie is still shown in a stable order.
        """
        step = 1 if by > 0 else -1
        with self.engine.begin() as connection:
            held = connection.execute(
                text("SELECT cohort_id, term_id, position FROM cohort_scopes WHERE id = :id"), {"id": scope_id}
            ).mappings().first()
            if held is None:
                raise ScopeNotFound(scope_id)
            # The nearest set on that side, in the reading order the page uses.
            after = ">" if step > 0 else "<"
            way = "ASC" if step > 0 else "DESC"
            neighbour = connection.execute(
                text(f"""SELECT id, position FROM cohort_scopes
                         WHERE cohort_id = :cohort AND term_id = :term AND id <> :id
                           AND (position, code) {after}
                               (:position, (SELECT code FROM cohort_scopes WHERE id = :id))
                         ORDER BY position {way}, code {way}
                         LIMIT 1"""),  # noqa: S608 - both are one of two fixed strings
                {"id": scope_id, "cohort": held["cohort_id"], "term": held["term_id"], "position": held["position"]},
            ).mappings().first()
            if neighbour is None:
                return
            connection.execute(
                text("UPDATE cohort_scopes SET position = :position WHERE id = :id"),
                {"id": scope_id, "position": neighbour["position"]},
            )
            connection.execute(
                text("UPDATE cohort_scopes SET position = :position WHERE id = :id"),
                {"id": neighbour["id"], "position": held["position"]},
            )
            self._touch(connection, held["cohort_id"])

    def delete_scope(self, scope_id: str) -> None:
        with self.engine.begin() as connection:
            cohort_id = self._cohort_of_scope(connection, scope_id)
            connection.execute(text("DELETE FROM cohort_scopes WHERE id = :id"), {"id": scope_id})
            self._touch(connection, cohort_id)

    def add_course(  # noqa: PLR0913 - one argument per column of the course being made
        self, scope_id: str, *, code: str, name: str = "", component: str = ""
    ) -> str:
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

    def update_course(self, course_id: str, *, code: str, name: str, component: str) -> None:
        with self.engine.begin() as connection:
            updated = connection.execute(
                text("""UPDATE scope_courses
                        SET code = :code, name = :name, component = :component
                        WHERE id = :id"""),
                {
                    "id": course_id,
                    "code": _text(code),
                    "name": _text(name),
                    "component": _text(component),
                },
            )
            if updated.rowcount == 0:
                raise CourseNotFound(course_id)

    def update_course_request(self, course_id: str, **fields: Any) -> None:
        """What this course asks of the timetable, for every section of it in this set.

        Kept apart from what the sections say rather than pushed into them: a section that
        has been told nothing has been told nothing, and a course's answer changing later
        should reach every section that never had one of its own. The workbook is where
        the two are put together.
        """
        values = {name: _text(fields.get(name, "")) for name in SECTION_FIELDS}
        values["anticipated"] = max(0, int(fields.get("anticipated", 0) or 0))
        assignments = ", ".join(f"{name} = :{name}" for name in values)
        with self.engine.begin() as connection:
            scope_id = connection.execute(
                text("SELECT scope_id FROM scope_courses WHERE id = :id"), {"id": course_id}
            ).scalar()
            if scope_id is None:
                raise CourseNotFound(course_id)
            connection.execute(
                text(f"UPDATE scope_courses SET {assignments} WHERE id = :id"),  # noqa: S608 - fixed names
                {"id": course_id, **values},
            )
            self._touch_by_scope(connection, scope_id)

    def delete_course(self, course_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM scope_courses WHERE id = :id"), {"id": course_id})

    def add_group(  # noqa: PLR0913 - one argument per column of the group
        self,
        scope_id: str,
        *,
        label: str,
        capacity: int = 0,
        note: str = "",
        parent_group_id: str = "",
        parallel_with: list[str] | None = None,
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
                text("""INSERT INTO scope_groups
                            (id, scope_id, label, capacity, note, parent_group_id, parallel_with, position)
                        VALUES (:id, :scope_id, :label, :capacity, :note, :parent, :parallel,
                                (SELECT coalesce(max(position), 0) + 1 FROM scope_groups
                                 WHERE scope_id = :scope_id))"""),
                {
                    "id": group_id,
                    "scope_id": scope_id,
                    "label": _text(label),
                    "capacity": max(0, capacity),
                    "note": _text(note),
                    "parent": _text(parent_group_id),
                    "parallel": json.dumps(_group_ids(parallel_with)),
                },
            )
            self._touch(connection, cohort_id)
        return group_id

    def update_group(  # noqa: PLR0913 - one argument per column of the group
        self,
        group_id: str,
        *,
        label: str,
        capacity: int,
        note: str,
        parent_group_id: str = "",
        parallel_with: list[str] | None = None,
    ) -> None:
        with self.engine.begin() as connection:
            # As above: renaming a group onto a sibling is a refusal, not a crash.
            clash = connection.execute(
                text("""SELECT g.id FROM scope_groups g
                        WHERE g.label = :label
                          AND g.scope_id = (SELECT scope_id FROM scope_groups WHERE id = :id)
                          AND g.id <> :id"""),
                {"id": group_id, "label": _text(label)},
            ).first()
            if clash:
                raise DuplicateLabel(label)
            updated = connection.execute(
                text("""UPDATE scope_groups SET label = :label, capacity = :capacity, note = :note,
                                                parent_group_id = :parent, parallel_with = :parallel
                        WHERE id = :id"""),
                {
                    "id": group_id,
                    "label": _text(label),
                    "capacity": max(0, capacity),
                    "note": _text(note),
                    "parent": _text(parent_group_id),
                    "parallel": json.dumps(_group_ids(parallel_with)),
                },
            )
            if updated.rowcount == 0:
                raise GroupNotFound(group_id)

    def delete_group(self, group_id: str) -> None:
        """Removing a group also unassigns whoever was in it — they need placing again."""
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM scope_groups WHERE id = :id"), {"id": group_id})

    def set_cell(  # noqa: PLR0913 - one keyword per thing a cell says
        self,
        *,
        group_id: str,
        course_id: str,
        crn: str,
        teacher: str = "",
        part: int = 1,
        major_id: str = "",
        not_taught: bool = False,
    ) -> None:
        """One part of one cell: which CRN this group holds for this course, when.

        `part` is 1 for a section taught by one person from start to finish, which is
        almost all of them. A course split between two professors carries a part each, and
        clearing a part's CRN removes that part rather than the whole section — so undoing
        a split leaves the half that remains, instead of emptying the cell.
        """
        value = _text(crn)
        with self.engine.begin() as connection:
            major = self._major_of(connection, group_id, major_id)
            if not value and not not_taught:
                connection.execute(
                    text("""DELETE FROM group_crns
                            WHERE group_id = :group_id AND course_id = :course_id AND part = :part
                              AND major_id = :major"""),
                    {"group_id": group_id, "course_id": course_id, "part": _part_number(part), "major": major},
                )
                return
            # "Not taught" is a sub-row's word about a course, and it has no CRN. Said on
            # the whole group it would mean nothing, so it is only kept for a sub-row.
            struck = bool(not_taught) and bool(major)
            connection.execute(
                text("""INSERT INTO group_crns (group_id, course_id, part, major_id, crn, teacher, not_taught)
                        VALUES (:group_id, :course_id, :part, :major, :crn, :teacher, :struck)
                        ON CONFLICT (group_id, course_id, part, major_id) DO UPDATE
                        SET crn = :crn, teacher = :teacher, not_taught = :struck"""),
                {
                    "group_id": group_id,
                    "course_id": course_id,
                    "part": _part_number(part),
                    "major": major,
                    "crn": "" if struck else value,
                    "teacher": "" if struck else _text(teacher),
                    "struck": struck,
                },
            )

    def update_section(
        self, *, group_id: str, course_id: str, part: int = 1, major_id: str = "", **fields: Any
    ) -> None:
        """What the timetabler's workbook says about one section, beyond its CRN.

        The CRN itself is `set_cell`'s. A section may exist without one — the portal has
        not made it yet — so this creates the row when it is missing rather than refusing.
        """
        values = {name: _text(fields.get(name, "")) for name in SECTION_FIELDS}
        values["anticipated"] = max(0, int(fields.get("anticipated", 0) or 0))
        values["retired"] = bool(fields.get("retired", False))
        with self.engine.begin() as connection:
            owner = connection.execute(
                text("SELECT scope_id FROM scope_groups WHERE id = :id"), {"id": group_id}
            ).scalar()
            if owner is None:
                raise GroupNotFound(group_id)
            course = connection.execute(
                text("SELECT scope_id FROM scope_courses WHERE id = :id"), {"id": course_id}
            ).scalar()
            if course is None:
                raise CourseNotFound(course_id)
            assignments = ", ".join(f"{name} = :{name}" for name in (*SECTION_FIELDS, "anticipated", "retired"))
            connection.execute(
                text(f"""INSERT INTO group_crns
                             (group_id, course_id, part, major_id, crn, teacher, {", ".join(values)})
                         VALUES (:group_id, :course_id, :part, :major, '', '',
                                 {", ".join(f":{name}" for name in values)})
                         ON CONFLICT (group_id, course_id, part, major_id) DO UPDATE SET {assignments}"""),  # noqa: S608
                {
                    "group_id": group_id,
                    "course_id": course_id,
                    "part": _part_number(part),
                    "major": self._major_of(connection, group_id, major_id),
                    **values,
                },
            )
            self._touch_by_scope(connection, owner)

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

    def _write_cell(  # noqa: PLR0913 - one argument per column of the cell being written
        self, connection: Connection, group_id: str, course_id: str, crn: str, teacher: str, part: int = 1
    ) -> None:
        """The workbook's way in. It has a column per course and so only ever writes part 1."""
        connection.execute(
            text("""INSERT INTO group_crns (group_id, course_id, part, major_id, crn, teacher)
                    VALUES (:group, :course, :part, '', :crn, :teacher)
                    ON CONFLICT (group_id, course_id, part, major_id)
                    DO UPDATE SET crn = excluded.crn, teacher = excluded.teacher"""),
            {
                "group": group_id,
                "course": course_id,
                "part": _part_number(part),
                "crn": _text(crn),
                "teacher": _text(teacher),
            },
        )

    def _scope_of_group(self, connection: Connection, group_id: str) -> str:
        scope_id = connection.execute(
            text("SELECT scope_id FROM scope_groups WHERE id = :id"), {"id": group_id}
        ).scalar()
        if scope_id is None:
            raise GroupNotFound(group_id)
        return scope_id

    def _scope_id(self, connection: Connection, cohort_id: str, code: str, term_id: str = "") -> str | None:
        row = connection.execute(
            text("""SELECT id FROM cohort_scopes
                    WHERE cohort_id = :cohort_id AND code = :code AND term_id = :term_id"""),
            {"cohort_id": cohort_id, "code": code, "term_id": term_id},
        ).first()
        return row[0] if row else None

    def _cohort_of_scope(self, connection: Connection, scope_id: str) -> str:
        row = connection.execute(text("SELECT cohort_id FROM cohort_scopes WHERE id = :id"), {"id": scope_id}).first()
        if row is None:
            raise ScopeNotFound(scope_id)
        return row[0]

    # -------------------------------------------------------------- history

    def _record(self, connection: Connection, entries: list[dict[str, Any]], *, actor: str = "") -> None:
        """Write what just happened to these students, one line each, signed and dated.

        Called inside the transaction that did the thing, so a placement that is rolled
        back leaves no line saying it happened.
        """
        if not entries:
            return
        now = _now()
        connection.execute(
            text("""INSERT INTO student_history (id, student_id, kind, detail, author, happened_at)
                    VALUES (:id, :student, :kind, :detail, :author, :at)"""),
            [
                {
                    "id": str(uuid4()),
                    "student": _text(entry["studentId"]),
                    "kind": entry["kind"],
                    "detail": json.dumps(entry.get("detail", {})),
                    "author": _text(actor),
                    "at": now,
                }
                for entry in entries
            ],
        )

    def _placement_facts(self, connection: Connection, scope_id: str) -> tuple[str, dict[str, str], dict[str, str]]:
        """The set's code, its groups' labels, and its sub-rows' programmes — for the lines."""
        scope_code = connection.execute(
            text("SELECT code FROM cohort_scopes WHERE id = :id"), {"id": scope_id}
        ).scalar()
        labels = {
            row[0]: row[1]
            for row in connection.execute(
                text("SELECT id, label FROM scope_groups WHERE scope_id = :scope"), {"scope": scope_id}
            )
        }
        programs = {
            row[0]: row[1]
            for row in connection.execute(
                text("""SELECT m.id, m.program FROM group_majors m
                        JOIN scope_groups g ON g.id = m.group_id WHERE g.scope_id = :scope"""),
                {"scope": scope_id},
            )
        }
        return str(scope_code or ""), labels, programs

    def _held_in_scope(
        self, connection: Connection, scope_id: str, student_ids: list[str]
    ) -> dict[str, tuple[str, str]]:
        """`student -> (group, sub-row)` for what they hold in this set before a write."""
        if not student_ids:
            return {}
        return {
            row[0]: (row[1], row[2] or "")
            for row in connection.execute(
                text("""SELECT student_id, group_id, major_id FROM group_assignments
                        WHERE scope_id = :scope AND student_id = ANY(:ids)"""),
                {"scope": scope_id, "ids": student_ids},
            )
        }

    def _placement_lines(  # noqa: PLR0913 - one argument per part of the line
        self,
        connection: Connection,
        scope_id: str,
        before: dict[str, tuple[str, str]],
        after: dict[str, tuple[str | None, str]],
    ) -> list[dict[str, Any]]:
        """One `placed` or `removed` line per student whose group in this set changed.

        Re-saving somebody into the group they already hold is not a change and gets no
        line: the history says what happened, not what was pressed.
        """
        scope_code, labels, programs = self._placement_facts(connection, scope_id)
        lines: list[dict[str, Any]] = []
        for student, (group_id, major_id) in after.items():
            old = before.get(student)
            if old == (group_id, major_id) or (old is None and group_id is None):
                continue
            detail = {
                "scopeCode": scope_code,
                "from": labels.get(old[0], "") if old else "",
                "fromProgram": programs.get(old[1], "") if old else "",
                "to": labels.get(group_id or "", ""),
                "program": programs.get(major_id, ""),
            }
            lines.append({"studentId": student, "kind": "placed" if group_id else "removed", "detail": detail})
        return lines

    def history_of(self, student_id: str) -> list[dict[str, Any]]:
        """Everything the server has seen happen to one student, newest first."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, kind, detail, author, happened_at FROM student_history
                            WHERE student_id = :student ORDER BY happened_at DESC, seq DESC"""),
                    {"student": _text(student_id)},
                )
                .mappings()
                .all()
            )
        return [
            {
                "id": row["id"],
                "kind": row["kind"],
                "detail": json.loads(row["detail"] or "{}"),
                "author": row["author"],
                "at": row["happened_at"],
            }
            for row in rows
        ]

    def record_registration_changes(self, changes: list[dict[str, Any]]) -> int:
        """Lines for registrations that appeared or disappeared, for students in our cohorts.

        The registrations pull is the portal's, so nobody signs these. Students in no
        cohort are not ours to keep a history of, and are left out here rather than at
        every caller.
        """
        if not changes:
            return 0
        with self.engine.begin() as connection:
            ours = {
                row[0]
                for row in connection.execute(
                    text("SELECT student_id FROM students WHERE cohort_id IS NOT NULL AND student_id = ANY(:ids)"),
                    {"ids": sorted({_text(change["studentId"]) for change in changes})},
                )
            }
            kept = [change for change in changes if _text(change["studentId"]) in ours]
            self._record(connection, kept)
        return len(kept)

    # ------------------------------------------------------------ approvals

    def approvals_for(self, term_code: str) -> dict[str, set[str]]:
        """`{student id: {course code}}` — the electives a coordinator has approved, one term."""
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT student_id, course_code FROM course_approvals WHERE term_code = :t"),
                {"t": _text(term_code)},
            ).all()
        found: dict[str, set[str]] = {}
        for student, code in rows:
            found.setdefault(student, set()).add(code)
        return found

    def approvals_of(self, student_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT * FROM course_approvals WHERE student_id = :student
                            ORDER BY term_code DESC, course_code"""),
                    {"student": _text(student_id)},
                )
                .mappings()
                .all()
            )
        return [_approval(row) for row in rows]

    def set_approval(
        self, *, student_id: str, term_code: str, course_code: str, note: str = "", actor: str = ""
    ) -> dict[str, Any]:
        """This student may take this course outside our groups, this term.

        A decision on the server, signed: the register stops warning about it for everybody
        who looks, and the next coordinator can see whose call it was.
        """
        row = {
            "student": _text(student_id),
            "term": _text(term_code),
            "code": _text(course_code).upper(),
            "note": _text(note),
            "by": _text(actor),
            "now": _now(),
        }
        if not (row["student"] and row["term"] and row["code"]):
            raise ValueError("An approval names a student, a term and a course.")
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO course_approvals
                            (student_id, term_code, course_code, note, approved_by, approved_at)
                        VALUES (:student, :term, :code, :note, :by, :now)
                        ON CONFLICT (student_id, term_code, course_code)
                        DO UPDATE SET note = :note, approved_by = :by, approved_at = :now"""),
                row,
            )
            self._record(
                connection,
                [
                    {
                        "studentId": row["student"],
                        "kind": "approved",
                        "detail": {"courseCode": row["code"], "termCode": row["term"]},
                    }
                ],
                actor=actor,
            )
        return {
            "studentId": row["student"],
            "termCode": row["term"],
            "courseCode": row["code"],
            "note": row["note"],
            "approvedBy": row["by"],
            "approvedAt": row["now"],
        }

    def clear_approval(self, *, student_id: str, term_code: str, course_code: str, actor: str = "") -> None:
        with self.engine.begin() as connection:
            gone = connection.execute(
                text("""DELETE FROM course_approvals
                        WHERE student_id = :student AND term_code = :term AND course_code = :code"""),
                {"student": _text(student_id), "term": _text(term_code), "code": _text(course_code).upper()},
            ).rowcount
            if gone:
                self._record(
                    connection,
                    [
                        {
                            "studentId": _text(student_id),
                            "kind": "unapproved",
                            "detail": {"courseCode": _text(course_code).upper(), "termCode": _text(term_code)},
                        }
                    ],
                    actor=actor,
                )

    def _touch(self, connection: Connection, cohort_id: str) -> None:
        connection.execute(
            text("UPDATE student_cohorts SET updated_at = :now WHERE id = :id"),
            {"id": cohort_id, "now": _now()},
        )

    def _touch_by_scope(self, connection: Connection, scope_id: str) -> None:
        self._touch(connection, self._cohort_of_scope(connection, scope_id))


FIELD_KEY = re.compile(r"^[A-Z][A-Z0-9_]{1,39}$")
# A code, or a description the portal itself filters by ("Flying-Professional Assignment" is
# how the teachers grid names a type) — never a sentence. Mirrors the extension's rule.
VALUE = re.compile(r"^[A-Za-z0-9._\-][A-Za-z0-9._\- ]{0,59}$")
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


# The last is the outward look: students not in the cohort whose record says they belong.
RULE_KINDS = ("changed", "changed_to", "is", "is_not", "differs", "belongs")
BELONGS_FIELDS = ("MAJOR_CODE", "MAJOR_CODE_DESC")
# What "differs from the cohort" can compare against: the majors and terms a cohort spans
# (by code, or by the portal's label for the code) and the year level it expects.
DIFFERS_FIELDS = ("MAJOR_CODE", "MAJOR_CODE_DESC", "TERM_CODE", "YEARLEVEL_CODE")
FIELD_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class InvalidRule(ValueError):
    """A rule that cannot mean anything, and why."""


def _clean_rule(rule: dict[str, Any], position: int) -> dict[str, Any]:
    field = _text(rule.get("field")).upper()
    kind = _text(rule.get("kind"))
    # The earlier name for "belongs", kept so a saved rule still reads.
    if kind == "moved_in":
        kind = "belongs"
    raw_values = rule.get("values") or []
    if not FIELD_NAME.match(field):
        raise InvalidRule(f"'{rule.get('field')}' is not a portal field name.")
    if kind not in RULE_KINDS:
        raise InvalidRule(f"'{kind}' is not a kind of rule.")
    if kind == "differs" and field not in DIFFERS_FIELDS:
        raise InvalidRule(f"A cohort has no {field} to differ from; only its majors, terms or year level.")
    if kind == "belongs" and field not in BELONGS_FIELDS:
        raise InvalidRule("Belonging is judged from the major first; the rule must be on MAJOR_CODE.")
    if not isinstance(raw_values, list):
        raise InvalidRule("A rule's values must be a list.")
    values = [_text(value) for value in raw_values if _text(value)]
    if kind in ("changed_to", "is", "is_not") and not values:
        raise InvalidRule(f"A '{kind}' rule needs at least one value.")
    if kind in ("changed", "differs", "belongs"):
        values = []
    return {
        "id": _text(rule.get("id")) or str(uuid4()),
        "field": field,
        "kind": kind,
        "values": values,
        # Empty means every cohort.
        "cohort_id": _text(rule.get("cohortId") or rule.get("cohort_id")),
        "position": position,
    }


def _rule(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "field": row["field"],
        "kind": row["kind"],
        "values": json.loads(row["values"] or "[]"),
        "cohortId": row["cohort_id"] or "",
    }


def _cohort(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "term": row["term"],
        "notes": row["notes"],
        # What the cohort expects, as the portal codes it: the majors and terms it spans.
        "majors": json.loads(row["major_codes"] or "[]"),
        "terms": json.loads(row["term_codes"] or "[]"),
        "yearLevel": row["year_level"] or "",
        # What its sheet is called in the timetable workbook, and the number that sheet
        # gives its first semester — S3 for Licence 2, because the numbering runs across
        # the degree. Empty means "work it out from the name", which is what we did before.
        "workbookTab": row["workbook_tab"] or "",
        "firstSemester": row["first_semester"] or 0,
        # What is always allowed outside our groups — sport, a language taught elsewhere —
        # as course codes ("SPRT-101") or subject prefixes ("SPRT"). Everything else a
        # student is registered in that is in no group of theirs is an *outside* verdict.
        "allowedCodes": json.loads(row["allowed_codes"] or "[]"),
        "memberCount": row["member_count"],
        "scopeCount": row["scope_count"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _approval(row) -> dict[str, Any]:
    return {
        "studentId": row["student_id"],
        "termCode": row["term_code"],
        "courseCode": row["course_code"],
        "note": row["note"] or "",
        "approvedBy": row["approved_by"] or "",
        "approvedAt": row["approved_at"],
    }


def _course(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "component": row["component"],
        # What the course asks of the timetable, as against what each section asks.
        "request": _request(row),
    }


def _capacity_of(group: Any, majors: list[dict[str, Any]]) -> int:
    """A group's seats: what its sub-rows add up to, or its own number when it has none."""
    return sum(int(major["seats"]) for major in majors) if majors else int(group["capacity"])


def _sections_by_major(cells: list[Any]) -> dict[str, dict[str, dict[str, dict[str, Any]]]]:
    """`{major id: {group id: {course id: section}}}` for the cells that belong to one sub-row."""
    found: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    for major_id, own in _group_by(cells, lambda cell: cell["major_id"]).items():
        found[major_id] = _sections_of(own)
    return found


def _group_by(rows: list[Any], key: Any) -> dict[str, list[Any]]:
    held: dict[str, list[Any]] = {}
    for row in rows:
        held.setdefault(key(row), []).append(row)
    return held


def _crns_by_major(
    cells: list[Any], code_of: dict[str, str], majors_of: dict[str, list[Any]]
) -> dict[str, dict[str, dict[str, list[str]]]]:
    """`{group id: {major id: {course code: [CRN, ...]}}}` — what each sub-row comes to.

    The group's shared cells, then the sub-row's own on top: a course the sub-row has its
    own CRN for takes that CRN instead, and a course the sub-row is not taught drops out.
    What a student on that sub-row is expected in, and what the registrar is asked about
    for them.
    """
    shared = _crns_of([cell for cell in cells if not cell["major_id"]], code_of)
    own = _group_by([cell for cell in cells if cell["major_id"]], lambda cell: cell["major_id"])
    found: dict[str, dict[str, dict[str, list[str]]]] = {}
    for group_id, majors in majors_of.items():
        for major in majors:
            effective = {code: list(crns) for code, crns in shared.get(group_id, {}).items()}
            by_course: dict[str, list[Any]] = {}
            for cell in own.get(major["id"], []):
                by_course.setdefault(cell["course_id"], []).append(cell)
            for course_id, parts in by_course.items():
                code = code_of.get(course_id)
                if not code:
                    continue
                if any(cell["not_taught"] for cell in parts):
                    effective.pop(code, None)
                    continue
                live = [cell for cell in sorted(parts, key=lambda row: row["part"]) if not cell["retired"]]
                crns = [cell["crn"] for cell in live if cell["crn"]]
                if crns:
                    effective[code] = crns
            found.setdefault(group_id, {})[major["id"]] = effective
    return found


def _crn_programs(cells: list[Any], code_of: dict[str, str], majors_of: dict[str, list[Any]]) -> dict[str, str]:
    """`CRN -> programme`, for the CRNs taught to one sub-row and no other of their group.

    A sub-row's own CRN is its programme's. A shared CRN in a group whose other sub-rows
    are not taught that course is, in effect, the remaining sub-row's. Everything else —
    a shared CRN taken by every major, a group with no sub-rows — names no programme,
    and two such CRNs may well have a student in common.
    """
    by_major = _crns_by_major(cells, code_of, majors_of)
    found: dict[str, str] = {}
    for group_id, majors in majors_of.items():
        takers: dict[str, set[str]] = {}
        for major in majors:
            for crns in by_major.get(group_id, {}).get(major["id"], {}).values():
                for crn in crns:
                    takers.setdefault(crn, set()).add(major["program"])
        for crn, programs in takers.items():
            if len(programs) == 1:
                found[crn] = next(iter(programs))
    return found


def _request(row) -> dict[str, Any]:
    """The timetable request itself — the part a course and a section say the same way."""
    return {
        "teacherId": row["teacher_id"],
        "hours": row["hours"],
        "sessionsPerWeek": row["sessions_per_week"],
        "duration": row["duration"],
        "weeks": row["weeks"],
        "anticipated": row["anticipated"],
        "roomPref": row["room_pref"],
        "dayPref": row["day_pref"],
        "timePref": row["time_pref"],
        "constraints": row["constraints"],
        "comments": row["comments"],
    }


def _part(cell) -> dict[str, Any]:
    """One stretch of a section's teaching: a CRN, and everything asked of it."""
    return {
        **_request(cell),
        "part": int(cell["part"]),
        "crn": cell["crn"],
        "teacher": cell["teacher"],
        "retired": bool(cell["retired"]),
        # Whose cell this is: a sub-row's, or the whole group's when blank.
        "majorId": cell["major_id"],
        # A sub-row's word that it is not taught this course at all.
        "notTaught": bool(cell["not_taught"]),
    }


def _section(cells: list[Any]) -> dict[str, Any]:
    """A (group, course) cell, which may be taught in more than one stretch.

    The first part's fields stand at the top level and `parts` lists every one of them,
    first included. That looks like duplication and is deliberate: a section with one part
    is byte-identical to what this returned before parts existed, so nothing that reads a
    section's `crn` or `teacher` had to learn a new shape to keep being right about the
    ninety-nine sections in a hundred that are taught by one person from start to finish.

    The two cannot drift, because both are built here from the same rows. What must not be
    done is to write a *second* part's CRN into the top level — anything that needs every
    CRN of a section reads `parts`, and the sites that must are the ones that decide what a
    student is expected to be registered in, what the registrar is asked about, and whose
    hours these are.
    """
    parts = [_part(cell) for cell in sorted(cells, key=lambda row: row["part"])]
    return {**parts[0], "parts": parts}


def _sections_of(cells: list[Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """`{group id: {course id: section}}`, folding each cell's parts back together."""
    held: dict[tuple[str, str], list[Any]] = {}
    for cell in cells:
        held.setdefault((cell["group_id"], cell["course_id"]), []).append(cell)
    found: dict[str, dict[str, dict[str, Any]]] = {}
    for (group_id, course_id), parts in held.items():
        found.setdefault(group_id, {})[course_id] = _section(parts)
    return found


def _crns_of(cells: list[Any], code_of: dict[str, str]) -> dict[str, dict[str, list[str]]]:
    """`{group id: {course code: [CRN, ...]}}` — every CRN, because a section may have two.

    A list rather than one CRN. A section taught in two halves carries a CRN for each, and
    a map that held one of them would decide, silently and by row order, which half of the
    semester the register is checked against and which half of it the registrar is asked
    about. Retired cells and cells the portal has no CRN for yet enrol nobody and are left
    out, exactly as when this returned a single CRN.
    """
    found: dict[str, dict[str, list[str]]] = {}
    for cell in sorted(cells, key=lambda row: row["part"]):
        course_code = code_of.get(cell["course_id"])
        if course_code and cell["crn"] and not cell["retired"]:
            found.setdefault(cell["group_id"], {}).setdefault(course_code, []).append(cell["crn"])
    return found


def _scope_kind(kind: str) -> str:
    value = _text(kind).lower()
    return value if value in SCOPE_KINDS else "shared"
