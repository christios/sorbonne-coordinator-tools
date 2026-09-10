"""What a cohort's sheet is called in the timetable workbook, and which semester it starts at.

`Time-Tables-26-27.xlsx` has one tab per cohort per semester: FYS-S1, BSc-L1-S1,
BSc-L2-S3, BSc-L3-S5, MSc-MIAI-M1-S1. None of that is derivable from the cohort's name.
"Foundation Year for Science" gives FYFS, not FYS; "MSc Management of Innovation and
Artificial Intelligence — Master 1" gives no MIAI at all; and Licence 2's first semester
is called S3 because the numbering runs across the degree, not within the year — which no
rule can know, because it is a convention rather than a fact about the data.

So the cohort is asked. `workbook_tab` is the part before the semester ("BSc-L2") and
`first_semester` is the number its first semester is called by (3). Left empty, the export
falls back to initials and the semester's own number, which is what it did before.

Revision ID: 0038
Revises: 0037
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_cohorts", sa.Column("workbook_tab", sa.Text(), nullable=False, server_default=""))
    op.add_column("student_cohorts", sa.Column("first_semester", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("student_cohorts", "first_semester")
    op.drop_column("student_cohorts", "workbook_tab")
