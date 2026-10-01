"""A list's sync remembers who ran it, as well as when.

The Portal sync button says how old the department's portal data is, and everybody reads
the same data — so a coordinator who had not synced saw "57 min ago" and could not tell
whose sync that was. Each student view and each portal filter now keeps the address of
whoever last synced it, beside the time it already kept.

Revision ID: 0075
Revises: 0074
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_views", sa.Column("last_synced_by", sa.Text(), nullable=False, server_default=""))
    op.add_column("portal_filters", sa.Column("last_synced_by", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("portal_filters", "last_synced_by")
    op.drop_column("student_views", "last_synced_by")
