"""Each class of the registrar's timetable keeps the teacher the registrar names on it.

The registrar names a teacher on every dated class, not on the section, and a hand-over
leaves the two halves naming different people: Maths Readiness G.3 and G.6 named Sachin
Valera on their September classes and Ahmed Menaa on the ones after. The extension kept
one name per section — whichever class the registrar happened to list first — so a sync
could name either of them, and the warning that compares the portal with our planning came
and went between syncs while nothing had changed.

The name is kept per class now. Blank for every class stored before this, and for any sync
made with an extension that does not send it.

Revision ID: 0077
Revises: 0076
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("facility_meetings", sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("facility_meetings", "teacher_name")
