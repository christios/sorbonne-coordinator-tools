"""A programme's official name, and which programme each course belongs to.

The department's programmes are its students' — MATH (Mathematics), PHYS (Physics) —
and the pages that list courses can be narrowed to one: the teaching-load workbook keeps a
Maths and a Physics tab beside its cohort tabs, and a timetable or a list of CRNs is read
one programme at a time just as often. So each programme has the course codes that count
as it, by prefix, and a course whose code says nothing useful can be put in one by hand:

    programme_names             programme "MATH" → its official name, where one is given
    programme_course_prefixes   prefix "CPSC" → programme "MATH", one row a prefix
    course_programs             course "SCEN-102" → programme "MATH", or NONE

A prefix is its row's key, so it counts as one programme at most. The registrar's name for
a programme ("MATH - Mathematics") is not its official one, which the department writes.

The programmes themselves are not kept here: they are the ones the department's groups and
cohorts are written in, with Settings → Programme codes saying which codes are the same.

A department that already teaches MATH or PHYS courses starts with MATH and CPSC under
MATH (the workbook lists Computer Science on its Maths tab) and PHYS under PHYS. A new
department's database, built from nothing, starts with no course under any programme.

Revision ID: 0095
Revises: 0094
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0095"
down_revision = "0094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "programme_names",
        sa.Column("programme", sa.Text(), primary_key=True),
        sa.Column("official_name", sa.Text(), nullable=False),
        sa.Column("set_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("set_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "programme_course_prefixes",
        # How a course code starts, uppercase: "CPSC".
        sa.Column("prefix", sa.Text(), primary_key=True),
        # A programme's code, as the department's groups are written in it: "MATH".
        sa.Column("programme", sa.Text(), nullable=False),
        sa.Column("set_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("set_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "course_programs",
        sa.Column("course_code", sa.Text(), primary_key=True),
        # A programme's code, or NONE.
        sa.Column("programme", sa.Text(), nullable=False),
        sa.Column("set_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("set_by", sa.Text(), nullable=False, server_default=""),
    )
    for prefix, programme in (("MATH", "MATH"), ("CPSC", "MATH"), ("PHYS", "PHYS")):
        op.execute(
            sa.text(
                """INSERT INTO programme_course_prefixes (prefix, programme, set_by)
                   SELECT :prefix, :programme, 'migration 0095'
                   WHERE EXISTS (SELECT 1 FROM active_courses WHERE upper(course_code) LIKE :like)"""
            ).bindparams(prefix=prefix, programme=programme, like=f"{programme}%")
        )


def downgrade() -> None:
    op.drop_table("course_programs")
    op.drop_table("programme_course_prefixes")
    op.drop_table("programme_names")
