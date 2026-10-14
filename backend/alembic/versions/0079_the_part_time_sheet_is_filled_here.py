"""What the university's Part Time Sheet needs that an approved period does not carry.

The Timesheets app sends the days and the approval, and nothing about money — by design,
the rate is ours to hold. So a part-time teacher's record keeps their rate per hour, blank
until somebody enters it.

The sheet is signed by the Head of Department, and who that is is the department's to say
once rather than every sheet's: it is one of the Active teachers, kept here by their row.

And the day the teacher submitted the period, which the employee's signature line is dated
with — kept when the app sends it, blank until it does.

Revision ID: 0079
Revises: 0078
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("part_time_teachers", sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=True))
    op.add_column("pushed_time_sheets", sa.Column("submitted_on", sa.Text(), nullable=False, server_default=""))
    op.create_table(
        "department_roles",
        # One row per role the department names somebody to; only "head_of_department" so far.
        sa.Column("role", sa.Text(), primary_key=True),
        sa.Column("active_teacher_id", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("department_roles")
    op.drop_column("pushed_time_sheets", "submitted_on")
    op.drop_column("part_time_teachers", "hourly_rate")
