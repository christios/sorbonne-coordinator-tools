"""Active courses, and cohorts linked to the portal's terms and majors.

A course's UE and parent CRN were typed on the card, once per group set that carried
the course, and a card could name a course the portal had never heard of. They belong to
the course itself — the department's own list of the courses it deals with, chosen from
the portal's list the way Active teachers are chosen from Teachers — so the card reads
them and stops asking.

A cohort said what it expected as a programme written out and a year level. What the
portal actually carries is a term code and a major code, and a cohort may span more than
one of each; so it now holds lists of both, and "differs from the cohort's" has something
exact to differ from. The old programme text is carried into the majors list, where the
rules match it by label as well as by code.

Revision ID: 0028
Revises: 0027
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "active_courses",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("course_code", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("ue", sa.Text(), nullable=False, server_default=""),
        sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""),
        sa.Column("added_at", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False, server_default=""),
    )

    connection = op.get_bind()
    now = datetime.now(UTC).isoformat()
    # Every course a card already names becomes an active course, carrying the UE and
    # parent CRN typed on whichever set held them.
    held: dict[str, dict[str, str]] = {}
    for code, name, ue, parent_crn in connection.execute(
        sa.text("SELECT code, name, ue, parent_crn FROM scope_courses ORDER BY position")
    ):
        key = " ".join(str(code or "").split()).upper()
        if not key:
            continue
        entry = held.setdefault(key, {"title": "", "ue": "", "parent_crn": ""})
        entry["title"] = entry["title"] or " ".join(str(name or "").split())
        entry["ue"] = entry["ue"] or " ".join(str(ue or "").split())
        entry["parent_crn"] = entry["parent_crn"] or " ".join(str(parent_crn or "").split())
    for key, entry in held.items():
        connection.execute(
            sa.text(
                """INSERT INTO active_courses (id, course_code, title, ue, parent_crn, added_at, added_by)
                   VALUES (:id, :code, :title, :ue, :parent_crn, :now, '')"""
            ),
            {"id": str(uuid4()), "code": key, "now": now, **entry},
        )
    op.drop_column("scope_courses", "ue")
    op.drop_column("scope_courses", "parent_crn")

    op.add_column("student_cohorts", sa.Column("major_codes", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("student_cohorts", sa.Column("term_codes", sa.Text(), nullable=False, server_default="[]"))
    for cohort_id, program in connection.execute(
        sa.text("SELECT id, program FROM student_cohorts WHERE program <> ''")
    ):
        connection.execute(
            sa.text("UPDATE student_cohorts SET major_codes = :majors WHERE id = :id"),
            {"id": cohort_id, "majors": json.dumps([" ".join(str(program).split())])},
        )
    op.drop_column("student_cohorts", "program")


def downgrade() -> None:
    op.add_column("student_cohorts", sa.Column("program", sa.Text(), nullable=False, server_default=""))
    connection = op.get_bind()
    for cohort_id, majors in connection.execute(sa.text("SELECT id, major_codes FROM student_cohorts")):
        listed = json.loads(majors or "[]")
        if listed:
            connection.execute(
                sa.text("UPDATE student_cohorts SET program = :program WHERE id = :id"),
                {"id": cohort_id, "program": listed[0]},
            )
    op.drop_column("student_cohorts", "term_codes")
    op.drop_column("student_cohorts", "major_codes")

    op.add_column("scope_courses", sa.Column("ue", sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_courses", sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""))
    for code, ue, parent_crn in connection.execute(sa.text("SELECT course_code, ue, parent_crn FROM active_courses")):
        connection.execute(
            sa.text("UPDATE scope_courses SET ue = :ue, parent_crn = :parent_crn WHERE upper(code) = :code"),
            {"code": code, "ue": ue, "parent_crn": parent_crn},
        )
    op.drop_table("active_courses")
