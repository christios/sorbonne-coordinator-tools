"""A plan's classes come from Groups & CRNs.

The classes to place were a list of their own, loaded from the timetabling team's workbook.
They are now what Groups & CRNs says the semester has: every group of a set, for each course
the set carries, with its CRN, teacher and hours. The plan reads them afresh each time it is
opened, so a group added there is a class to place here, and a CRN entered there is the
class's CRN here.

    cells     the Groups & CRNs cells the class is, as JSON: ["<group>|<course>|<major>|<part>"].
              A class is matched to its cells, not to its CRN, so it keeps its place on the
              calendar when its CRN is entered or corrected.
    places    where the class sits there, as JSON: the cohort, set and group of each cell, with
              the set's nesting and the group's parents — what tells which classes share students.
    duration  how long one session lasts, as Groups & CRNs says it: "1.5".
    gone_at   when a class placed on the calendar stopped being on Groups & CRNs. It stays until
              somebody takes it off, so a placement is never lost without being seen.

Revision ID: 0083
Revises: 0082
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_sections", sa.Column("cells", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("plan_sections", sa.Column("places", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("plan_sections", sa.Column("duration", sa.Text(), nullable=False, server_default=""))
    op.add_column("plan_sections", sa.Column("gone_at", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    for column in ("gone_at", "duration", "places", "cells"):
        op.drop_column("plan_sections", column)
