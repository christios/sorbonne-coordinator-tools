"""A cohort belongs in several Teams channels, not one.

Every student is in "SCEN Students" as well as their year's channel, so a cohort that could
name one channel could only be held against half of where its students belong. The column
becomes a list, as `allowed_codes` is; a channel already named is carried over as the first
of it.

Revision ID: 0072
Revises: 0071
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ["L2 Students", "SCEN Students"] — by display name, as the roster sync reports them.
    op.add_column("student_cohorts", sa.Column("teams_channels", sa.Text(), nullable=False, server_default="[]"))
    op.execute(
        "UPDATE student_cohorts SET teams_channels = json_build_array(teams_channel)::text "
        "WHERE btrim(teams_channel) <> ''"
    )
    op.drop_column("student_cohorts", "teams_channel")


def downgrade() -> None:
    # Only the first survives: the old column held one.
    op.add_column("student_cohorts", sa.Column("teams_channel", sa.Text(), nullable=False, server_default=""))
    op.execute("UPDATE student_cohorts SET teams_channel = coalesce(teams_channels::json ->> 0, '')")
    op.drop_column("student_cohorts", "teams_channels")
