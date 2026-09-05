"""The portal's courses, teachers and registrations, kept the way its students are.

Three more of the registrar's lists, each pulled by a saved portal filter and reconciled
the way a view of students is: what a pull returned is in the portal, what a filter held
and the pull no longer returns has left it. Courses and teachers are shared as they are —
a teacher's name and university e-mail are on every timetable. A registration is a student
id against a CRN and nothing more; the name stays in the browser that pulled it.

A term link says which portal term a Student Hub semester is, so the two can be compared.

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_filters",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("filter", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_synced_at", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("kind", "name", name="portal_filters_kind_name"),
    )
    op.create_table(
        "portal_courses",
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("subject", sa.Text(), nullable=False, server_default=""),
        sa.Column("sequence", sa.Text(), nullable=False, server_default=""),
        sa.Column("part_of_term", sa.Text(), nullable=False, server_default=""),
        sa.Column("part_of_term_desc", sa.Text(), nullable=False, server_default=""),
        sa.Column("credits", sa.Text(), nullable=False, server_default=""),
        sa.Column("department", sa.Text(), nullable=False, server_default=""),
        sa.Column("level", sa.Text(), nullable=False, server_default=""),
        sa.Column("college", sa.Text(), nullable=False, server_default=""),
        sa.Column("contact_hours", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("registered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("begins", sa.Text(), nullable=False, server_default=""),
        sa.Column("ends", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.Column("first_seen_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("term_code", "crn"),
    )
    op.create_table(
        "portal_course_members",
        sa.Column("filter_id", sa.Text(), sa.ForeignKey("portal_filters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.PrimaryKeyConstraint("filter_id", "term_code", "crn"),
    )
    op.create_table(
        "portal_teachers",
        sa.Column("teacher_id", sa.Text(), primary_key=True),
        sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_status", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.Text(), nullable=False, server_default=""),
        sa.Column("type", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_term", sa.Text(), nullable=False, server_default=""),
        sa.Column("credits", sa.Text(), nullable=False, server_default=""),
        sa.Column("courses_count", sa.Text(), nullable=False, server_default=""),
        sa.Column("periods_count", sa.Text(), nullable=False, server_default=""),
        sa.Column("students_count", sa.Text(), nullable=False, server_default=""),
        sa.Column("department", sa.Text(), nullable=False, server_default=""),
        sa.Column("rank", sa.Text(), nullable=False, server_default=""),
        sa.Column("courses", sa.Text(), nullable=False, server_default=""),
        sa.Column("institution", sa.Text(), nullable=False, server_default=""),
        sa.Column("psuad_email", sa.Text(), nullable=False, server_default=""),
        # The matching record in the part-time teacher database, when one has been matched.
        sa.Column("part_time_teacher_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.Column("first_seen_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
    )
    op.create_table(
        "portal_teacher_members",
        sa.Column("filter_id", sa.Text(), sa.ForeignKey("portal_filters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.PrimaryKeyConstraint("filter_id", "teacher_id"),
    )
    op.create_table(
        "student_registrations",
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.Column("first_seen_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("term_code", "student_id", "crn"),
    )
    op.create_index("student_registrations_student", "student_registrations", ["student_id"])
    op.create_table(
        "portal_registration_members",
        sa.Column("filter_id", sa.Text(), sa.ForeignKey("portal_filters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_portal"),
        sa.PrimaryKeyConstraint("filter_id", "term_code", "student_id"),
    )
    op.create_table(
        "term_links",
        sa.Column("term_id", sa.Text(), primary_key=True),
        sa.Column("portal_term_code", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    for table in (
        "term_links",
        "portal_registration_members",
        "student_registrations",
        "portal_teacher_members",
        "portal_teachers",
        "portal_course_members",
        "portal_courses",
        "portal_filters",
    ):
        op.drop_table(table)
