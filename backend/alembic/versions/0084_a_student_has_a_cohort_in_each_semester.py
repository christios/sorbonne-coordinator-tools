"""A cohort holds its students semester by semester.

A student was in one cohort (`students.cohort_id`). A cohort is a year's — L1, 2026-27 —
and the department works it a semester at a time: its sets are already kept per semester,
and now so are its students. L1's Semester 2 starts as a copy of its Semester 1 (a roll
over) and is changed from there; moving a student in Semester 2 leaves their Semester 1
alone, and the groups they sit in there.

    cohort_members   who is in which cohort in which semester, and since when ("cohort
                     since" was the student's; it is the membership's now). `term_id` is the
                     app's semester — the one a set names — and a student is in at most one
                     cohort per semester.

Every student's cohort is carried over into each semester that cohort is in: the
semesters it has sets on, and the ones linked to the portal terms it names. A cohort in
neither keeps them under no semester ("").

Revision ID: 0084
Revises: 0083
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cohort_members",
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("term_id", sa.Text(), primary_key=True, server_default=""),
        sa.Column(
            "student_id", sa.Text(), sa.ForeignKey("students.student_id", ondelete="CASCADE"), primary_key=True
        ),
        # The moment they were placed in it: what "changed since we put them here" counts from.
        sa.Column("since", sa.Text(), nullable=False, server_default=""),
        # One cohort per semester.
        sa.UniqueConstraint("term_id", "student_id", name="cohort_members_one_per_semester"),
    )
    op.create_index("cohort_members_student", "cohort_members", ["student_id"])
    op.execute(
        """INSERT INTO cohort_members (cohort_id, term_id, student_id, since)
           SELECT s.cohort_id, coalesce(t.term_id, ''), s.student_id, coalesce(s.cohort_since, '')
           FROM students s
           JOIN student_cohorts c ON c.id = s.cohort_id
           LEFT JOIN LATERAL (
               SELECT sc.term_id FROM cohort_scopes sc WHERE sc.cohort_id = c.id
               UNION
               SELECT tl.term_id FROM term_links tl
               WHERE tl.portal_term_code <> ''
                 AND (coalesce(c.term_codes, '[]'))::jsonb ? tl.portal_term_code
           ) t ON true
           ON CONFLICT DO NOTHING"""
    )
    op.drop_index("students_cohort", table_name="students")
    op.drop_column("students", "cohort_since")
    op.drop_column("students", "cohort_id")


def downgrade() -> None:
    op.add_column(
        "students",
        sa.Column("cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("students", sa.Column("cohort_since", sa.Text(), nullable=False, server_default=""))
    op.create_index("students_cohort", "students", ["cohort_id"])
    # One cohort each again: the latest they joined.
    op.execute(
        """UPDATE students s SET cohort_id = m.cohort_id, cohort_since = m.since
           FROM (SELECT DISTINCT ON (student_id) student_id, cohort_id, since
                 FROM cohort_members ORDER BY student_id, since DESC) m
           WHERE m.student_id = s.student_id"""
    )
    op.drop_index("cohort_members_student", table_name="cohort_members")
    op.drop_table("cohort_members")
