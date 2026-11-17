"""The sets every cohort shares belong to All cohorts, not to Foundation Year.

The languages are one set of classes for the whole department (0034), but the set still sat
on one cohort's row — Foundation Year's — and went wherever FYS went:

- deleting FYS on 9 Nov 2026 took every student's French group with it, first years',
  second years' and third years' alike, 820 placements in all;
- every page that names a class's cohort by its set called A1-G1 FYS's, so asking the
  Semester timetable for L1 hid the language classes 113 first years sit in;
- FYS's workbook, hours and warnings carried the languages, and nobody else's did.

So a row of its own, "All cohorts", that holds sets and never students, and every set open
to every cohort moves onto it. Placements are untouched: each is filed under the student's
own cohort already, which is how L1 reads its students' language groups today, and FYS now
reads them the same way.

Revision ID: 0099
Revises: 0098
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None

ALL_COHORTS = "all-cohorts"


def upgrade() -> None:
    connection = op.get_bind()
    now = datetime.now(UTC).isoformat()
    connection.execute(
        sa.text("""INSERT INTO student_cohorts (id, name, term, notes, created_at, updated_at)
                   VALUES (:id, 'All cohorts', '',
                           'The sets every cohort shares, such as the languages. Holds no students.',
                           :now, :now)
                   ON CONFLICT (id) DO NOTHING"""),
        {"id": ALL_COHORTS, "now": now},
    )
    # One open set per code and semester has been the rule since 10 Nov 2026; one written
    # before it would collide with its twin on All cohorts' row, so it keeps its code with
    # its old cohort's name after it rather than stop the upgrade.
    shared = connection.execute(
        sa.text("""SELECT s.id, s.code, s.term_id, c.name FROM cohort_scopes s
                   JOIN student_cohorts c ON c.id = s.cohort_id
                   WHERE s.open_to_all AND s.cohort_id <> :all
                   ORDER BY s.term_id, upper(s.code), c.name"""),
        {"all": ALL_COHORTS},
    ).all()
    taken = {
        (term, code)
        for term, code in connection.execute(
            sa.text("SELECT term_id, code FROM cohort_scopes WHERE cohort_id = :all"), {"all": ALL_COHORTS}
        )
    }
    for scope_id, code, term_id, owner in shared:
        moved_code = code if (term_id, code) not in taken else f"{code} ({owner})"
        taken.add((term_id, moved_code))
        connection.execute(
            sa.text("UPDATE cohort_scopes SET cohort_id = :all, code = :code WHERE id = :id"),
            {"all": ALL_COHORTS, "code": moved_code, "id": scope_id},
        )


def downgrade() -> None:
    # Back onto a cohort of students: the first, by name, holding anybody in the set's
    # semester, as FYS was. Placements need nothing: they are filed under their students.
    connection = op.get_bind()
    for scope_id, term_id in connection.execute(
        sa.text("SELECT id, term_id FROM cohort_scopes WHERE cohort_id = :all"), {"all": ALL_COHORTS}
    ).all():
        owner = connection.execute(
            sa.text("""SELECT c.id FROM student_cohorts c
                       WHERE c.id <> :all
                       ORDER BY NOT EXISTS (SELECT 1 FROM cohort_members m
                                            WHERE m.cohort_id = c.id AND m.term_id = :term), c.name
                       LIMIT 1"""),
            {"all": ALL_COHORTS, "term": term_id},
        ).scalar()
        if owner is None:
            connection.execute(sa.text("DELETE FROM cohort_scopes WHERE id = :id"), {"id": scope_id})
            continue
        connection.execute(
            sa.text("UPDATE cohort_scopes SET cohort_id = :owner WHERE id = :id"), {"owner": owner, "id": scope_id}
        )
    connection.execute(sa.text("DELETE FROM student_cohorts WHERE id = :all"), {"all": ALL_COHORTS})
