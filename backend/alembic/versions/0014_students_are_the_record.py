"""One persistent row per student, replacing membership-of-a-cohort.

The Students page used to compare a filtered pull against one chosen cohort, which meant
"new" and "left" were relative to that choice: pull two year groups against one cohort and
everyone else looked new, pull a narrow search and the cohort looked emptied.

A student is now a record in their own right. Syncing with the portal sets their status —
found, or no longer found — and a cohort is one nullable column on that record rather than
a membership table. Still nothing but the id: names stay in the coordinator's browser.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "students",
        # The registrar's id, and the only thing here that identifies anybody.
        sa.Column("student_id", sa.Text(), primary_key=True),
        # 'in_portal' or 'not_in_portal': what the last full sync found.
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("first_seen_at", sa.Text(), nullable=False),
        # When the portal last returned them, which is what "not in portal" is measured from.
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("students_cohort", "students", ["cohort_id"])
    op.create_index("students_status", "students", ["status"])

    # Everyone already in a cohort becomes a student record. A student who somehow sat in
    # two cohorts keeps the one they were put in first; the new model allows only one.
    op.execute(
        """
        INSERT INTO students (student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)
        SELECT DISTINCT ON (student_id) student_id, 'in_portal', cohort_id, added_at, added_at, added_at
        FROM cohort_members
        ORDER BY student_id, added_at
        """
    )

    op.drop_table("cohort_members")


def downgrade() -> None:
    op.create_table(
        "cohort_members",
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("student_id", sa.Text(), primary_key=True),
        sa.Column("added_at", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(
        """
        INSERT INTO cohort_members (cohort_id, student_id, added_at, added_by)
        SELECT cohort_id, student_id, first_seen_at, '' FROM students WHERE cohort_id IS NOT NULL
        """
    )
    op.drop_index("students_status", table_name="students")
    op.drop_index("students_cohort", table_name="students")
    op.drop_table("students")
