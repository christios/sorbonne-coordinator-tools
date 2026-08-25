"""Move tasks to a binary lifecycle and add descriptions, activity, and quick templates.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-21

Additive by design. Existing completed tasks keep their ``completed_at`` timestamp;
only the removed ``IN_PROGRESS`` stage is converted, and existing completions are
backfilled into the new activity table from the timestamp already on the row.

``task_activity`` stores only the events that are not otherwise recoverable
(``COMPLETED`` / ``REOPENED``). The creation entry is derived from ``tasks.created_at``
so that every creation path — including teacher onboarding bundles written by
``teacher_store`` — reports a complete history without extra bookkeeping.
"""

from alembic import op
import sqlalchemy as sa


revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("description", sa.Text()))

    # The lifecycle is now Not started / Completed. Completed rows are untouched.
    op.execute("UPDATE tasks SET status = 'NOT_STARTED' WHERE status = 'IN_PROGRESS'")

    op.create_table(
        "task_activity",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("task_id", sa.Text(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.Text(), nullable=False),
    )
    op.create_index("task_activity_task", "task_activity", ["task_id", "occurred_at"])

    op.create_table(
        "task_quick_templates",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("task_quick_templates_resource", "task_quick_templates", ["resource_type", "title"])

    # Backfill completions for tasks that already exist, so the activity view is not
    # empty for work recorded before this migration. Creation is not stored: it is
    # derived from tasks.created_at, which is authoritative for every creation path.
    op.execute(
        """
        INSERT INTO task_activity (id, task_id, kind, occurred_at)
        SELECT id || '-completed', id, 'COMPLETED', completed_at
        FROM tasks WHERE completed_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("task_quick_templates_resource", table_name="task_quick_templates")
    op.drop_table("task_quick_templates")
    op.drop_index("task_activity_task", table_name="task_activity")
    op.drop_table("task_activity")
    op.drop_column("tasks", "description")
