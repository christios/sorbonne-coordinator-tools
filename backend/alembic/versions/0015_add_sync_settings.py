"""What the roster's sync pulls, decided once and shared by every coordinator.

The Students page is fed by one thing: the sync. These settings say which population the
sync asks the portal for, so "who is still a student" has a single agreed definition
rather than depending on whichever search the coordinator happened to have selected.

Saved searches keep existing, but they are for *looking* at portal data — they never feed
the record.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_settings",
        # One row, always. The id exists so the row can be upserted without a race.
        sa.Column("id", sa.Text(), primary_key=True),
        # Portal field codes only, the same shape a saved search holds.
        sa.Column("filter", JSONB(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.execute("INSERT INTO sync_settings (id, filter) VALUES ('default', '{}'::jsonb)")


def downgrade() -> None:
    op.drop_table("sync_settings")
