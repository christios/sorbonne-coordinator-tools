"""An approved timesheet arrives from the Part-Time Timesheets app.

Part-time staff fill their days in a Power App over SharePoint, somebody approves it,
and a flow posts the approved period here. Until now the department's side of that was a
link to a workbook somebody typed in: the record said a sheet existed, and nothing more.

What arrives is the sheet itself — the hours claimed, the days they were worked, and who
approved it — so it is kept as it came rather than flattened into a link. Beside it sits
what the registrar's timetable says was actually taught in that period, and the two being
different is the thing worth seeing.

Keyed on the app's own period id, which is the SharePoint item. That is what makes a
repeat harmless: the flow retries a failed push, and a period re-approved after a
correction arrives again with a higher version. The newest version wins and an older one
that turns up late is ignored rather than undoing a correction.

The day lines are kept whole, as they were sent. They are somebody's account of their own
week and nothing here has any business reshaping them.

Revision ID: 0066
Revises: 0065
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pushed_time_sheets",
        #: The SharePoint item id, which is the app's own name for this period's sheet.
        sa.Column("period_id", sa.Text(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("teacher_id", sa.Text(), nullable=False),
        sa.Column("period_start", sa.Text(), nullable=False),
        sa.Column("period_end", sa.Text(), nullable=False, server_default=""),
        sa.Column("period_label", sa.Text(), nullable=False, server_default=""),
        #: As the app has them, kept beside our own record rather than trusted over it.
        sa.Column("staff_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("staff_number", sa.Text(), nullable=False, server_default=""),
        sa.Column("staff_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("department", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Text(), nullable=False, server_default=""),
        sa.Column("claimed_hours", sa.Float(), nullable=False, server_default="0"),
        sa.Column("approved_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_by_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_on", sa.Text(), nullable=False, server_default=""),
        #: The day lines exactly as sent: somebody's account of their own week.
        sa.Column("days", postgresql.JSONB(), nullable=False),
        sa.Column("sent_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("received_at", sa.Text(), nullable=False),
    )
    op.create_index("pushed_time_sheets_teacher", "pushed_time_sheets", ["teacher_id", "period_start"])


def downgrade() -> None:
    op.drop_index("pushed_time_sheets_teacher", table_name="pushed_time_sheets")
    op.drop_table("pushed_time_sheets")
