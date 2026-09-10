"""The outward rule is "belongs to the cohort but is not in it", not "moved in".

A rule that only noticed a major *changing* into the cohort's missed the student taken
out of the cohort by hand whose record never changed. The rule now names anyone outside
the cohort whose record matches what the cohort expects; the history's change, when
there is one, is a detail on the line.

Revision ID: 0031
Revises: 0030
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE discrepancy_rules SET kind = 'belongs' WHERE kind = 'moved_in'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE discrepancy_rules SET kind = 'moved_in' WHERE kind = 'belongs'"))
