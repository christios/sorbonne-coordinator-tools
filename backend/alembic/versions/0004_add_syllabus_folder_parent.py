"""add syllabus folder parent

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("syllabus_folders", sa.Column("parent_id", sa.Text(), nullable=True))
    op.create_foreign_key(
        "syllabus_folders_parent_id_fkey",
        "syllabus_folders",
        "syllabus_folders",
        ["parent_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("syllabus_folders_parent_id", "syllabus_folders", ["parent_id"])


def downgrade() -> None:
    op.drop_index("syllabus_folders_parent_id", table_name="syllabus_folders")
    op.drop_constraint("syllabus_folders_parent_id_fkey", "syllabus_folders", type_="foreignkey")
    op.drop_column("syllabus_folders", "parent_id")
