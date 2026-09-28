"""A semester keeps the weeks it has no classes in, which its week numbers skip.

The timetable counts teaching weeks, and a week with no classes — a break, 12 to 16
October — is not one of them: the week after it is the next number, not one more. The
department's own count said "Week 8" for what the timetable called Week 7 until this
list was kept beside Week 1.

Each week is kept as its Monday, ISO, in a JSON list.

Revision ID: 0074
Revises: 0073
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("term_weeks", sa.Column("without", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("term_weeks", "without")
