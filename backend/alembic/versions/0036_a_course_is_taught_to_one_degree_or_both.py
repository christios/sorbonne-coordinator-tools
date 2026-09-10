"""Whether a course is mutualized: taught to the mathematicians and the physicists at once.

Licence 2 and Licence 3 are one cohort reading two degrees. Some of their courses are
taught to both together — mutualized, as the timetabler's workbook calls it in its
remarks — and some are one degree's alone. Nothing recorded which, so the answer lived in
people's heads and in comments on individual rows.

It belongs to the course, not to a section: it is the same fact wherever the course is
taught. Unsaid is a state of its own, because most courses have never been asked.

Revision ID: 0036
Revises: 0035
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_courses",
        sa.Column("mutualized", sa.String(length=10), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("active_courses", "mutualized")
