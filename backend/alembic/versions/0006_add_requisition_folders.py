"""Add requisition folders.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-24
"""

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "requisition_folders",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, unique=True),
        sa.Column("parent_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_foreign_key(
        "requisition_folders_parent_id_fkey",
        "requisition_folders",
        "requisition_folders",
        ["parent_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("requisition_folders_parent_id", "requisition_folders", ["parent_id"])
    op.add_column("requisitions", sa.Column("folder_id", sa.Text(), nullable=True))
    op.create_foreign_key(
        "requisitions_folder_id_fkey",
        "requisitions",
        "requisition_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("requisitions_folder_id", "requisitions", ["folder_id"])


def downgrade() -> None:
    op.drop_index("requisitions_folder_id", table_name="requisitions")
    op.drop_constraint("requisitions_folder_id_fkey", "requisitions", type_="foreignkey")
    op.drop_column("requisitions", "folder_id")
    op.drop_index("requisition_folders_parent_id", table_name="requisition_folders")
    op.drop_constraint("requisition_folders_parent_id_fkey", "requisition_folders", type_="foreignkey")
    op.drop_table("requisition_folders")
