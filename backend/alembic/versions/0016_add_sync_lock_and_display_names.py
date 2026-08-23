"""A lock on the sync settings, and a name for each coordinator.

The sync settings decide who counts as a student, so changing them is not an everyday
edit. An administrator can set a passphrase on them; after that a save needs either an
administrator or that passphrase.

`display_name` is separate from `name` because `name` is whatever Google last said at
sign-in and is overwritten every time somebody signs in. A name an administrator sets has
to survive that, so it lives in its own column and wins when both are present.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Salted PBKDF2, never the passphrase itself. Empty means the settings are unlocked.
    op.add_column("sync_settings", sa.Column("passphrase", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "coordinator_accounts", sa.Column("display_name", sa.Text(), nullable=False, server_default="")
    )


def downgrade() -> None:
    op.drop_column("coordinator_accounts", "display_name")
    op.drop_column("sync_settings", "passphrase")
