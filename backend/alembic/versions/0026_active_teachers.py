"""The department's active teachers: chosen from the portal, or brought from the part-time database.

The portal lists every teacher the university has ever paid; the department deals with a
few dozen. Active teachers is that list — a person the coordinator has chosen from the
portal's staff list, or added from the part-time teacher database, or both when the two
turn out to be one person. The link column on the portal teacher goes: the relationship
belongs to the active record, not to the portal's row.

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "active_teachers",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("portal_teacher_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("part_time_teacher_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("email", sa.Text(), nullable=False, server_default=""),
        sa.Column("added_at", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("active_teachers_portal", "active_teachers", ["portal_teacher_id"])
    op.create_index("active_teachers_part_time", "active_teachers", ["part_time_teacher_id"])
    op.drop_column("portal_teachers", "part_time_teacher_id")


def downgrade() -> None:
    op.add_column("portal_teachers", sa.Column("part_time_teacher_id", sa.Text(), nullable=False, server_default=""))
    op.drop_table("active_teachers")
