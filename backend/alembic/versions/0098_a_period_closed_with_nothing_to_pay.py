"""A period closed in the Timesheets app with nothing to pay.

A coordinator in the Part-Time Timesheets app can close a part-timer's period when there is
nothing to pay: no classes in it, say. A closed period is never approved, so it never arrives
as a sheet, and until now it looked here exactly like a sheet nobody had filed: the period's
"Time sheet" task stayed open and the teacher's row said "No sheet filed" for good. The app
now says so (timesheet.closure.v1), and says so again if the period is reopened. One row per
period the app names, the latest word on it.

Revision ID: 0098
Revises: 0097
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0098"
down_revision = "0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "time_sheet_closures",
        sa.Column("period_id", sa.Text(), primary_key=True),
        sa.Column("teacher_id", sa.Text(), nullable=False),
        sa.Column("period_start", sa.Text(), nullable=False),
        sa.Column("period_label", sa.Text(), nullable=False, server_default=""),
        # "closed" or "reopened": the latest word, by `at`.
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        # What the period still held when it was closed: shown, never paid.
        sa.Column("hours", sa.Float(), nullable=True),
        sa.Column("by_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("by_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("at", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("staff_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("staff_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("received_at", sa.Text(), nullable=False),
    )
    op.create_index("ix_time_sheet_closures_teacher_period", "time_sheet_closures", ["teacher_id", "period_start"])


def downgrade() -> None:
    op.drop_index("ix_time_sheet_closures_teacher_period", table_name="time_sheet_closures")
    op.drop_table("time_sheet_closures")
