"""Every stored session becomes a lecture unless someone says otherwise.

Sessions are now counted per kind — 1 CM, 2 CM, 1 TD — which means each one has to
say which kind it is. Existing schedules predate the distinction, so they are read
as lectures: that is the common case, and it leaves the numbering a course already
had unchanged. A coordinator retags the tutorials and labs from the editor.

This is the one migration that writes to stored syllabus content. It only adds a
field to sessions that lack it, and touches nothing else in the document.

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-31
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None

DEFAULT_SESSION_TYPE = "CM"


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, content_json FROM syllabi")).all()
    for syllabus_id, stored in rows:
        content = json.loads(stored) if isinstance(stored, str) else dict(stored)
        schedule = content.get("schedule")
        if not isinstance(schedule, list):
            continue
        changed = False
        for session in schedule:
            if isinstance(session, dict) and not str(session.get("sessionType") or "").strip():
                session["sessionType"] = DEFAULT_SESSION_TYPE
                changed = True
        if not changed:
            continue
        connection.execute(
            sa.text("UPDATE syllabi SET content_json = CAST(:content AS jsonb) WHERE id = :id"),
            {"content": json.dumps(content), "id": syllabus_id},
        )


def downgrade() -> None:
    """The kind of session is content once a coordinator has corrected it."""
