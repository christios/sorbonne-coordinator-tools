"""Create teaching-requisition table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "requisitions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("employee_name", sa.Text(), nullable=False),
        sa.Column("academic_year", sa.Text(), nullable=False),
        sa.Column("content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("requisitions_year_name", "requisitions", ["academic_year", "employee_name"])


def downgrade() -> None:
    op.drop_index("requisitions_year_name", table_name="requisitions")
    op.drop_table("requisitions")
