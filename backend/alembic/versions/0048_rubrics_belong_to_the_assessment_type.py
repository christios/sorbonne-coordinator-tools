"""A rubric is part of an assessment type, not a record of its own.

Every rubric preset pointed at exactly one assessment type and carried the only
thing anyone wanted from it — the criteria and their bands — in a payload no screen
ever showed. Folding the criteria onto the type removes the indirection: the thing
a graded activity picks is the thing that carries the rubric.

Revision ID: 0048
Revises: 0047
Create Date: 2026-09-10
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    presets = connection.execute(
        sa.text("SELECT id, label, payload FROM syllabus_catalogue_items WHERE category = 'rubric-presets'")
    ).all()
    for _, label, stored in presets:
        payload = json.loads(stored) if isinstance(stored, str) else dict(stored)
        criteria = payload.get("criteria") or []
        type_id = str(payload.get("assessmentTypeId") or "")
        if not type_id or not criteria:
            continue
        current = connection.execute(
            sa.text("SELECT payload FROM syllabus_catalogue_items WHERE id = :id AND category = 'assessment-types'"),
            {"id": type_id},
        ).scalar()
        if current is None:
            continue
        target = json.loads(current) if isinstance(current, str) else dict(current)
        if target.get("criteria"):
            continue  # already carries its own rubric
        target["criteria"] = criteria
        connection.execute(
            sa.text(
                "UPDATE syllabus_catalogue_items SET payload = CAST(:payload AS jsonb),"
                " revision = revision + 1 WHERE id = :id"
            ),
            {"payload": json.dumps(target), "id": type_id},
        )
        del label
    op.execute("DELETE FROM syllabus_catalogue_items WHERE category = 'rubric-presets'")


def downgrade() -> None:
    """The criteria are content; splitting them back out would invent records."""
