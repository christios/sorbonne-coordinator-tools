"""Claude connects to read, as the coordinator who allowed it.

A custom connector in Claude reaches the application the way any OAuth client reaches a
server: it registers itself, sends the coordinator here to allow it, and trades what comes
back for a key it renews on its own. Nobody copies a token, which is the point: the
coordinators who would use it cannot install anything, and should not be asked to keep a
secret.

    oauth_clients       Claude, as it registered itself, with where it may be sent back to
    oauth_codes         the one-use proof that a coordinator allowed it, good for minutes
    connector_grants    one connection per coordinator and Claude: its key and its renewal

Only hashes of the codes and keys are kept.

Revision ID: 0090
Revises: 0089
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        # A JSON list. Only Claude's own callbacks are accepted when a client registers.
        sa.Column("redirect_uris", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
    )
    op.create_table(
        "oauth_codes",
        sa.Column("code_hash", sa.Text(), primary_key=True),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        # PKCE: the code is worth nothing without the verifier this was made from.
        sa.Column("code_challenge", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Text(), nullable=False),
        sa.Column("used_at", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "connector_grants",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("client_name", sa.Text(), nullable=False, server_default=""),
        # Whose it is. Access is read from the staff list per request, not from here.
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("last_used_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("revoked_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("access_expires_at", sa.Text(), nullable=False),
        sa.Column("refresh_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("refresh_expires_at", sa.Text(), nullable=False),
    )
    op.create_index("connector_grants_email", "connector_grants", ["email"])


def downgrade() -> None:
    op.drop_index("connector_grants_email", table_name="connector_grants")
    op.drop_table("connector_grants")
    op.drop_table("oauth_codes")
    op.drop_table("oauth_clients")
