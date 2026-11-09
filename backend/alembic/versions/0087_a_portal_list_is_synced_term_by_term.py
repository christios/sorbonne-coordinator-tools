"""A portal list is synced semester by semester, and says when each was last pulled.

The Portal sync used to ask the portal about one term, fixed in the browser extension. It
now asks about each semester's own term — Semester 1's 262710 and Semester 2's 262720 —
so the courses and registrations a filter holds are pulled, and judged gone, one term at a
time, and the sync's checklist says how old each term's pull is:

    portal_filter_terms     when a filter's list was last pulled for a term, and by whom

Every term a filter already holds courses or registrations in was last pulled when the
filter was.

Revision ID: 0087
Revises: 0086
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0087"
down_revision = "0086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_filter_terms",
        sa.Column("filter_id", sa.Text(), sa.ForeignKey("portal_filters.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column("last_synced_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_synced_by", sa.Text(), nullable=False, server_default=""),
    )
    for members in ("portal_course_members", "portal_registration_members"):
        op.execute(
            f"""INSERT INTO portal_filter_terms (filter_id, term_code, last_synced_at, last_synced_by)
                SELECT DISTINCT m.filter_id, m.term_code, f.last_synced_at, f.last_synced_by
                FROM {members} m JOIN portal_filters f ON f.id = m.filter_id
                WHERE m.term_code <> ''
                ON CONFLICT DO NOTHING"""  # noqa: S608 - a fixed table name
        )


def downgrade() -> None:
    op.drop_table("portal_filter_terms")
