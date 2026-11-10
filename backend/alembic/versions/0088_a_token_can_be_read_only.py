"""A token can be read-only.

A token carried the whole of its maker's access, so a program that only had to read —
a report, a dashboard, another department's tool — could not be given the data without
being given the means to change it. A read-only token reads what its maker can read and
changes nothing: the gate answers anything but a GET with 403 before a route sees it.

Every token made before this keeps the access it was made with.

Revision ID: 0088
Revises: 0087
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_tokens", sa.Column("read_only", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("api_tokens", "read_only")
