"""One-time, idempotent transfer of the prototype's SQLite syllabus data to PostgreSQL."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3

from sqlalchemy import create_engine, text


DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "data" / "syllabi.sqlite3"
DEFAULT_DATABASE_URL = "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne"


def migrate(source: Path, database_url: str) -> tuple[int, int]:
    if not source.is_file():
        raise FileNotFoundError(f"SQLite syllabus database not found: {source}")

    sqlite_connection = sqlite3.connect(source)
    sqlite_connection.row_factory = sqlite3.Row
    syllabi = sqlite_connection.execute("SELECT * FROM syllabi").fetchall()
    history = sqlite_connection.execute("SELECT * FROM syllabus_field_history").fetchall()
    sqlite_connection.close()

    engine = create_engine(database_url, pool_pre_ping=True)
    with engine.begin() as connection:
        for row in syllabi:
            connection.execute(
                text(
                    """
                    INSERT INTO syllabi (
                        id, series_id, course_title, course_code, academic_year, content_json,
                        revision, created_at, updated_at
                    ) VALUES (
                        :id, :series_id, :course_title, :course_code, :academic_year,
                        CAST(:content_json AS JSONB), :revision, :created_at, :updated_at
                    ) ON CONFLICT (id) DO NOTHING
                    """
                ),
                dict(row),
            )
        for row in history:
            connection.execute(
                text(
                    """
                    INSERT INTO syllabus_field_history (
                        syllabus_id, field_path, previous_value_json, new_value_json, revision, changed_at
                    ) SELECT
                        :syllabus_id, :field_path, CAST(:previous_value_json AS JSONB),
                        CAST(:new_value_json AS JSONB), :revision, :changed_at
                    WHERE NOT EXISTS (
                        SELECT 1 FROM syllabus_field_history
                        WHERE syllabus_id = :syllabus_id AND field_path = :field_path
                          AND revision = :revision AND changed_at = :changed_at
                    )
                    """
                ),
                dict(row),
            )
    return len(syllabi), len(history)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    args = parser.parse_args()
    syllabi, history = migrate(args.source, args.database_url)
    print(f"Migrated {syllabi} syllabi and {history} field-history entries.")


if __name__ == "__main__":
    main()
