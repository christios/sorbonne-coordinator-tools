"""Create the Postgres syllabus tables.

Revision ID: 0001
Revises:
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "syllabi",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("series_id", sa.Text(), nullable=False),
        sa.Column("course_title", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False),
        sa.Column("academic_year", sa.Text(), nullable=False),
        sa.Column("content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("syllabi_series_id", "syllabi", ["series_id"])
    op.create_table(
        "syllabus_field_history",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("syllabus_id", sa.Text(), sa.ForeignKey("syllabi.id"), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("previous_value_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("new_value_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("changed_at", sa.Text(), nullable=False),
    )
    op.create_index(
        "syllabus_field_history_lookup",
        "syllabus_field_history",
        ["syllabus_id", "field_path", sa.text("changed_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("syllabus_field_history_lookup", table_name="syllabus_field_history")
    op.drop_table("syllabus_field_history")
    op.drop_index("syllabi_series_id", table_name="syllabi")
    op.drop_table("syllabi")
