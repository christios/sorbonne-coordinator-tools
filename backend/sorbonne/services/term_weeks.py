"""Where each semester's Week 1 is, so the timetable can say "Week 5".

One date per semester, set by an administrator in Settings. Any day of the first teaching
week will do; the week it falls in is Week 1, and the page counts from its Monday.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine


class InvalidWeekOne(ValueError):
    """Not a date the timetable can count from — said in words."""


class TermWeeks:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def all(self) -> dict[str, str]:
        """`semester id -> the day Week 1 falls in`, for every semester that has one."""
        with self.engine.connect() as connection:
            return dict(connection.execute(text("SELECT term_id, week_one FROM term_weeks")).all())

    def set(self, term_id: str, week_one: str, *, actor: str = "") -> None:
        """Say where a semester's Week 1 is; a blank date takes it away."""
        day = (week_one or "").strip()
        with self.engine.begin() as connection:
            if not day:
                connection.execute(text("DELETE FROM term_weeks WHERE term_id = :term"), {"term": term_id})
                return
            try:
                date.fromisoformat(day)
            except ValueError as exc:
                raise InvalidWeekOne(f"{day!r} is not a date. Write it as 2026-08-31.") from exc
            connection.execute(
                text("""INSERT INTO term_weeks (term_id, week_one, updated_at, updated_by)
                        VALUES (:term, :day, :at, :by)
                        ON CONFLICT (term_id) DO UPDATE SET week_one = excluded.week_one,
                                                            updated_at = excluded.updated_at,
                                                            updated_by = excluded.updated_by"""),
                {"term": term_id, "day": day, "at": datetime.now(UTC).isoformat(), "by": actor},
            )
