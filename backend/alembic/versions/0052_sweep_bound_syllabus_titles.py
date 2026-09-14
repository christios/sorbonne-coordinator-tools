"""Bring a bound syllabus's title into line with the corrected course title.

A syllabus that is bound to a course borrows that course's title. The registrar's
export is inconsistently capitalised, and titles borrowed before the catalogue began
raising them kept the lower-case form.

Only syllabi that are bound are touched, and only where the stored title differs from
the corrected one by capitalisation alone. A title that differs in any other way is
the coordinator's own and is left exactly as it is.

Revision ID: 0052
Revises: 0051
Create Date: 2026-09-11
"""

import json

from alembic import op
import sqlalchemy as sa


# Copied rather than imported: a migration must keep doing what it did when it ran,
# even if the application's rule for capitalising a title later changes.
_MINOR_WORDS = frozenset(
    {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"}
)


def course_title_case(title: str) -> str:
    words = title.split(" ")
    result = []
    for index, word in enumerate(words):
        if not word or not word.islower() or (index and word in _MINOR_WORDS):
            result.append(word)
            continue
        result.append(word[0].upper() + word[1:])
    return " ".join(result)


def corrected_title(stored: str, catalogue: str) -> str:
    """The title to store, or "" to leave the syllabus alone.

    Capitalisation only: a title differing in any other way is the coordinator's own.
    """
    corrected = course_title_case(catalogue)
    if not corrected or not stored or stored == corrected:
        return ""
    return corrected if stored.casefold() == corrected.casefold() else ""


revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    titles = {
        str(code): str(title or "")
        for code, title in connection.execute(
            sa.text("SELECT course_code, MIN(course_title) FROM course_catalogue_entries GROUP BY course_code")
        )
    }
    if not titles:
        return
    for syllabus_id, stored_title, content in connection.execute(
        sa.text("SELECT id, course_title, content_json FROM syllabi")
    ):
        payload = json.loads(content) if isinstance(content, str) else dict(content)
        identification = payload.get("identification")
        if not isinstance(identification, dict):
            continue
        bound = str(identification.get("catalogueCourseCode") or "")
        corrected = corrected_title(str(stored_title or ""), titles.get(bound, ""))
        if not corrected:
            continue
        connection.execute(
            sa.text("UPDATE syllabi SET course_title = :title WHERE id = :id"),
            {"title": corrected, "id": syllabus_id},
        )


def downgrade() -> None:
    """Capitalisation is content once corrected; restoring it would invent a title."""
