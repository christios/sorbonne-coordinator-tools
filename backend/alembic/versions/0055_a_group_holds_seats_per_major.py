"""A group holds seats per major, and a cell may belong to one major.

Until now a group carried one programme tag and a set's course carried another, and the
two were advisory: the fill preferred, readiness excused, and `resolve()` handed every
student in a group every CRN of the group regardless. Mutualized teaching could not be
said. L1's lecture set was two groups where the registrar has one section, and MTP 3A held
fifteen physicists and two mathematicians with no way to write that down.

Now a group has **sub-rows**, one per major it holds (`group_majors`: the programme in the
registrar's own words, and how many seats). A placement records the sub-row it took
(`group_assignments.major_id`). A cell belongs to the whole group (`major_id = ''`), to one
sub-row, or says that a sub-row is **not taught** a course at all — which is what the course
tag used to mean and could not enforce. A group with no sub-rows is exactly what a group was.

The tags are converted and then dropped:

- a tagged group becomes a group with one sub-row for that programme, its seats the
  group's capacity, and every placement in it moves onto that sub-row;
- a tagged course becomes a "not taught" cell on every sub-row of another programme in
  its set;
- an untagged group in a set whose courses are all tagged with one programme gets that
  programme as its only sub-row, which closes the group to everybody else — the
  intention the tag carried and the fill honoured.

A course tag in a set of untagged groups with mixed courses had no meaning the model can
keep, and is dropped.

Revision ID: 0055
Revises: 0054
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_majors",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("group_id", sa.Text(), sa.ForeignKey("scope_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("program", sa.Text(), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("group_id", "program", name="group_majors_program"),
    )
    op.create_index("group_majors_group", "group_majors", ["group_id"])

    op.add_column("group_crns", sa.Column("major_id", sa.Text(), nullable=False, server_default=""))
    op.add_column("group_crns", sa.Column("not_taught", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.drop_constraint("group_crns_pkey", "group_crns", type_="primary")
    op.create_primary_key("group_crns_pkey", "group_crns", ["group_id", "course_id", "part", "major_id"])

    op.add_column("group_assignments", sa.Column("major_id", sa.Text(), nullable=False, server_default=""))

    # A tagged group: one sub-row, the group's seats, every placement onto it.
    op.execute(
        """INSERT INTO group_majors (id, group_id, program, seats, position)
           SELECT md5(id || '-major'), id, trim(program), capacity, 0
           FROM scope_groups WHERE trim(program) <> ''"""
    )
    # An untagged group in a set whose courses are all tagged with one programme: closed
    # to everybody else, as the tag meant.
    op.execute(
        """INSERT INTO group_majors (id, group_id, program, seats, position)
           SELECT md5(g.id || '-closed'), g.id, one.program, g.capacity, 0
           FROM scope_groups g
           JOIN (SELECT scope_id, min(trim(program)) AS program
                 FROM scope_courses
                 GROUP BY scope_id
                 HAVING min(trim(program)) = max(trim(program)) AND min(trim(program)) <> '') one
             ON one.scope_id = g.scope_id
           WHERE trim(g.program) = ''"""
    )
    op.execute(
        """UPDATE group_assignments a SET major_id = m.id
           FROM group_majors m WHERE m.group_id = a.group_id AND a.major_id = ''"""
    )
    # A tagged course: not taught on every sub-row of another programme in its set.
    op.execute(
        """INSERT INTO group_crns (group_id, course_id, part, major_id, crn, teacher, not_taught)
           SELECT m.group_id, c.id, 1, m.id, '', '', true
           FROM scope_courses c
           JOIN scope_groups g ON g.scope_id = c.scope_id
           JOIN group_majors m ON m.group_id = g.id
           WHERE trim(c.program) <> '' AND lower(trim(m.program)) <> lower(trim(c.program))
           ON CONFLICT DO NOTHING"""
    )

    op.drop_column("scope_groups", "program")
    op.drop_column("scope_courses", "program")


def downgrade() -> None:
    op.add_column("scope_courses", sa.Column("program", sa.Text(), nullable=False, server_default=""))
    op.add_column("scope_groups", sa.Column("program", sa.Text(), nullable=False, server_default=""))
    # A group with exactly one sub-row gets its tag back; anything richer cannot be said.
    op.execute(
        """UPDATE scope_groups g SET program = one.program
           FROM (SELECT group_id, min(program) AS program FROM group_majors
                 GROUP BY group_id HAVING count(*) = 1) one
           WHERE one.group_id = g.id"""
    )
    op.execute("DELETE FROM group_crns WHERE major_id <> ''")
    op.drop_column("group_assignments", "major_id")
    op.drop_constraint("group_crns_pkey", "group_crns", type_="primary")
    op.drop_column("group_crns", "not_taught")
    op.drop_column("group_crns", "major_id")
    op.create_primary_key("group_crns_pkey", "group_crns", ["group_id", "course_id", "part"])
    op.drop_index("group_majors_group", table_name="group_majors")
    op.drop_table("group_majors")
