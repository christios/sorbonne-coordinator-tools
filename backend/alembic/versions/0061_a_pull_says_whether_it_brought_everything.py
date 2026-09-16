"""A registrations pull says whether it brought everything.

The register may only say "this student is registered in nothing" if it knows the pull it
is reading covered the whole department. Absence from a complete pull is a fact; absence
from a short one is an accident of paging, and the portal's paging is known to drop rows.

The browser has always known — it compares the portal's own total against what arrived,
and says so in the pull warning — and has never passed it on. This is where it lands.

Revision ID: 0061
Revises: 0060
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "portal_registration_pulls",
        sa.Column("filter_id", sa.Text(), sa.ForeignKey("portal_filters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_code", sa.Text(), nullable=False),
        # Whether the portal sent everything it said it had.
        sa.Column("complete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("returned", sa.Integer(), nullable=False, server_default="0"),
        # What the portal said the total was, where it said anything at all.
        sa.Column("expected", sa.Integer(), nullable=True),
        sa.Column("pulled_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("filter_id", "term_code"),
    )


def downgrade() -> None:
    op.drop_table("portal_registration_pulls")
