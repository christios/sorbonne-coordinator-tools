"""One link for every teacher of a semester, the coordinator keeping the list of who comes in.

    wish_collections.share_code   the semester's shared link: posted once, to every teacher.
                                  Kept as it is, so a coordinator can copy it again at any
                                  time; it lets nobody in by itself. Empty until made.

Signing in by it with an address the coordinator set for one of the semester's teachers (an
invitation standing for it) opens that teacher's form; any other address is refused.

Revision ID: 0100
Revises: 0099
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wish_collections", sa.Column("share_code", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("wish_collections", "share_code")
