"""A section may be taught in parts, and a student may be exempt from a course.

Two facts the model had no room for, both of which cost a coordinator a lie.

**Parts.** `group_crns` was keyed on (group, course): exactly one CRN per group per
course. MATH-351 is taught by one professor for the first half of the semester and another
for the second, and the registrar answers that with two pairs of CRNs — 23436 and 24313
running to late October, 23820 and 24311 from mid-October on. Our card could hold two of
the four. The second half's CM and the first half's TD had nowhere to go, so eleven
students' registrations in them were unexaminable, and the truth lived in a free-text
comment that had already gone stale.

There is no room to make by inventing a group: `group_assignments` is keyed on
(cohort, student, scope), so a second group of the same set cannot hold the same students,
and a second SET is a fiction that every count, every export and every placement would
then have to know about. So the cell gains a part instead. One part is a section as it has
always been; two parts are one section taught in two stretches, each with its own CRN,
teacher, hours and weeks. Nothing above the cell changes.

The registrar's dated meetings mean the halves cannot be reported as clashing with each
other — see 0039 — so nothing about clash detection has to learn what a part is.

**Exemptions.** A student is placed in a group and thereby in every course of its set. Some
are exempt from one of them — credit from elsewhere, a course already passed — and the
register then reports "not registered in a section we placed them in", which is the same
sentence it uses for a genuine error. On the copied production data one student is missing
one course of five and another is missing all five; only a human knows which is which.

Kept per (student, course) rather than per placement: a scope_course belongs to one set of
one semester, so the fact is already semester-scoped, and it survives the student being
moved between groups of that set, which does not change what they are exempt from.

Revision ID: 0040
Revises: 0039
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every row that exists is the whole of its section, so it is part 1. The server
    # default stays on: a caller that has never heard of parts keeps writing part 1, which
    # is the behaviour it had before this migration.
    op.add_column("group_crns", sa.Column("part", sa.Integer(), nullable=False, server_default="1"))
    op.drop_constraint("group_crns_pkey", "group_crns", type_="primary")
    op.create_primary_key("group_crns_pkey", "group_crns", ["group_id", "course_id", "part"])

    op.create_table(
        "course_exemptions",
        sa.Column("student_id", sa.Text(), primary_key=True),
        sa.Column(
            "course_id",
            sa.Text(),
            sa.ForeignKey("scope_courses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Why, in the coordinator's own words. Not a code: the reasons are various and an
        # enumeration of them would be wrong within a year.
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("course_exemptions_course", "course_exemptions", ["course_id"])


def downgrade() -> None:
    op.drop_index("course_exemptions_course", table_name="course_exemptions")
    op.drop_table("course_exemptions")
    # A section taught in parts cannot be expressed by the old key, so the parts after the
    # first are dropped rather than silently collapsed onto one another.
    op.execute("DELETE FROM group_crns WHERE part <> 1")
    op.drop_constraint("group_crns_pkey", "group_crns", type_="primary")
    op.create_primary_key("group_crns_pkey", "group_crns", ["group_id", "course_id"])
    op.drop_column("group_crns", "part")
