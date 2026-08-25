"""A cohort's blocks are defined per semester, because groups reshuffle between them.

A cohort is a lasting population — "L1 2026-27", the same students all year. What changes is
how they are split: Block A is Maths Gr.3 in the first semester and Maths Gr.2 in the second.
Until now a scope was unique on `(cohort_id, code)`, so a cohort could hold one "TD" and no
more, and the same rows had to serve both semesters or be thrown away between them.

`term_id` is the student platform's own term id, deliberately kept as an opaque string rather
than mirrored into a table here. Timetables live over there; a term that disappears should
surface as a validation failure the coordinator can read, not as a foreign key this database
cannot satisfy.

Existing scopes arrive with no semester. That is honest — nobody has said which one they
belong to — and the interface asks before they can be published.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cohort_scopes", sa.Column("term_id", sa.Text(), nullable=False, server_default=""))
    op.drop_constraint("cohort_scopes_code", "cohort_scopes", type_="unique")
    op.create_unique_constraint("cohort_scopes_code", "cohort_scopes", ["cohort_id", "term_id", "code"])
    op.create_index("cohort_scopes_term", "cohort_scopes", ["term_id"])


def downgrade() -> None:
    op.drop_index("cohort_scopes_term", table_name="cohort_scopes")
    op.drop_constraint("cohort_scopes_code", "cohort_scopes", type_="unique")
    op.create_unique_constraint("cohort_scopes_code", "cohort_scopes", ["cohort_id", "code"])
    op.drop_column("cohort_scopes", "term_id")
