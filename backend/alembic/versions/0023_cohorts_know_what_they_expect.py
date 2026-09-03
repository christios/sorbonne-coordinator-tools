"""Cohorts know what they expect, and students remember when they were placed.

A cohort is a program-and-year population, but nothing here said which program or which
year — so nothing could tell a student whose major admissions has changed from one whose
major matches. And a student's record carried no moment of placement, only an updated_at
that everything else bumps too, so "what changed since we put them here" had no baseline.

The rules that judge a discrepancy are shared: cohorts are, and two coordinators looking
at the same cohort should see the same warnings.

Revision ID: 0023
Revises: 0022
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_cohorts", sa.Column("program", sa.Text(), nullable=False, server_default=""))
    op.add_column("student_cohorts", sa.Column("year_level", sa.Text(), nullable=False, server_default=""))
    # Empty until a student is next placed; a record that predates this has no baseline
    # and the page says so rather than inventing one.
    op.add_column("students", sa.Column("cohort_since", sa.Text(), nullable=False, server_default=""))
    op.create_table(
        "discrepancy_rules",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("field", sa.Text(), nullable=False),
        # changed | changed_to | is | differs — see services/student_database.py
        sa.Column("kind", sa.Text(), nullable=False),
        # A JSON array of portal values; meaningful for changed_to and is.
        sa.Column("values", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("discrepancy_rules")
    op.drop_column("students", "cohort_since")
    op.drop_column("student_cohorts", "year_level")
    op.drop_column("student_cohorts", "program")
