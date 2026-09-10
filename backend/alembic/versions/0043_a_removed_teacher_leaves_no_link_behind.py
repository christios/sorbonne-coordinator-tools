"""A section may not point at a teacher the department's list no longer holds.

`group_crns.teacher_id` names a row of `active_teachers`, and nothing has ever enforced
that the row is still there. Removing somebody from the department's list left every
section that had chosen them pointing at nothing — and a dangling link does not read as an
empty one. The card cannot resolve it, falls back to the name typed on the row, and goes on
naming a teacher who was deliberately removed. On production one section did exactly that,
and the typed name it fell back to was a year out of date.

The removal path now clears those links in the same transaction. This clears the ones it
left behind before it did.

No foreign key, deliberately. The column is NOT NULL and spells "nobody chosen" as the
empty string, which is not a row of any table for a key to point at; widening it to NULL is
a change to every reader of a section, for a guarantee the one deleting path can give.

Revision ID: 0043
Revises: 0042
"""

from __future__ import annotations

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE group_crns SET teacher_id = ''
        WHERE teacher_id <> ''
          AND NOT EXISTS (SELECT 1 FROM active_teachers a WHERE a.id = group_crns.teacher_id)
        """
    )


def downgrade() -> None:
    """Nothing to undo: the rows this clears pointed at teachers that do not exist."""
