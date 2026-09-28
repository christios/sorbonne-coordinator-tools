"""The rooms, and how many each seats.

A class booked into a room too small for it was found on the first day, by the students
standing at the back. The registrar's timetable names a room and nothing about it; the
department holds the seats — the estates office's list after the Summer 2026 works —
and the timetable, the CRN record and the Capacity page hold each class against them.

A room is kept under the code the department writes ("5.101/5.103"), with whatever else
the portal calls it ("B4.Robert" for the Roberto Sorbonne amphitheatre); the portal's own
shorthand for a pair ("5.101/.103") is matched without being listed.

Revision ID: 0073
Revises: 0072
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rooms",
        sa.Column("id", sa.Text(), primary_key=True),
        # "5.101/5.103", "4.021", "Roberto Sorbonne".
        sa.Column("code", sa.Text(), nullable=False),
        # The longer name, where it has one: "Roberto Sorbonne (01.G0.13)".
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("building", sa.Text(), nullable=False, server_default=""),
        # Classroom, PC Lab, Amphi Theatre — as the estates office writes it.
        sa.Column("kind", sa.Text(), nullable=False, server_default=""),
        # Empty where nobody has said: a lab with no figure is not a lab with no seats.
        sa.Column("seats", sa.Integer(), nullable=True),
        # ["B4.Robert"]: other names the portal's timetable uses for it.
        sa.Column("aliases", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("rooms_code", "rooms", [sa.text("lower(code)")], unique=True)


def downgrade() -> None:
    op.drop_index("rooms_code", table_name="rooms")
    op.drop_table("rooms")
