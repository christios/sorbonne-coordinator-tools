"""A class the registrar removed can be linked to the one that replaced it, and either noted.

The registrar's meetings carry no identity from one sweep to the next, so a class moved from
Tuesday to Thursday arrives as two facts: a Tuesday gone and a Thursday arrived. Saying
they are one class rescheduled is a coordinator's call — the sweep never makes it — and it
is kept here, signed, so every page that draws the Thursday can say where it came from.

A link and a note are both kept by the classes' own slots (section, day, start and end),
not by the change rows a sweep writes: one slot can be written by several sweeps, and a
link tied to one of them would be lost the moment another touched the slot. The end time is
part of the slot because a class whose end alone moved is logged as removed and added on
the same start, and that is not a reschedule into itself.

One gone class to one arrived class: a class rescheduled into two is two classes, and the
second has a note of its own.

Revision ID: 0082
Revises: 0081
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "class_change_links",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        # The class that went.
        sa.Column("from_on", sa.Text(), nullable=False),
        sa.Column("from_start", sa.Text(), nullable=False),
        sa.Column("from_end", sa.Text(), nullable=False),
        # The class it was rescheduled into.
        sa.Column("to_on", sa.Text(), nullable=False),
        sa.Column("to_start", sa.Text(), nullable=False),
        sa.Column("to_end", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("term_code", "crn", "from_on", "from_start", "from_end", name="class_change_links_from"),
        sa.UniqueConstraint("term_code", "crn", "to_on", "to_start", "to_end", name="class_change_links_to"),
    )
    op.create_table(
        "class_change_notes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        # Which side of the change the class is on: one that went, or one that arrived.
        sa.Column("side", sa.Text(), nullable=False),
        sa.Column("meets_on", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("author_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.CheckConstraint("side IN ('removed', 'added')", name="class_change_notes_side"),
        sa.UniqueConstraint(
            "term_code", "crn", "side", "meets_on", "starts_at", "ends_at", name="class_change_notes_slot"
        ),
    )
    op.create_index("class_change_links_term", "class_change_links", ["term_code", "crn"])
    op.create_index("class_change_notes_term", "class_change_notes", ["term_code", "crn"])


def downgrade() -> None:
    op.drop_table("class_change_notes")
    op.drop_table("class_change_links")
