"""Who writes the course learning outcomes, for the whole department (November 2026 review).

    teacher   each syllabus writes its own CLOs, aligned to the PLOs the curriculum mapping
              expects of its course
    hod       the Head of Department writes each course's CLOs and their alignment in the
              catalogue's curriculum mapping; syllabi show them read-only

Switching never deletes anything: a syllabus keeps the CLOs its teacher wrote, hidden in
"hod" and shown again in "teacher".
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

TEACHER = "teacher"
HEAD_OF_DEPARTMENT = "hod"
MODES = (TEACHER, HEAD_OF_DEPARTMENT)


class UnknownOutcomeMode(ValueError):
    """Not one of the two ways of writing outcomes."""


class SyllabusOutcomeMode:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def read(self) -> dict[str, Any]:
        """The mode, and who last set it — "teacher" and blank while nobody has chosen."""
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT mode, updated_at, updated_by FROM syllabus_outcome_mode WHERE id = 1"))
                .mappings()
                .first()
            )
        if row is None:
            return {"mode": TEACHER, "updatedAt": "", "updatedBy": ""}
        return {"mode": row["mode"], "updatedAt": row["updated_at"], "updatedBy": row["updated_by"]}

    def set(self, mode: str, *, actor: str = "") -> dict[str, Any]:
        if mode not in MODES:
            raise UnknownOutcomeMode(
                "Choose who writes the course learning outcomes: teachers or the Head of Department."
            )
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO syllabus_outcome_mode (id, mode, updated_at, updated_by)
                        VALUES (1, :mode, :at, :by)
                        ON CONFLICT (id) DO UPDATE
                        SET mode = EXCLUDED.mode,
                            updated_at = EXCLUDED.updated_at,
                            updated_by = EXCLUDED.updated_by"""),
                {"mode": mode, "at": datetime.now(UTC).isoformat(timespec="seconds"), "by": actor},
            )
        return self.read()
