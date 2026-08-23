"""The coordinator's Student Database: cohorts, scopes, groups, and the CRNs they bundle.

Modelled on the group-assignment workbooks. A *scope* is a block of components that share
a population and a set of group labels (Foundation Year TD, Languages A1); a *group* inside
it is a bundle of CRNs, one per course in the block; a student in a cohort holds one group
per scope, and every CRN follows from that. Nothing here identifies a student: a member is
an id, and the only name stored is the coordinator who last moved them.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_cohorts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        # Free text on purpose: a cohort is whatever the coordinator needs to assemble.
        sa.Column("term", sa.Text(), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )

    op.create_table(
        "cohort_members",
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="CASCADE"), primary_key=True
        ),
        # A student id and nothing else. Names live in the coordinator's browser.
        sa.Column("student_id", sa.Text(), primary_key=True),
        sa.Column("added_at", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
    )

    op.create_table(
        "cohort_scopes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_unique_constraint("cohort_scopes_code", "cohort_scopes", ["cohort_id", "code"])

    op.create_table(
        "scope_courses",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("scope_id", sa.Text(), sa.ForeignKey("cohort_scopes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("component", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_unique_constraint("scope_courses_code", "scope_courses", ["scope_id", "code"])

    op.create_table(
        "scope_groups",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("scope_id", sa.Text(), sa.ForeignKey("cohort_scopes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        # 0 means "no limit set"; the languages workbook is the reason this exists.
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_unique_constraint("scope_groups_label", "scope_groups", ["scope_id", "label"])

    # One cell of the group × course matrix.
    op.create_table(
        "group_crns",
        sa.Column("group_id", sa.Text(), sa.ForeignKey("scope_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("course_id", sa.Text(), sa.ForeignKey("scope_courses.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("teacher", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("group_crns_crn", "group_crns", ["crn"])

    op.create_table(
        "group_assignments",
        sa.Column(
            "cohort_id", sa.Text(), sa.ForeignKey("student_cohorts.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("student_id", sa.Text(), primary_key=True),
        sa.Column("scope_id", sa.Text(), sa.ForeignKey("cohort_scopes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("group_id", sa.Text(), sa.ForeignKey("scope_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("group_assignments_group", "group_assignments", ["group_id"])


def downgrade() -> None:
    op.drop_index("group_assignments_group", table_name="group_assignments")
    op.drop_table("group_assignments")
    op.drop_index("group_crns_crn", table_name="group_crns")
    op.drop_table("group_crns")
    op.drop_table("scope_groups")
    op.drop_table("scope_courses")
    op.drop_table("cohort_scopes")
    op.drop_table("cohort_members")
    op.drop_table("student_cohorts")
