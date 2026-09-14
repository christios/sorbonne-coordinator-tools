"""Which apps a person may open, and what they may do inside each.

Being let into the workspace used to mean being let into all of it, because everybody who
was let in was a coordinator. A professor invited to write their own syllabus has no business
in the student roster, and the person who maintains the syllabus catalogue is not necessarily
the person who administers accounts — so what someone may do is recorded per app rather than
once for the whole platform.

Everyone already invited is given every app, as an administrator of each. That is what they
have today, and a migration is no place to take something away from somebody; whoever
administers accounts can narrow it from Settings afterwards.

Revision ID: 0059
Revises: 0058
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

APPS = ("syllabus", "teachers", "database", "handbook")


def upgrade() -> None:
    op.create_table(
        "account_apps",
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("app", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="member"),
        sa.PrimaryKeyConstraint("email", "app"),
    )
    connection = op.get_bind()
    for (email,) in connection.execute(sa.text("SELECT email FROM coordinator_accounts")):
        for app in APPS:
            connection.execute(
                sa.text(
                    "INSERT INTO account_apps (email, app, role) VALUES (:email, :app, 'admin')"
                    " ON CONFLICT DO NOTHING"
                ),
                {"email": email, "app": app},
            )


def downgrade() -> None:
    op.drop_table("account_apps")
