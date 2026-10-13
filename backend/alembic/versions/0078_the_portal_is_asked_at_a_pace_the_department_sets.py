"""How far apart the registrar's timetable is asked about, set by the department.

A sync asks the registrar's timetable about one section at a time, and the gap between two
sections was written into the page: a second, since the morning of 29 September 2026 when
the registrar's system was in trouble while a sync asked it about 167 sections in nine
seconds. The portal was reported out again on 12 October, and how hard it is asked is now
the department's call rather than the code's — kept here, once, so the sync of whoever
presses the button goes at the pace that was agreed, not at the pace of their browser.

No row is the default (four seconds).

Revision ID: 0078
Revises: 0077
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_pace",
        # One row per kind of request that is paced; only "timetable" so far.
        sa.Column("step", sa.Text(), primary_key=True),
        sa.Column("seconds_apart", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("portal_pace")
