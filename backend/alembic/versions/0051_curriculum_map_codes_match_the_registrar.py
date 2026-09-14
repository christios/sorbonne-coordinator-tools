"""Spell a mapped course's code the way the course record spells it.

The map was seeded from a document and written by hand after that, so it held MATH-100
beside PHYS125 — the same kind of code punctuated two ways. Nothing was broken by it,
because a course is matched on its letters and digits alone, but the catalogue is what a
coordinator reads, and a list that spells its own codes two ways reads like a mistake.

Where the course list holds the course, its spelling wins. Where it does not — a course the
registrar has no record of yet — the dash goes between the letters and the digits, which is
the form every code in the list takes.

Revision ID: 0051
Revises: 0050
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

CODE = re.compile(r"^([A-Za-z]+)-?(\d.*)$")


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _dashed(value: str) -> str:
    match = CODE.match(value.strip())
    return f"{match.group(1)}-{match.group(2)}" if match else value.strip()


def upgrade() -> None:
    connection = op.get_bind()
    known: dict[str, str] = {}
    for (code,) in connection.execute(
        sa.text("SELECT DISTINCT course_code FROM course_catalogue_entries WHERE course_code IS NOT NULL")
    ):
        known.setdefault(_key(code), code)

    rows = connection.execute(
        sa.text("SELECT id, label FROM syllabus_catalogue_items WHERE category = 'curriculum-mapping'")
    ).all()
    for item_id, label in rows:
        wanted = known.get(_key(label)) or _dashed(label)
        if wanted and wanted != label:
            connection.execute(
                sa.text("UPDATE syllabus_catalogue_items SET label = :label WHERE id = :id"),
                {"label": wanted, "id": item_id},
            )


def downgrade() -> None:
    """The spelling is not worth restoring, and nothing reads it for anything but display."""
