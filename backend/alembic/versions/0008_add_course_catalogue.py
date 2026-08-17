"""Add the imported course catalogue used by teacher requisitions.

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-24
"""

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_catalogue_entries",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("term", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False),
        sa.Column("course_title", sa.Text(), nullable=False),
        sa.Column("sequence", sa.Text(), nullable=False),
        sa.Column("credit", sa.Text(), nullable=False),
        sa.Column("department", sa.Text(), nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("college", sa.Text(), nullable=False),
        sa.Column("contact_hours", sa.Text(), nullable=False),
        sa.Column("is_obsolete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("imported_at", sa.Text(), nullable=False),
        sa.Column("obsolete_at", sa.Text(), nullable=True),
    )
    op.create_index("course_catalogue_entries_active_crn", "course_catalogue_entries", ["is_obsolete", "crn"])
    op.create_index("course_catalogue_entries_search", "course_catalogue_entries", ["crn", "course_code", "course_title"])


def downgrade() -> None:
    op.drop_index("course_catalogue_entries_search", table_name="course_catalogue_entries")
    op.drop_index("course_catalogue_entries_active_crn", table_name="course_catalogue_entries")
    op.drop_table("course_catalogue_entries")
