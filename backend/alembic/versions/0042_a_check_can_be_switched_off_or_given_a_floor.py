"""A named check can be switched off, or given the floor below which it says nothing.

The department's checks have been all-or-nothing and always on. That was fine while every
one of them was worth acting on, and stopped being fine the moment the registrar's
timetable arrived: our sections overlap other departments' 32 times in one semester, and
seven of those catch a student — but four of the seven are a fifteen-minute tail against a
sport session starting at 18:00 while a class runs to 18:15. Nobody will ever move a
lecture over that, and a warning nobody will act on is the kind that teaches people to
stop reading warnings.

So a check carries a switch and, where the question has a size, a floor. `minutes` on the
collision check is the one that exists: below it the overlap is a fact about the timetable
and not a warning about a person.

Deliberately NOT a row in `discrepancy_rules`. Those are `(field, kind, values)` over the
portal's student-record columns — `MAJOR_CODE_DESC differs` — and a check about two
sections sharing an hour has no student field in it at all. Writing one into that table
would mean a `field` that is not a field, validated by a regex that would have to stop
meaning anything. The checks stay named functions; this says which are on.

Scope is the same two levels the rules already have: a row with no cohort is the
department's answer, a row with one is that cohort's, and the cohort's wins.

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "check_settings",
        # The check's own name, as the code knows it: "collision", "teacher_differs".
        sa.Column("name", sa.Text(), primary_key=True),
        # "" is the department's answer; a cohort id is that cohort's, and wins over it.
        sa.Column("cohort_id", sa.Text(), primary_key=True, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        # The size below which the check says nothing. Meaningless for a check with no
        # size to it, which is why it is one nullable column rather than a settings blob.
        sa.Column("threshold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("check_settings")
