"""A student can carry a thread of comments.

What a coordinator knows about a student — "spoke to her on Tuesday; the registrar says
the transfer lands next week" — lived in their head, in e-mails and on paper, and the next
person to open the record knew none of it. This is the place for it: on the server, so
every coordinator reads the same thread, each line signed by whoever wrote it and dated.

No student name is stored, as nowhere on the server. The text is the coordinator's own and
says what it likes; the student is the id. No foreign key to `students`, like the
exemptions: a comment may be written about somebody the portal has since dropped, and it
should not vanish with them.

Revision ID: 0044
Revises: 0043
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_comments",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
    )
    op.create_index("student_comments_student", "student_comments", ["student_id", "created_at"])


def downgrade() -> None:
    op.drop_index("student_comments_student", table_name="student_comments")
    op.drop_table("student_comments")
