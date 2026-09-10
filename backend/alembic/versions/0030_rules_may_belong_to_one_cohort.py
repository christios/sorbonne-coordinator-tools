"""A rule may belong to one cohort, and may say "moved into the cohort's majors".

The rules were one list for every cohort. A cohort has its own worries — the Foundation
Year cares about the placement test's readiness groups, L1 about the major — so a rule
now says which cohort it is for, or every cohort. And the students who moved into a
cohort's majors from outside it were listed by the page on its own account, which is
not how anything else is judged; that is now a kind of rule like the others.

Revision ID: 0030
Revises: 0029
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Empty means every cohort, which is what every existing rule was.
    op.add_column("discrepancy_rules", sa.Column("cohort_id", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("discrepancy_rules", "cohort_id")
