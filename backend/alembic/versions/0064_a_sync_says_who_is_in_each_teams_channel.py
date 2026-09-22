"""What the Teams roster sync last saw, so a cohort can say who is missing from its channel.

A cohort knows who belongs to it. Teams knows who is in a channel. Until now nothing held
both, so a student placed in a cohort could sit outside its channel indefinitely and the
only way to notice was to look.

The roster sync posts what it read on every run — the channels and the addresses listed
for each — and a cohort that names its channel can be compared against it. What is kept is
only what the sync saw, never a live connection to Teams: this application still talks to
nothing outside itself, and a stale answer says when it was taken.

Runs are small and occasional, so every one is kept rather than only the latest. When the
warning is wrong, the history is how you tell whether the roster changed or the cohort did.

Revision ID: 0064
Revises: 0063
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_roster_syncs",
        sa.Column("id", sa.Text(), primary_key=True),
        # When the sync ran, as it reported it, and who set it going.
        sa.Column("synced_at", sa.Text(), nullable=False),
        sa.Column("synced_by", sa.Text(), nullable=False, server_default=""),
        # "live" or "dry run", because a rehearsal's roster is still the truth about Teams
        # even though it changed nothing.
        sa.Column("mode", sa.Text(), nullable=False, server_default=""),
        # {"L1 Students": ["a00026871@sorbonne.ae", ...]} — what the sheet listed per channel.
        sa.Column("channels", sa.Text(), nullable=False, server_default="{}"),
        # Whatever the run could not do, kept so a missing student can be explained.
        sa.Column("problems", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("received_at", sa.Text(), nullable=False),
    )
    op.create_index("team_roster_syncs_received", "team_roster_syncs", ["received_at"])

    # Empty means "this cohort has no channel", which is every cohort until somebody says
    # otherwise — so nothing starts warning on its own.
    op.add_column(
        "student_cohorts",
        sa.Column("teams_channel", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("student_cohorts", "teams_channel")
    op.drop_index("team_roster_syncs_received", table_name="team_roster_syncs")
    op.drop_table("team_roster_syncs")
