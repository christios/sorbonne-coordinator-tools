"""Teachers say, once a semester, when they can and cannot teach and what matters most.

    wish_collections   a semester's call for wishes: its deadline, its message, the week the
                       grid shows, how many wishes may be a Must, and how much can't-teach
                       time a teacher may claim before having to say why
    teacher_wishes     one teacher's answer for one semester: the week painted can't / prefer,
                       limits on their week, dates away, room needs, a note, which of the
                       wishes are a Must, and a comment on any of them

Both are keyed by the semester's portal term (262720), like the active lists, and a teacher by
their Active teachers record.

A class on the Semester plan learns who teaches it by that record, not only by name, so a
teacher's wishes can follow their classes:

    plan_sections.teacher_id

And a semester has periods that bind everybody, beside its holidays — Ramadan, when classes
end early — each its dates, the weekdays it covers and the hours with no classes:

    plan_terms.periods

Revision ID: 0089
Revises: 0088
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wish_collections",
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column("deadline", sa.Text(), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("days", sa.Text(), nullable=False, server_default="[1, 2, 3, 4, 5]"),
        sa.Column("first_hour", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("last_hour", sa.Integer(), nullable=False, server_default="19"),
        sa.Column("must_quota", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("cant_cap", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("opened_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("opened_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "teacher_wishes",
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column(
            "teacher_id",
            sa.Text(),
            sa.ForeignKey("active_teachers.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("cells", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("limits", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("away", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("needs", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("levels", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("comments", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("over_cap_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.Text(), nullable=False, server_default="coordinator"),
        sa.Column("submitted_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column("plan_sections", sa.Column("teacher_id", sa.Text(), nullable=False, server_default=""))
    op.add_column("plan_terms", sa.Column("periods", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("plan_terms", "periods")
    op.drop_column("plan_sections", "teacher_id")
    op.drop_table("teacher_wishes")
    op.drop_table("wish_collections")
