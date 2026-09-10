"""Groups may prefer a programme.

A block's groups are usually interchangeable, but not always: a tutorial group taught with
physics in mind should take the physics students first. The preference is the group's, so
it lives on the group — and it is a preference, not a wall: once the preferred students are
seated, anybody may sit there.

Revision ID: 0024
Revises: 0023
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scope_groups", sa.Column("program", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("scope_groups", "program")
