"""A syllabus belongs to whoever wrote it, and says who else may read it.

Until now every signed-in coordinator saw every syllabus, because every signed-in person was
a coordinator. Professors writing their own means a syllabus needs an owner and a visibility:
private while it is being written, submitted when its author wants it reviewed, public once
it is anybody's to read.

Everything already here is left public and ownerless. Ownerless is not a gap — it is the
shared set the department curates, the same way an imported recording belongs to the team
rather than to a person, and making it public means nothing disappears from anyone's library
on the day this ships.

Revision ID: 0058
Revises: 0057
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("syllabi", sa.Column("owner_email", sa.Text(), nullable=True))
    op.add_column("syllabi", sa.Column("visibility", sa.Text(), nullable=False, server_default="public"))
    op.add_column("syllabi", sa.Column("submitted_at", sa.Text(), nullable=True))
    op.create_index("ix_syllabi_owner_email", "syllabi", ["owner_email"])


def downgrade() -> None:
    op.drop_index("ix_syllabi_owner_email", table_name="syllabi")
    op.drop_column("syllabi", "submitted_at")
    op.drop_column("syllabi", "visibility")
    op.drop_column("syllabi", "owner_email")
