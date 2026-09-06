"""What a course asks of the timetable, said once instead of on every section of it.

A set's course row — MATH001's TD row in Foundation Year, Semester 1 — can now carry the
same request a section carries: total hours, expected students, weeks and sessions, room,
day and time preferences, constraints and comments. Six tutorial groups of one course ask
for the same thing six times, and it was typed six times.

Per set rather than per course, because a lecture is twenty-four hours and a tutorial is
thirty-six, and per cohort and semester, because next year's answer is next year's: all
three of those are what a `scope_courses` row already is.

Nothing inherits at rest. A section keeps whatever it says, blank included, and the two
are shown apart; it is the workbook written for the timetabler that fills a section's
silence with what its course asked for.

Revision ID: 0037
Revises: 0036
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None

TEXT_FIELDS = (
    "teacher_id",
    "hours",
    "sessions_per_week",
    "duration",
    "weeks",
    "room_pref",
    "day_pref",
    "time_pref",
    "constraints",
    "comments",
)


def upgrade() -> None:
    for name in TEXT_FIELDS:
        op.add_column("scope_courses", sa.Column(name, sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_courses", sa.Column("anticipated", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("scope_courses", "anticipated")
    for name in TEXT_FIELDS:
        op.drop_column("scope_courses", name)
