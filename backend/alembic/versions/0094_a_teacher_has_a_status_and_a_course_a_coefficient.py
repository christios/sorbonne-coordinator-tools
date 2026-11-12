"""A teacher has a status for the budget, and a course a coefficient.

The department's teaching-load workbook splits every cohort's hours between full-timers,
part-timers, visiting professors and PhD students or postdocs, and lists each course with
its coefficient. Teacher hours now draws that sheet, so both are kept here:

    active_teachers.staff_status   FT · PT · VP · PHD, or blank to go by the portal's type
    active_courses.coefficient     the course's coefficient, as the department writes it

The portal's own type is right for most and wrong for some — a PhD student it lists as
full time, a part-timer it calls a local-professional assignment — so the status is the
department's word where it has given one, and the portal's where it has not.

Revision ID: 0094
Revises: 0093
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0094"
down_revision = "0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_teachers", sa.Column("staff_status", sa.Text(), nullable=False, server_default=""))
    op.add_column("active_courses", sa.Column("coefficient", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("active_courses", "coefficient")
    op.drop_column("active_teachers", "staff_status")
