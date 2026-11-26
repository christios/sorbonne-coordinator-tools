"""People not active in a semester give their timetable preferences too.

A coordinator may put somebody on a semester's Timetable preferences list who is on neither
Active teachers nor the part-time teachers list — a new hire, a candidate, somebody not in
the portal yet (user, 26 Nov 2026). They are given a department record of their own (an
`active_teachers` row with neither a portal profile nor a part-time record, in no semester),
and this says which semesters' lists they were put on:

    wish_people     term_code, teacher_id: put on that semester's preferences list without
                    being active in it; when, and by whom.

Their answer, invitation and reopening hang on that record as anybody's do. Once they are
on Active teachers, the coordinator links the two, and the answer moves with them.

Revision ID: 0103
Revises: 0102
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wish_people",
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column(
            "teacher_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("added_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("wish_people")
