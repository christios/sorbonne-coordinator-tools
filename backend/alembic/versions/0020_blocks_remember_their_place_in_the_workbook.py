"""Blocks remember which tab and column they occupy in the workbook.

A Reference sheet says where each block's group column lives: Readiness is a column on the
tutorials tab, not a tab of its own. Nothing here kept that, so a workbook written back out
had one sheet per block and no longer matched the one it came from.

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cohort_scopes", sa.Column("tab", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "cohort_scopes", sa.Column("group_column", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "cohort_scopes",
        sa.Column("group_column_index", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("cohort_scopes", "group_column_index")
    op.drop_column("cohort_scopes", "group_column")
    op.drop_column("cohort_scopes", "tab")
