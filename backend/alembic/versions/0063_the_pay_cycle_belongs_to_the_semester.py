"""The pay cycle is a fact of the semester, not a constant in a file.

The department pays part-time teaching in periods that run from the 15th of one month to
the 14th of the next — which is why five of the nine time sheets filed for 2026-27 are
called "AugSept": they are one period, not two months. That day was written once, in the
browser, as a number nobody could change without a release.

It is not a law of nature. A semester can be paid on a different cycle, and the one that
decides is the semester. So the day lives here, per semester, and a semester nobody has
said anything about goes on being paid from the 15th exactly as before.

Only the day is kept. The rest — when a period ends, what it is called, which one a date
falls in — is derived from it, so a cycle can change without anything stored having to be
rewritten.

Revision ID: 0063
Revises: 0062
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "term_pay_cycles",
        sa.Column("term_id", sa.Text(), primary_key=True),
        #: The day of the month a period opens on. 1-28, so every month has one.
        sa.Column("opens_on", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("opens_on BETWEEN 1 AND 28", name="term_pay_cycles_opens_on_in_month"),
    )


def downgrade() -> None:
    op.drop_table("term_pay_cycles")
