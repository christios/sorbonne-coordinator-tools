"""A course's teacher is a name, not a list of one.

The portal writes the teachers of a course as a comma-terminated list, and ends it with
a comma whether or not anybody follows, so the one teacher of MATH-001 CM A arrives as
"Bilal Maaz,". That comma reached the screen: the CRN menu shows the portal's teacher
beside each CRN, and the pill read "Bilal Maaz,".

New rows are tidied as they come in. This tidies the ones already held, so nobody has to
sync a term again to be rid of a comma.

Revision ID: 0035
Revises: 0034
"""

from __future__ import annotations

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the trailing separator and any space before it; a list of two keeps its comma.
    op.execute(
        r"""UPDATE portal_courses
               SET teacher_name = regexp_replace(teacher_name, '[\s,]+$', '')
             WHERE teacher_name ~ '[\s,]$'"""
    )


def downgrade() -> None:
    """Nothing to undo: the comma said nothing, and putting it back would say nothing."""
