"""The AI policies catalogue holds the Provost's template's five options, each tied to its row.

The November 2026 review chose that every graded activity applies one of the template's
own five AI options. Migration 0048 left out "Other (Specify)" on purpose; it is added
now, for the activity whose policy the teacher writes in their own words. Each option
also records which row of section 9.3's table it ticks in the exported document
(`templateRow`), and "AI Permitted as a Support Tool" carries the uses the template lets a
course tick, worded exactly as the template prints them (`permittedUses`).

Only catalogue rows are touched, never syllabi. Keys already present are kept, so wording
an administrator has edited survives; a changed row's revision moves on, so an editor
left open on it is told to reload rather than saving over it.

Revision ID: 0090
Revises: 0089
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None

OTHER_ID = "ai-policy-5"
OTHER = "Other (Specify)"
TEMPLATE_ROWS = {
    "ai-policy-1": 1,  # AI Prohibited
    "ai-policy-2": 2,  # AI Permitted as a Support Tool
    "ai-policy-3": 3,  # Restricted AI Use
    "ai-policy-4": 4,  # AI Required
    OTHER_ID: 5,
}
PERMITTED_USES = [
    "Brainstorming or generating initial ideas",
    "Language editing (grammar, spelling, style, and readability)",
    "Structuring or organizing ideas",
    "Clarifying concepts or obtaining explanations",
]


def upgrade() -> None:
    connection = op.get_bind()
    stamp = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    has_other = connection.execute(
        sa.text(
            "SELECT 1 FROM syllabus_catalogue_items "
            "WHERE category = 'ai-policies' AND (id = :id OR label = :label)"
        ),
        {"id": OTHER_ID, "label": OTHER},
    ).first()
    if not has_other:
        connection.execute(
            sa.text(
                "INSERT INTO syllabus_catalogue_items "
                "(id, category, parent_id, label, payload, sort_order, is_retired, retired_at, revision, "
                "created_at, updated_at) "
                "VALUES (:id, 'ai-policies', NULL, :label, CAST(:payload AS jsonb), 5, false, NULL, 1, :stamp, :stamp)"
            ),
            {
                "id": OTHER_ID,
                "label": OTHER,
                "payload": json.dumps({"description": "The teacher states the AI policy that applies."}),
                "stamp": stamp,
            },
        )
    for item_id, row in TEMPLATE_ROWS.items():
        extra = {"templateRow": row}
        if item_id == "ai-policy-2":
            extra["permittedUses"] = PERMITTED_USES
        # The defaults go first, so whatever the row already says wins.
        connection.execute(
            sa.text(
                "UPDATE syllabus_catalogue_items "
                "SET payload = CAST(:extra AS jsonb) || payload, revision = revision + 1, updated_at = :stamp "
                "WHERE id = :id AND category = 'ai-policies' "
                "AND NOT (payload ?& CAST(:keys AS text[]))"
            ),
            {"extra": json.dumps(extra), "id": item_id, "stamp": stamp, "keys": list(extra)},
        )


def downgrade() -> None:
    op.execute(
        "UPDATE syllabus_catalogue_items SET payload = payload - 'templateRow' - 'permittedUses' "
        "WHERE category = 'ai-policies'"
    )
    op.execute(f"DELETE FROM syllabus_catalogue_items WHERE id = '{OTHER_ID}' AND category = 'ai-policies'")
