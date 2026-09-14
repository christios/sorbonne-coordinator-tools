"""A session can be cancelled, or covered by another teacher.

The registrar's timetable says when a class is booked; it does not say that the Tuesday
lecture was cancelled, or that somebody stood in for the professor who was ill. Those are
facts about one dated meeting, known to the coordinator and to nobody's database, and they
matter for the hours a teacher is paid for. This is where they live: one row per slot,
keyed by term, CRN, date and start, so a later sweep that moves the meeting leaves the
note behind rather than silently attached to a different hour.

No student data. A teacher's name is the department's own to write, as on every section.

Revision ID: 0045
Revises: 0044
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_changes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("meets_on", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("cover_teacher_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("cover_teacher_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("term_code", "crn", "meets_on", "starts_at", name="session_changes_slot"),
    )
    op.create_index("session_changes_term", "session_changes", ["term_code", "crn"])


def downgrade() -> None:
    op.drop_index("session_changes_term", table_name="session_changes")
    op.drop_table("session_changes")
