"""A group may name the groups it must be scheduled in parallel with.

"TD 1 and PHIL-TD 1 at the same hour, so the mathematicians and the physicists are busy at
once" is a fact the timetabler needs and the department knew only in somebody's head. It
lives on the group, beside its seats and its note, as a list of group ids, and travels
with the timetable request as a constraint.

Revision ID: 0054
Revises: 0053
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scope_groups", sa.Column("parallel_with", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("scope_groups", "parallel_with")
