"""Who writes the course learning outcomes: each course's teachers, or the Head of Department.

The November 2026 review asked for one department-wide switch:

    teacher   a syllabus writes its own CLOs and aligns them to the PLOs the curriculum
              mapping expects of the course (what the builder has always done)
    hod       the CLOs and their alignment are written once per course in the catalogue's
              curriculum mapping, and every syllabus of the course shows them read-only

One row, set by an administrator of the syllabus builder. Nothing is set until someone
chooses, and reading nothing means "teacher".

Revision ID: 0092
Revises: 0091
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0092"
down_revision = "0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "syllabus_outcome_mode",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("id = 1", name="syllabus_outcome_mode_one_row"),
        sa.CheckConstraint("mode IN ('teacher', 'hod')", name="syllabus_outcome_mode_known"),
    )


def downgrade() -> None:
    op.drop_table("syllabus_outcome_mode")
