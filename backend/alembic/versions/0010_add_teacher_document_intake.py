"""Persist managed Google Drive folders and document-intake review issues.

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_document_folders",
        sa.Column(
            "teacher_id", sa.Text(), sa.ForeignKey("part_time_teachers.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("drive_folder_id", sa.Text(), nullable=False),
        sa.Column("drive_folder_url", sa.Text(), nullable=False),
        sa.Column("response_fingerprint", sa.Text(), nullable=False),
        sa.Column("response_timestamp", sa.Text(), nullable=False),
        sa.Column("synced_at", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_table(
        "teacher_document_intake_issues",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("source_email", sa.Text(), nullable=False),
        sa.Column("source_timestamp", sa.Text(), nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="OPEN"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("source_fingerprint", "reason", name="teacher_document_intake_issue_source_reason"),
    )
    op.create_index("teacher_document_intake_issues_open", "teacher_document_intake_issues", ["status", "updated_at"])


def downgrade() -> None:
    op.drop_index("teacher_document_intake_issues_open", table_name="teacher_document_intake_issues")
    op.drop_table("teacher_document_intake_issues")
    op.drop_table("teacher_document_folders")
