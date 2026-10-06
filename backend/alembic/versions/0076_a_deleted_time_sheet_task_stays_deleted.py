"""A time-sheet task somebody deleted stays deleted.

The task that asks a teacher for a period's time sheet is made by the application, one
per contracted teacher per opened period, every time a teacher's tasks are read. So a
coordinator who deleted Samar Ghantous's task watched it come straight back: deleting it
removed the row, and the next read wrote it again. Deleting one now says "no sheet is owed
for this period", and that is written down here, by the task's name — which is made of
the teacher and the period — so the next read leaves it alone.

Revision ID: 0076
Revises: 0075
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waived_time_sheet_tasks",
        sa.Column("task_id", sa.Text(), primary_key=True),
        sa.Column("waived_at", sa.Text(), nullable=False),
        sa.Column("waived_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("waived_time_sheet_tasks")
