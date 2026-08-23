"""Defining a view is an administrator's decision, not a passphrase's.

A view's filter is fixed when it is made, so creating or deleting one settles what a
population *is* — and the passphrase that used to guard that was a second, weaker copy of
a permission the staff list already answers. There is one notion of "may decide" here now:
being an administrator.

That leaves `sync_settings` holding nothing. 0017 took its filter away when a view became
the thing that carries a filter; this takes the passphrase, which was all that was left.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("sync_settings")


def downgrade() -> None:
    # Back to an unlocked table: the hashes cannot come back, and an empty passphrase is
    # what "anybody may define a view" looked like before.
    op.create_table(
        "sync_settings",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("passphrase", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.execute("INSERT INTO sync_settings (id) VALUES ('default')")
