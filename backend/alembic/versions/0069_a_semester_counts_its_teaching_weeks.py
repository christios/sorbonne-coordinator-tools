"""A semester counts its teaching weeks from a Week 1 an administrator sets.

The semester timetable moved week by week from dates alone, and the department talks in
week numbers — "the Week 5 tutorial", "from Week 8". The first teaching week is not the
portal's first date: a section may meet before induction ends, or the registrar may book a
Saturday. So it is said, per semester, in Settings.

Revision ID: 0069
Revises: 0068
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "term_weeks",
        # The Student Hub semester, as everything else here files a semester.
        sa.Column("term_id", sa.Text(), primary_key=True),
        # Any day of the first teaching week, ISO: the week it falls in is Week 1.
        sa.Column("week_one", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("term_weeks")
