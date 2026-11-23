"""An uneven course says why.

A lead lays out a course's sessions week by week. When a component's sessions run well ahead
of or behind an even pace over the semester, the lead's step asks why before the course counts
as laid out (23 Nov 2026), and coordinators read the reason beside an "Uneven" tag:

    course_plans.pace_reason    why the weeks are laid out unevenly; "" when they are even, or
                                when nobody has said.

Revision ID: 0102
Revises: 0101
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_plans", sa.Column("pace_reason", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("course_plans", "pace_reason")
