"""A student has a cohort in each semester.

A student was in one cohort (`students.cohort_id`), which was right while a cohort was the
year. The department plans a semester at a time: L1-S1 for the first semester, L1-S2 for
the second, each with its own sets and groups. A student in L1 is in both — and moving
them into L1-S2 must not take them out of L1-S1, whose groups they are still sitting in.

So membership is a table of its own: a student may be in several cohorts, one per
semester (a cohort's semester is its portal term). Joining a cohort replaces their cohort
of that semester only.

    cohort_members          who is in which cohort, and since when ("cohort since" was
                            the student's; it is now the membership's)
    student_cohorts.follows the cohort this one continues — L1-S2 follows L1-S1 — set when
                            a cohort is rolled over into the next semester of its year

Every student's cohort is carried over as their one membership.

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
        sa.Column(
            "student_id", sa.Text(), sa.ForeignKey("students.student_id", ondelete="CASCADE"), primary_key=True
        ),
        # The moment they were placed in it: what "changed since we put them here" counts from.
        sa.Column("since", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("cohort_members_student", "cohort_members", ["student_id"])
    op.execute(
        """INSERT INTO cohort_members (cohort_id, student_id, since)
           SELECT cohort_id, student_id, coalesce(cohort_since, '') FROM students WHERE cohort_id IS NOT NULL"""
    )
    op.add_column(
        "student_cohorts",
        sa.Column("follows", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="SET NULL"), nullable=True),
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
    op.drop_column("student_cohorts", "follows")
    op.drop_index("cohort_members_student", table_name="cohort_members")
    op.drop_table("cohort_members")
