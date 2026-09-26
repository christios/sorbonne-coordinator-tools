"""The reasons a student may not take a course, kept as a list to choose from.

An exemption carried a free-text reason nobody typed. Some reasons are the department's
standing categories — the LEA track, a year being repeated — and a coordinator wants to
pick one rather than spell it, and to filter the tables on it afterwards. The list is data
an administrator keeps in Settings, not words written into the application.

Revision ID: 0071
Revises: 0070
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exemption_reasons",
        # The words themselves: "LEA track". The same words are stored on each exemption.
        sa.Column("label", sa.Text(), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("exemption_reasons")
