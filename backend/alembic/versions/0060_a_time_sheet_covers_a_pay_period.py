"""A time sheet covers a pay period, and the period is the department's own cycle.

A sheet carried a label, an academic year and a link, which was enough to reach the
workbook and not enough to say who was overdue. "1 time sheet" is not an answer to
"has this month been filed".

The period is stored as the day it starts, because the department's cycle runs the
15th of one month to the 14th of the next: one date identifies a period, and the end
follows from it. That cycle is also why five of the nine sheets filed for 2026-27 are
named "AugSept" and are ONE period rather than two months, which a pair of month
fields would have got wrong.

Empty is allowed and means nobody has said which period a sheet is for. The sheets
filed before this existed are exactly that until they are given one.

Revision ID: 0060
Revises: 0059
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teacher_time_sheets", sa.Column("period_start", sa.Text(), nullable=False, server_default="")
    )
    op.create_index("teacher_time_sheets_period", "teacher_time_sheets", ["teacher_id", "period_start"])


def downgrade() -> None:
    op.drop_index("teacher_time_sheets_period", table_name="teacher_time_sheets")
    op.drop_column("teacher_time_sheets", "period_start")
