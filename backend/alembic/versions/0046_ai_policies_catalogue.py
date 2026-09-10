"""The AI policies a course may apply, taken from the Provost's template.

"Other (Specify)" is deliberately absent: the point of managing these centrally is
that every syllabus draws on the same four, and a course needing a fifth gets it
added to the catalogue rather than written into one syllabus.

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-31
"""

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


AI_POLICIES = [{'description': 'The use of generative artificial intelligence tools (e.g., ChatGPT, Copilot, Gemini, '
                 'Claude, or similar tools) is prohibited. \n'
                 '\n'
                 'Verification mechanism used by the instructor : ……………………………………………………………………………………',
  'label': 'AI Prohibited'},
 {'description': 'Students may use generative artificial intelligence tools as support tools for:\n'
                 '☐ Brainstorming or generating initial ideas\n'
                 '☐ Language editing (grammar, spelling, style, and readability)\n'
                 '☐ Structuring or organizing ideas\n'
                 '☐ Clarifying concepts or obtaining explanations\n'
                 '☐ Other (please specify):\n'
                 '....................................................................................................................\n'
                 'However, AI-generated content should not be accepted uncritically. Students remain '
                 'responsible for verifying sources, checking factual accuracy, ensuring methodological '
                 'rigour, and complying with applicable academic citation and research ethics standards. All '
                 "submitted work must reflect the student's own reasoning, analysis, and intellectual "
                 'contribution. Students remain fully responsible for the accuracy, quality, originality, '
                 'and integrity of their submissions.',
  'label': 'AI Permitted as a Support Tool'},
 {'description': 'Generative artificial intelligence may be used only for the purposes explicitly identified '
                 'by the instructor. AI may be authorised for certain stages of the assessment (e.g., data '
                 'processing, language revision) but prohibited for others (e.g., substantive analysis, '
                 'interpretation, problem-solving, or final drafting). Students should carefully follow the '
                 'instructions applicable to each assessment.',
  'label': 'Restricted AI Use'},
 {'description': 'The use of generative artificial intelligence forms part of the learning objectives being '
                 'assessed. Students are expected to engage critically with approved AI tools as part of '
                 'this assessment. Students must remain capable of evaluating, verifying, and improving '
                 'AI-generated outputs.',
  'label': 'AI Required'}]


def upgrade() -> None:
    connection = op.get_bind()
    stamp = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    existing = {row[0] for row in connection.execute(sa.text("SELECT id FROM syllabus_catalogue_items"))}
    catalogue = sa.table(
        "syllabus_catalogue_items",
        sa.column("payload", postgresql.JSONB),
        *(
            sa.column(name)
            for name in (
                "id", "category", "parent_id", "label", "sort_order",
                "is_retired", "retired_at", "revision", "created_at", "updated_at",
            )
        ),
    )
    rows = [
        {
            "id": f"ai-policy-{index}",
            "category": "ai-policies",
            "parent_id": None,
            "label": policy["label"],
            "payload": {"description": policy["description"]},
            "sort_order": index,
            "is_retired": False,
            "retired_at": None,
            "revision": 1,
            "created_at": stamp,
            "updated_at": stamp,
        }
        for index, policy in enumerate(AI_POLICIES, start=1)
        if f"ai-policy-{index}" not in existing
    ]
    if rows:
        op.bulk_insert(catalogue, rows)


def downgrade() -> None:
    op.execute("DELETE FROM syllabus_catalogue_items WHERE category = 'ai-policies'")
