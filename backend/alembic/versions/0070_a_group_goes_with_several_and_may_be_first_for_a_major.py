"""A group may go with several groups of the set it follows, and may be first for a major.

A set "inside another" let each of its groups sit inside exactly one group of that set:
Mechanics TP 1A inside TD 1. The department's other pairings are not one-to-one. L1's
Philosophy 2 is the class of TD 2 and TD 3 mathematicians; Foundation Year's CM B serves
TD 1 to 4, and its Readiness groups split a TD or straddle two. So a group now lists the
groups it goes with (`parent_group_ids`), and `parent_group_id` keeps the first of them for
anything that still reads one.

`first_for` is a preference, not a wall: L1's TD 3 was opened for the physicists, and a
mathematician goes there only once TD 1 and TD 2 are full. Blank for a group that is
nobody's in particular.

Revision ID: 0070
Revises: 0069
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scope_groups", sa.Column("parent_group_ids", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("scope_groups", sa.Column("first_for", sa.Text(), nullable=False, server_default=""))
    # Every group that sat inside one group now goes with that one.
    op.execute(
        """UPDATE scope_groups SET parent_group_ids = '["' || parent_group_id || '"]'
           WHERE trim(parent_group_id) <> ''"""
    )


def downgrade() -> None:
    op.drop_column("scope_groups", "first_for")
    op.drop_column("scope_groups", "parent_group_ids")
