"""The department's active courses and teachers are kept semester by semester.

A course and a teacher stay one record each — a course's UE and whether it is mutualized,
a teacher's links to the portal and to the part-time database, which time sheets and roles
read — and which semesters each is active in is said beside it, by the portal's code for
the semester, as the register of CRNs already is:

    active_course_terms     a course active in a portal term (262710)
    active_teacher_terms    a teacher active in a portal term

Everything active today was active in the semester the register is about: the terms its
CRNs are registered in, and for a course with none, or a teacher, the latest of those.

Revision ID: 0086
Revises: 0085
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None

# The register's latest term, or failing that the latest portal term a semester is linked to.
_CURRENT = """coalesce(
    (SELECT max(term_code) FROM active_course_crns),
    (SELECT max(portal_term_code) FROM term_links WHERE portal_term_code <> '')
)"""


def upgrade() -> None:
    op.create_table(
        "active_course_terms",
        sa.Column(
            "course_code",
            sa.Text(),
            sa.ForeignKey("active_courses.course_code", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("term_code", sa.Text(), primary_key=True),
    )
    op.create_table(
        "active_teacher_terms",
        sa.Column("active_id", sa.Text(), sa.ForeignKey("active_teachers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("term_code", sa.Text(), primary_key=True),
    )
    op.create_index("active_course_terms_term", "active_course_terms", ["term_code"])
    op.create_index("active_teacher_terms_term", "active_teacher_terms", ["term_code"])
    op.execute(
        """INSERT INTO active_course_terms (course_code, term_code)
           SELECT DISTINCT course_code, term_code FROM active_course_crns
           WHERE course_code IN (SELECT course_code FROM active_courses)"""
    )
    op.execute(
        f"""INSERT INTO active_course_terms (course_code, term_code)
            SELECT a.course_code, {_CURRENT} FROM active_courses a
            WHERE NOT EXISTS (SELECT 1 FROM active_course_terms t WHERE t.course_code = a.course_code)
              AND {_CURRENT} IS NOT NULL"""  # noqa: S608 - a fixed expression
    )
    op.execute(
        f"""INSERT INTO active_teacher_terms (active_id, term_code)
            SELECT id, {_CURRENT} FROM active_teachers WHERE {_CURRENT} IS NOT NULL"""  # noqa: S608
    )


def downgrade() -> None:
    op.drop_table("active_teacher_terms")
    op.drop_table("active_course_terms")
