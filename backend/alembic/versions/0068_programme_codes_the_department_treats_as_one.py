"""Programme codes the department treats as one.

A student's programme is matched on its code — "MATH" in "MATH - Mathematics" — to decide
which group rows they may sit on, what a cohort expects of them, and which classes can
share students. On 24 September 2026 admissions recoded L2's Mathematics to "MATS - MAth",
and every L2 mathematician stopped matching the rows they already sat on.

One row here says it once for everybody: MATS means MATH. It is data an administrator
keeps in Settings, not a rule written into the application, and it applies everywhere a
programme code is compared.

Revision ID: 0068
Revises: 0067
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "programme_codes",
        # The code as the portal now writes it, uppercase: "MATS".
        sa.Column("code", sa.Text(), primary_key=True),
        # The code it means, which is the one everything else was written in: "MATH".
        sa.Column("same_as", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("programme_codes")
