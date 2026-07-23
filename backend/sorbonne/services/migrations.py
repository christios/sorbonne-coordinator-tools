from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config


def apply_schema_migrations(database_url: str) -> None:
    """Bring the configured database schema to the revision required by this app."""
    original_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        migration_config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        migration_config.set_main_option("sqlalchemy.url", database_url)
        command.upgrade(migration_config, "head")
    finally:
        if original_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_database_url
