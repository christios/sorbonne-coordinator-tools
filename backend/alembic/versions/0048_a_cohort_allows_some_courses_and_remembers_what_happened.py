"""A cohort allows some courses outside its groups, and a student's record remembers.

Three things the department decided together, because they are one fact about a student
seen from three sides.

**What a cohort should take is derived, not typed:** the courses of its sets. On top of
that, a cohort keeps a short list of what is always allowed outside our groups — sport, a
language taught by another department — as course codes or subject prefixes
(`allowed_codes`, a JSON list). A registration in anything else that is in no group of the
student's is an *outside* verdict of the register.

**A coordinator may approve one student's elective** (`course_approvals`): the verdict
goes away for that student and that course, and the approval is signed and dated so the
next coordinator knows whose decision it was. Keyed on the student id, the portal term
and the course code, because that is all the server knows about a registration.

**History on the server** (`student_history`): every cohort move, every group placement
and removal, every registered course that appears or disappears, every approval — with
who did it and when. Until now the History card read only from one browser's pull
history, which another coordinator's browser had never seen.

Revision ID: 0048
Revises: 0047
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_cohorts", sa.Column("allowed_codes", sa.Text(), nullable=False, server_default="[]"))
    op.create_table(
        "course_approvals",
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("student_id", "term_code", "course_code"),
    )
    op.create_table(
        "student_history",
        sa.Column("id", sa.Text(), primary_key=True),
        # The order lines were written in, for the ones a single transaction wrote at the
        # same instant — a move out of a cohort and the groups it cost, in that order.
        sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        # cohort · placed · removed · registered · dropped · approved · unapproved
        sa.Column("kind", sa.Text(), nullable=False),
        # What the entry says, as JSON: the cohort names, the set and group, the CRN and
        # course. Denormalised on purpose, so the line still reads after the group is gone.
        sa.Column("detail", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("author", sa.Text(), nullable=False, server_default=""),
        sa.Column("happened_at", sa.Text(), nullable=False),
    )
    op.create_index("ix_student_history_student", "student_history", ["student_id", "happened_at"])


def downgrade() -> None:
    op.drop_index("ix_student_history_student", table_name="student_history")
    op.drop_table("student_history")
    op.drop_table("course_approvals")
    op.drop_column("student_cohorts", "allowed_codes")
