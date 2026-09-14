"""A part-time teacher keeps links to their time sheets.

The time sheets themselves are Excel workbooks living in OneDrive, where the finance
people keep them and where they are edited. Copying them into this database would give
us a second, staler copy of a file somebody else owns. What is missing is not the file:
it is knowing, from the teacher's profile, which sheet is theirs and being one click from
it. So a profile keeps a short list of labelled links beside its requisitions.

Only the label, the academic year and the link are ours. Whoever can open the link is
decided by OneDrive's own sharing, which is where that decision belongs.

Revision ID: 0049
Revises: 0048
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_time_sheets",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "teacher_id", sa.Text(), sa.ForeignKey("part_time_teachers.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("academic_year", sa.Text(), nullable=False, server_default=""),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("teacher_time_sheets_teacher_year", "teacher_time_sheets", ["teacher_id", "academic_year"])


def downgrade() -> None:
    op.drop_index("teacher_time_sheets_teacher_year", table_name="teacher_time_sheets")
    op.drop_table("teacher_time_sheets")
