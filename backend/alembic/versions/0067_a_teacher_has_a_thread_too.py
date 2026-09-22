"""A teacher has a thread too.

A student's record has carried comments for a year: a line somebody wrote, signed and
dated, so a judgement made once is not made again by the next person to look. The hours
page needs the same thing for the same reason — a warning about a teacher's hours is
answered by a sentence ("she swapped with Grace for the term"), and without somewhere to
write it the answer lives in one person's memory.

The same shape as `student_comments`, deliberately: one row per line, oldest first, the
author's own to delete and nobody else's. It is a separate table rather than a shared one
because a comment belongs to a record, and a table that has to say which kind of record
is a table that will one day be asked for a student's comments and answer with a
teacher's.

Revision ID: 0067
Revises: 0066
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_comments",
        sa.Column("id", sa.Text(), primary_key=True),
        #: The part-time teacher, or the Active teacher where there is no part-time record.
        sa.Column("teacher_id", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
    )
    op.create_index("teacher_comments_teacher", "teacher_comments", ["teacher_id", "created_at"])


def downgrade() -> None:
    op.drop_index("teacher_comments_teacher", table_name="teacher_comments")
    op.drop_table("teacher_comments")
