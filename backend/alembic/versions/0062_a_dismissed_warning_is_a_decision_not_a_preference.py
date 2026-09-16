"""A dismissed warning is the department's decision, not one browser's preference.

"Yes, I know, they are staying in the group anyway" is a judgement somebody made about a
student. It was kept in whichever browser it was made in, so the next coordinator to open
the page saw the warning again with nothing to say it had already been considered — and
made the same judgement over, or worse, acted on it. Kept here, it is made once.

Signed and dated, because a shared dismissal hides something from somebody who never saw
it. The page says "dismissed by X on the 16th" in place of the warning rather than showing
nothing at all, and anybody can bring it back.

One row per warning, the key being the warning's own: it already changes on its own when
the underlying fact changes, so a dismissal expires by the key ceasing to match rather
than by anything having to expire it. Nothing prunes this table. The browser store it
replaces was pruned to keep it small, and pruning was the one dangerous thing it did —
each browser judged "gone" from its OWN evidence, so pruning here would let one browser
delete decisions made against warnings only another can see. A row nothing matches any
more is dead weight, and dead weight is cheap.

The key carries student ids, portal codes and CRNs, as the rest of the server does. It
carries no student name, because no warning is keyed on one.

Revision ID: 0062
Revises: 0061
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "warning_dismissals",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("dismissed_by_email", sa.Text(), nullable=False, server_default=""),
        sa.Column("dismissed_by_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("dismissed_at", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("warning_dismissals")
