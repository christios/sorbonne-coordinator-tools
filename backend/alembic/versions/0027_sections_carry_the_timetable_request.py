"""Sections carry the timetable request; group sets know their kind.

A block was a matrix: groups down the side, courses across the top, a CRN in each cell.
The cell is what the timetabler's workbook has a row for — a section — and the workbook
says more about it than a CRN: who teaches it, how many hours, how many sessions a week,
how long, which weeks, how many students to expect, and what the department asks of the
timetable. Those move onto the cell, so the workbook can be written from here.

A block becomes a group set with a kind: shared across the courses whose sections use
its numbering, independent, or nested inside another set (a TP half within a TD group).
A course learns its Sorbonne UE and the parent CRN the sections hang from.

Revision ID: 0027
Revises: 0026
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cohort_scopes", sa.Column("kind", sa.Text(), nullable=False, server_default="shared"))
    op.add_column("cohort_scopes", sa.Column("parent_scope_id", sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_groups", sa.Column("parent_group_id", sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_courses", sa.Column("ue", sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_courses", sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""))
    for name in (
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
    ):
        op.add_column("group_crns", sa.Column(name, sa.Text(), nullable=False, server_default=""))
    op.add_column("group_crns", sa.Column("anticipated", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("group_crns", sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    for name in (
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
        "anticipated",
        "retired",
    ):
        op.drop_column("group_crns", name)
    op.drop_column("scope_courses", "parent_crn")
    op.drop_column("scope_courses", "ue")
    op.drop_column("scope_groups", "parent_group_id")
    op.drop_column("cohort_scopes", "parent_scope_id")
    op.drop_column("cohort_scopes", "kind")
