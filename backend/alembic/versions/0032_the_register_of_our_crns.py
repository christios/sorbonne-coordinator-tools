"""The department's register is CRNs, not only courses.

Active courses said which courses the department deals with, and carried one parent CRN
for the whole course. What a coordinator actually keeps is a register of the CRNs of a
term: which sections are ours, what each hangs from, and where the registrar's list has
moved away from it. So the CRNs of an active course become rows of their own, each with
its own parent CRN, and the course keeps what belongs to the course — its name and its
Sorbonne UE.

Revision ID: 0032
Revises: 0031
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "active_course_crns",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False),
        # What this section hangs from in the portal. Per CRN: a course may have more
        # than one parent, and the workbook's column is filled in section by section.
        sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""),
        sa.Column("added_at", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("term_code", "crn", name="active_course_crns_term_crn"),
    )
    op.create_index("active_course_crns_course", "active_course_crns", ["course_code"])

    # Every CRN the portal holds for a course already chosen joins the register, carrying
    # the parent CRN that was typed for the whole course.
    connection = op.get_bind()
    now = datetime.now(UTC).isoformat()
    rows = connection.execute(
        sa.text("""SELECT c.term_code, c.crn, upper(c.course_code) AS course_code, a.parent_crn
                   FROM portal_courses c
                   JOIN active_courses a ON a.course_code = upper(c.course_code)""")
    ).mappings().all()
    for row in rows:
        connection.execute(
            sa.text("""INSERT INTO active_course_crns
                           (id, term_code, crn, course_code, parent_crn, added_at, added_by)
                       VALUES (:id, :term_code, :crn, :course_code, :parent_crn, :now, '')"""),
            {"id": str(uuid4()), **dict(row), "now": now},
        )
    op.drop_column("active_courses", "parent_crn")


def downgrade() -> None:
    op.add_column("active_courses", sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""))
    connection = op.get_bind()
    # One parent per course again: the first one any of its CRNs carries.
    for course_code, parent_crn in connection.execute(
        sa.text("""SELECT course_code, min(parent_crn) FROM active_course_crns
                   WHERE parent_crn <> '' GROUP BY course_code""")
    ):
        connection.execute(
            sa.text("UPDATE active_courses SET parent_crn = :parent WHERE course_code = :code"),
            {"parent": parent_crn, "code": course_code},
        )
    op.drop_index("active_course_crns_course", table_name="active_course_crns")
    op.drop_table("active_course_crns")
