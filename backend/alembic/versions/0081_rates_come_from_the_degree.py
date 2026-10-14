"""A part-timer is paid by their highest degree, at the department's rates for the year.

The rates were three figures typed on each profile — TD/TP, CM, other work — which is a
table the department already has, copied by hand into twenty-five places. They are one
table now, per academic year, by degree (PhD, Masters, Bachelors) and by kind of work; a
profile says only the teacher's highest degree. A kind a degree is not paid for (a
Bachelors does not give lectures) has no rate in the table.

The figures themselves are entered in Settings, not here: the three columns this drops held
one rate, on one profile.

Revision ID: 0081
Revises: 0080
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # "phd", "masters" or "bachelors"; "" until somebody says.
    op.add_column("part_time_teachers", sa.Column("highest_degree", sa.Text(), nullable=False, server_default=""))
    op.drop_column("part_time_teachers", "other_hourly_rate")
    op.drop_column("part_time_teachers", "cm_hourly_rate")
    op.drop_column("part_time_teachers", "hourly_rate")
    op.create_table(
        "pay_rates",
        sa.Column("academic_year", sa.Text(), primary_key=True),
        sa.Column("degree", sa.Text(), primary_key=True),
        # The Part Time Sheet it pays: "CM", "TD-TP" or "OTHER".
        sa.Column("sheet", sa.Text(), primary_key=True),
        sa.Column("rate", sa.Numeric(10, 2), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("pay_rates")
    op.add_column("part_time_teachers", sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=True))
    op.add_column("part_time_teachers", sa.Column("cm_hourly_rate", sa.Numeric(10, 2), nullable=True))
    op.add_column("part_time_teachers", sa.Column("other_hourly_rate", sa.Numeric(10, 2), nullable=True))
    op.drop_column("part_time_teachers", "highest_degree")
