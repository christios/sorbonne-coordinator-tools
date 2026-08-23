"""A view: a named population, its filter fixed when it was created.

The sync used to be one global thing whose filter could be edited, which made "no longer
in the portal" mean whatever the filter happened to say at the time. A view fixes that by
fixing the filter: it is set once, at creation, and every later sync of that view asks the
portal the same question. Wanting a different question means wanting a different view.

Saved searches become views — they were already a name and a filter, and they were only
ever used to look at the portal. Everything held before this migration goes into a view
called "All students", so nothing is lost and the record keeps its history.

The student record stays global: one row per id, carrying the cohort and when we first
saw them. What each view last returned is recorded per view, so two views with different
filters can disagree about a student without either being wrong.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("roster_filters", "student_views")
    op.add_column("student_views", sa.Column("last_synced_at", sa.Text(), nullable=False, server_default=""))

    op.create_table(
        "view_members",
        sa.Column("view_id", sa.Text(), sa.ForeignKey("student_views.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("student_id", sa.Text(), primary_key=True),
        # What this view's last sync found: 'in_portal' or 'not_in_portal'.
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.Column("first_seen_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
    )
    op.create_index("view_members_student", "view_members", ["student_id"])

    # Everything already held becomes a view of its own, so the record survives intact.
    op.execute(
        """
        INSERT INTO student_views (id, name, description, filter, expected_count,
                                   created_at, updated_at, updated_by, last_synced_at)
        SELECT 'all-students', 'All students', 'Everything held before views existed.',
               '{}'::jsonb, 0, now()::text, now()::text, '', ''
        WHERE EXISTS (SELECT 1 FROM students)
        """
    )
    op.execute(
        """
        INSERT INTO view_members (view_id, student_id, status, first_seen_at, last_seen_at)
        SELECT 'all-students', student_id, status, first_seen_at, last_seen_at FROM students
        """
    )

    # The population is no longer a shared setting; only the lock on it survives.
    op.drop_column("sync_settings", "filter")


def downgrade() -> None:
    op.add_column("sync_settings", sa.Column("filter", sa.Text(), nullable=False, server_default="{}"))
    op.drop_index("view_members_student", table_name="view_members")
    op.drop_table("view_members")
    op.drop_column("student_views", "last_synced_at")
    op.rename_table("student_views", "roster_filters")
