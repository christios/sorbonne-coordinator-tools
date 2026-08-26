"""Add shared field notes and scoped task templates.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-21
"""

from alembic import op
import sqlalchemy as sa


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "field_notes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("field_key", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("resource_type", "resource_id", "field_key", name="field_notes_resource_field"),
    )
    op.create_index("field_notes_resource", "field_notes", ["resource_type", "resource_id"])

    op.create_table(
        "task_templates",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_table(
        "task_template_items",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("template_id", sa.Text(), sa.ForeignKey("task_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("template_item_id", sa.Text(), sa.ForeignKey("task_template_items.id", ondelete="SET NULL")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("due_date", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.Text()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("tasks_resource", "tasks", ["resource_type", "resource_id", "status", "due_date"])

    now = "2026-08-21T00:00:00+00:00"
    op.execute(
        sa.text(
            """
            INSERT INTO task_templates (id, resource_type, title, created_at, updated_at)
            VALUES ('teacher-onboarding', 'teacher', 'Teacher onboarding', :now, :now)
            """
        ).bindparams(now=now)
    )
    task_items = sa.table(
        "task_template_items",
        sa.column("id", sa.Text()),
        sa.column("template_id", sa.Text()),
        sa.column("title", sa.Text()),
        sa.column("position", sa.Integer()),
    )
    op.bulk_insert(
        task_items,
        [
            {
                "id": "teacher-onboarding-cid-clearance",
                "template_id": "teacher-onboarding",
                "title": "CID Clearance",
                "position": 1,
            },
            {
                "id": "teacher-onboarding-requisition-signature",
                "template_id": "teacher-onboarding",
                "title": "Requisition signature",
                "position": 2,
            },
            {
                "id": "teacher-onboarding-id-issuance",
                "template_id": "teacher-onboarding",
                "title": "ID Issuance (for newcomers)",
                "position": 3,
            },
        ],
    )


def downgrade() -> None:
    op.drop_index("tasks_resource", table_name="tasks")
    op.drop_table("tasks")
    op.drop_table("task_template_items")
    op.drop_table("task_templates")
    op.drop_index("field_notes_resource", table_name="field_notes")
    op.drop_table("field_notes")
