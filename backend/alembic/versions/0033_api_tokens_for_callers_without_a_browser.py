"""Tokens for callers that cannot hold a session cookie.

Everything here is authorised from the Google sign-in cookie, which is right for a
coordinator at a keyboard and impossible for a script: the cookie is HttpOnly, so
nothing outside the browser can read it, and a Google ID token needs a sign-in flow.
A coordinator can now mint a token of their own instead, which carries their identity
and no more than their access — decided from the staff list on every request, as the
cookie's is, so removing somebody from Settings disarms their tokens in the same breath.

Only the hash is kept. The token itself is shown once, when it is made.

Revision ID: 0033
Revises: 0032
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        # sha256 of the token. The token itself is never stored, here or anywhere.
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        # The first characters, so a coordinator can tell their tokens apart in the list.
        sa.Column("prefix", sa.Text(), nullable=False),
        # Whose token it is. Access is read from the staff list per request, not from here.
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_used_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("revoked_at", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("api_tokens_email", "api_tokens", ["email"])


def downgrade() -> None:
    op.drop_index("api_tokens_email", table_name="api_tokens")
    op.drop_table("api_tokens")
