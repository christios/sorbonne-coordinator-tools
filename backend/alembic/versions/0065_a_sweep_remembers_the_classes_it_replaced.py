"""A sweep remembers the classes it replaced, so a deletion can be seen.

The registrar removed most of a section's classes by mistake, and nothing here noticed.
The protection that existed guards a different accident: a section the portal stops
answering for at all keeps its classes and is only believed dead after two complete
sweeps say nothing. A section that still answers, with twenty hours quietly gone from
inside it, looked exactly like a section that never had them — because each sweep
replaces that section's meetings wholesale and the old ones are deleted unread.

They are read now. What one sweep held and the next did not is written down here before
it goes, and so is what appeared. Two rows for a class that moved hour, which is the
honest reading: the diff a coordinator looks at should show them where they were and
where they are, not a verb chosen by a comparison.

Only for a section already known. Everything is new the first time a section is seen,
and a page of "added" for a term nobody had swept yet is noise that teaches people to
stop reading the page.

Nothing prunes this. It is a few rows per sweep per changed section, and it is the only
record that a class ever existed once the registrar has stopped saying so.

Revision ID: 0065
Revises: 0064
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "facility_meeting_changes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        #: The sweep that noticed it: the moment the registrar's answer changed.
        sa.Column("noticed_at", sa.Text(), nullable=False),
        #: 'removed' — the sweep before had it and this one did not. 'added' — the reverse.
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("meets_on", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False),
        sa.Column("room", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("kind IN ('removed', 'added')", name="facility_meeting_changes_kind"),
    )
    op.create_index(
        "facility_meeting_changes_section", "facility_meeting_changes", ["term_code", "crn", "noticed_at"]
    )


def downgrade() -> None:
    op.drop_index("facility_meeting_changes_section", table_name="facility_meeting_changes")
    op.drop_table("facility_meeting_changes")
