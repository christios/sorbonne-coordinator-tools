"""A group set is plain or nested; "independent" was a plain set by another name.

Nothing — the fill, the clashes, the workbook, the cards — ever asked a set more than
whether it sits inside another. A set with one course is shared across its courses with
nothing to share, so the third kind said nothing the count of courses did not.

Revision ID: 0029
Revises: 0028
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE cohort_scopes SET kind = 'shared' WHERE kind = 'independent'"))


def downgrade() -> None:
    # The word is gone for good; a plain set stays plain.
    pass
