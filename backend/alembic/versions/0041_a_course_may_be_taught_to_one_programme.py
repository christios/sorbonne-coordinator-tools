"""A course may be taught to one programme of the cohort rather than to all of it.

The matrix assumes every group of a set teaches every course of that set. In Foundation
Year and L1 that is exactly right — the groups are numbered 1, 2, 3 and all take the same
courses, so a blank cell there really is a section nobody has a CRN for yet.

In L2 and L3 the group IS the programme. One CM set carries the Maths courses and the
Physics courses, and holds a group called "Mathematics" and one called "Physics". The
matrix duly asks the Physics group for a CRN in MATH-330. Counted on production the day
this was added: 25 such cells in L2-S1 and 20 in L3-S1, and every one of the 45 sections
those pages reported as "without a CRN" was one of them. Not one was real.

`scope_groups.program` already exists — the fill uses it to seat a student in the group of
their own programme, matched against the registrar's MAJOR_CODE_DESC. This is its other
half, in the same vocabulary: a course says which programme it is for, and a cell is
expected only where the two agree. Blank on either side means "everyone", so every set
that does not use this behaves exactly as it did.

Revision ID: 0041
Revises: 0040
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scope_courses", sa.Column("program", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("scope_courses", "program")
