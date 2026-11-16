"""A coordinator picks which sheet is a period's record: the app's, or their own.

A part-timer's period can have two sheets: the one the Part-Time Timesheets app pushes once
it is approved, and a workbook a coordinator linked by hand — the way every sheet went to HR
before the app. Only one of them may go to HR, or the month is paid twice. The app's is the
record unless a coordinator says their own is, which is what this remembers, on the link.

Every link that exists when this runs is one of those workbooks, and HR has it: the first
period of 2026-27 (15 Aug – 14 Sep) was done that way and is now being redone in the app so
that the app is the one record. So they all start as the record, and the app's sheets for
those periods arrive already accounted for. A coordinator can switch any period either way.

Revision ID: 0097
Revises: 0096
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0097"
down_revision = "0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teacher_time_sheets",
        sa.Column("chosen_over_app", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE teacher_time_sheets SET chosen_over_app = true")


def downgrade() -> None:
    op.drop_column("teacher_time_sheets", "chosen_over_app")
