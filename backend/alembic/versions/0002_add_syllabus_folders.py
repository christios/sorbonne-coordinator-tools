"""Add shared syllabus folders.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "syllabus_folders",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, unique=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.add_column("syllabi", sa.Column("folder_id", sa.Text(), nullable=True))
    op.create_foreign_key(
        "syllabi_folder_id_fkey",
        "syllabi",
        "syllabus_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("syllabi_folder_id", "syllabi", ["folder_id"])


def downgrade() -> None:
    op.drop_index("syllabi_folder_id", table_name="syllabi")
    op.drop_constraint("syllabi_folder_id_fkey", "syllabi", type_="foreignkey")
    op.drop_column("syllabi", "folder_id")
    op.drop_table("syllabus_folders")
