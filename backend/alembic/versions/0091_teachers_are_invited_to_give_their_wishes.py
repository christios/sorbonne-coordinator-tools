"""A teacher can be invited to give their timetable wishes themselves.

    wish_invitations   one teacher's invitation for one semester: the Google address they
                       sign in with, a link whose code is kept only as a hash, who sent it
                       and when, and when it was first opened, last signed in with, or
                       withdrawn. Inviting again withdraws the one before.
    wish_reopenings    a teacher whose answer may still be changed after the deadline, and
                       until when: the coordinator reopens it for one person, not for all.

Teachers answer for themselves until the collection's deadline; coordinators may always
answer for them.

Revision ID: 0091
Revises: 0090
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0091"
down_revision = "0090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wish_invitations",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("opened_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("signed_in_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("withdrawn_at", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("wish_invitations_by_teacher", "wish_invitations", ["term_code", "teacher_id"])
    op.create_table(
        "wish_reopenings",
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column(
            "teacher_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("until", sa.Text(), nullable=False),
        sa.Column("reopened_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("reopened_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("wish_reopenings")
    op.drop_index("wish_invitations_by_teacher", table_name="wish_invitations")
    op.drop_table("wish_invitations")
