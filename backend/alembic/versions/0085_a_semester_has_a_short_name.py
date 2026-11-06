"""A semester has a short name.

"Semester 2 2026-27" is long for a menu that names a semester beside a cohort and a count,
and two semesters of the Hub can carry names nobody chose ("Semester 2", "Semester 2
2026-27"). A coordinator gives each a short name — S1, S2, Summer — which the menus show
as a tag of its own. Coordinator Tools' own record, keyed by the app's semester id like the
term links: the Student Hub's semester is never written to.

Revision ID: 0085
Revises: 0084
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "semester_short_names",
        sa.Column("term_id", sa.Text(), primary_key=True),
        sa.Column("short_name", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("semester_short_names")
