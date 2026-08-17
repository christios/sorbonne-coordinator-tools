"""Replace requisitions with part-time teacher database.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("requisitions")
    op.drop_table("requisition_folders")
    op.create_table("teacher_folders", sa.Column("id", sa.Text(), primary_key=True), sa.Column("name", sa.Text(), nullable=False, unique=True), sa.Column("parent_id", sa.Text(), nullable=True), sa.Column("created_at", sa.Text(), nullable=False), sa.Column("updated_at", sa.Text(), nullable=False))
    op.create_foreign_key("teacher_folders_parent_id_fkey", "teacher_folders", "teacher_folders", ["parent_id"], ["id"], ondelete="RESTRICT")
    op.create_index("teacher_folders_parent_id", "teacher_folders", ["parent_id"])
    op.create_table("part_time_teachers", sa.Column("id", sa.Text(), primary_key=True), sa.Column("folder_id", sa.Text(), nullable=True), sa.Column("full_name", sa.Text(), nullable=False), sa.Column("email", sa.Text(), nullable=False), sa.Column("phone", sa.Text(), nullable=False), sa.Column("notes", sa.Text(), nullable=False), sa.Column("archived_at", sa.Text(), nullable=True), sa.Column("created_at", sa.Text(), nullable=False), sa.Column("updated_at", sa.Text(), nullable=False))
    op.create_foreign_key("part_time_teachers_folder_id_fkey", "part_time_teachers", "teacher_folders", ["folder_id"], ["id"], ondelete="SET NULL")
    op.create_index("part_time_teachers_folder_id", "part_time_teachers", ["folder_id"])
    op.create_index("part_time_teachers_active_name", "part_time_teachers", ["archived_at", "full_name"])
    op.create_table("teacher_requisitions", sa.Column("id", sa.Text(), primary_key=True), sa.Column("teacher_id", sa.Text(), nullable=False), sa.Column("label", sa.Text(), nullable=False), sa.Column("academic_year", sa.Text(), nullable=False), sa.Column("content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False), sa.Column("revision", sa.Integer(), nullable=False), sa.Column("created_at", sa.Text(), nullable=False), sa.Column("updated_at", sa.Text(), nullable=False))
    op.create_foreign_key("teacher_requisitions_teacher_id_fkey", "teacher_requisitions", "part_time_teachers", ["teacher_id"], ["id"], ondelete="RESTRICT")
    op.create_index("teacher_requisitions_teacher_year", "teacher_requisitions", ["teacher_id", "academic_year"])


def downgrade() -> None:
    op.drop_index("teacher_requisitions_teacher_year", table_name="teacher_requisitions")
    op.drop_constraint("teacher_requisitions_teacher_id_fkey", "teacher_requisitions", type_="foreignkey")
    op.drop_table("teacher_requisitions")
    op.drop_index("part_time_teachers_active_name", table_name="part_time_teachers")
    op.drop_index("part_time_teachers_folder_id", table_name="part_time_teachers")
    op.drop_constraint("part_time_teachers_folder_id_fkey", "part_time_teachers", type_="foreignkey")
    op.drop_table("part_time_teachers")
    op.drop_index("teacher_folders_parent_id", table_name="teacher_folders")
    op.drop_constraint("teacher_folders_parent_id_fkey", "teacher_folders", type_="foreignkey")
    op.drop_table("teacher_folders")
