"""A lecture (CM) is paid at a different rate from a tutorial or practical (TD/TP), and work
that is neither — office hours, admin — at a rate of its own.

A teacher who taught both is sent to HR as separate Part Time Sheets, one per rate, so their
record holds each rate. The rate already there becomes the TD/TP one: nearly every line
approved so far is a TD, and the one rate entered before this was entered as theirs.

Revision ID: 0080
Revises: 0079
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("part_time_teachers", sa.Column("cm_hourly_rate", sa.Numeric(10, 2), nullable=True))
    op.add_column("part_time_teachers", sa.Column("other_hourly_rate", sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("part_time_teachers", "other_hourly_rate")
    op.drop_column("part_time_teachers", "cm_hourly_rate")
