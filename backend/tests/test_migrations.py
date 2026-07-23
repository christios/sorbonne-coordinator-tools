import os
from unittest.mock import patch

from sorbonne.services.migrations import apply_schema_migrations


def test_applies_migrations_with_the_configured_database_url(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with patch("sorbonne.services.migrations.command.upgrade") as upgrade:
        apply_schema_migrations("postgresql+psycopg://user:password@db.example.edu/syllabus")

    migration_config, revision = upgrade.call_args.args
    assert migration_config.get_main_option("sqlalchemy.url") == "postgresql+psycopg://user:password@db.example.edu/syllabus"
    assert revision == "head"
    assert "DATABASE_URL" not in os.environ


def test_restores_an_existing_database_url_after_migration(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://existing")

    with patch("sorbonne.services.migrations.command.upgrade"):
        apply_schema_migrations("postgresql+psycopg://replacement")

    assert os.environ["DATABASE_URL"] == "postgresql+psycopg://existing"
