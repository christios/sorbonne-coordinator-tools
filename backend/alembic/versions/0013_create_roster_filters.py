"""Saved registrar searches, shared between coordinators.

A filter is a set of portal codes — YEARLEVEL_CODE: [FY], MAJOR_CODE: [MATH] — and holds
no student data, which is why it can live here rather than in each coordinator's browser.
Saving them centrally means a search written once is available to everyone, and the term
rollover is one edit instead of one per machine.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roster_filters",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        # {"YEARLEVEL_CODE": ["FY"], "STST_CODE": ["AS"]} — codes only, never a student.
        sa.Column("filter", postgresql.JSONB(), nullable=False),
        # What the portal answered last time, so a silent drop to zero rows is visible.
        sa.Column("expected_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_unique_constraint("roster_filters_name", "roster_filters", ["name"])


def downgrade() -> None:
    op.drop_constraint("roster_filters_name", "roster_filters", type_="unique")
    op.drop_table("roster_filters")
