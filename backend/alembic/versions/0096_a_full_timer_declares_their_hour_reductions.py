"""A full-time teacher's hour reductions ("décharges"), year by year.

A full-timer owes 192 hours of teaching a year, and research and responsibilities buy some of
it back. The department kept them in a table by hand, a column per kind: research through
SAFIR (PhD students, master's interns, a project, an HDR, an IRG project, internships), which
the teacher declares and the Head of Department checks with SAFIR; and the department's own
(committees, heading a programme or the department, joining, accreditation, a pedagogical
innovation project), which the Head of Department sets. A full-timer now declares theirs as
the first step of the timetable preferences request.

    hour_reductions         one kind for one teacher in one academic year: how many, or which
    hour_reduction_years    when the teacher last went through their declaration that year
    hour_reduction_rules    an administrator's figures where they differ from the department's rules

The hours are worked out from the rules when read, so a figure changed in the rules changes
every total at once.

Revision ID: 0096
Revises: 0095
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hour_reductions",
        # "2026-2027", as the pay rates write a year.
        sa.Column("academic_year", sa.Text(), primary_key=True),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.Text(), primary_key=True),
        # Students, hours, or 1 for a yes: what the kind's rule counts.
        sa.Column("amount", sa.Numeric(), nullable=False, server_default="0"),
        # Which committees, or which headship: what a kind chosen from a list chose.
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        # declared (by the teacher, SAFIR to confirm), validated (checked with SAFIR), or set (the HoD's own).
        sa.Column("state", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("validated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("validated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "hour_reduction_years",
        sa.Column("academic_year", sa.Text(), primary_key=True),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("declared_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("declared_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "hour_reduction_rules",
        sa.Column("kind", sa.Text(), primary_key=True),
        # A JSON object of the figures that differ: {"per": 5, "cap": 20}, {"options": {...}}.
        sa.Column("figures", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("hour_reduction_rules")
    op.drop_table("hour_reduction_years")
    op.drop_table("hour_reductions")
