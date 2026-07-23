"""Associate each syllabus with an approved template.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("syllabi", sa.Column("template_id", sa.Text(), nullable=True))
    op.execute("UPDATE syllabi SET template_id = 'scen-en-v1' WHERE template_id IS NULL")
    op.alter_column("syllabi", "template_id", nullable=False)
    op.create_index("syllabi_template_id", "syllabi", ["template_id"])


def downgrade() -> None:
    op.drop_index("syllabi_template_id", table_name="syllabi")
    op.drop_column("syllabi", "template_id")
