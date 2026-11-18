"""A course has its hours, its lead and its weeks, semester by semester.

One plan per course per semester, shared by every cohort that takes it:

    course_plans    a course in a portal term (262720): its CM, TD and TP hours (TD and TP
                    per group) and the length of one session of each, which coordinators
                    set; the teacher who leads it, whom coordinators pick; and how many
                    sessions of each fall in each teaching week, which the lead lays out —
                    with a note, where they may contest a total.

Groups & CRNs rows keep their own hours, which Teaching loads and requisitions go on reading.

Revision ID: 0101
Revises: 0100
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_plans",
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column(
            "course_code",
            sa.Text(),
            sa.ForeignKey("active_courses.course_code", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Hours in the semester (CM for the course, TD and TP for each group), and the length
        # of one session in hours. Null while nobody has said.
        sa.Column("cm_hours", sa.Float(), nullable=True),
        sa.Column("td_hours", sa.Float(), nullable=True),
        sa.Column("tp_hours", sa.Float(), nullable=True),
        sa.Column("cm_length", sa.Float(), nullable=True),
        sa.Column("td_length", sa.Float(), nullable=True),
        sa.Column("tp_length", sa.Float(), nullable=True),
        sa.Column("hours_updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("hours_updated_by", sa.Text(), nullable=False, server_default=""),
        # The lead's Active teachers record; "" while nobody has been picked.
        sa.Column("lead_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("lead_set_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("lead_set_by", sa.Text(), nullable=False, server_default=""),
        # {"CM": {"1": 1, "2": 1}, "TD": {...}}: sessions per teaching week, weeks with none left out.
        sa.Column("weeks", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        # When the weeks were last laid out, by whom, and how: "lead" through their invitation,
        # or "coordinator" for them. Empty until they first are.
        sa.Column("answered_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("answered_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("answer_source", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("course_plans_lead", "course_plans", ["term_code", "lead_id"])


def downgrade() -> None:
    op.drop_table("course_plans")
