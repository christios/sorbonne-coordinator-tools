"""A group set may be open to every cohort, not only the one that owns it.

Languages are one set of classes for the whole department: A1-G1 holds first years,
second years and third years at once, because what decides the group is the level of
French, not the degree. Twelve of the nineteen language groups of Semester 1 2026-27 hold
more than one cohort. A set tied to a single cohort could only be copied four times, and
four copies of a class do not share one room, one teacher or one capacity.

So a set can say it is open to everybody. Its groups then take any student the department
holds, and count all of them; every other set is unchanged and still takes only its own
cohort's students.

Revision ID: 0034
Revises: 0033
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cohort_scopes",
        sa.Column("open_to_all", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("cohort_scopes", "open_to_all")
