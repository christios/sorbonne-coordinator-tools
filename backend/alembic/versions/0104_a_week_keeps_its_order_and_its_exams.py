"""A week keeps its order, and its exams.

A professor's feedback on the course schedule (26 Nov 2026): when CM, TD and TP fall in the
same week, students often need the CM or TD before the TP; and an exam is a session of its own
kind, not one more TD. The lead says both on the course's weeks:

    course_plans.cm_first       "CM comes before TD/TP" in a week holding both; off unless ticked.
    course_plans.td_before_tp   "TD comes before TP" in a week holding both; off unless ticked.
    course_plans.exams          the sessions that are exams, by row and week, each its place
                                among the week's sessions from 1: {"TD": {"8": [2]}}. An exam
                                counts in its kind's hours and keeps its groups.

Revision ID: 0104
Revises: 0103
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_plans", sa.Column("cm_first", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("course_plans", sa.Column("td_before_tp", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("course_plans", sa.Column("exams", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("course_plans", "exams")
    op.drop_column("course_plans", "td_before_tp")
    op.drop_column("course_plans", "cm_first")
