"""Put a production backup into this worktree's own database, to rehearse the syllabus conversion.

    ./dev.sh rehearse ~/Documents/coordinator-tools-backups/<YYYY-MM-DD_HHMM>

Temporary, like the conversion route it prepares for (ADR-003): removed with it.

It never talks to production. It reads a snapshot `backup_prod.py` already saved (made
through the app's read-only admin export), and writes only to the database DATABASE_URL
names, which must be on this machine and must not be a test database.

1. Steps this database back to the snapshot's schema revision, so the tables line up.
2. Replaces every copied table with the snapshot's rows (`table_copy.load_tables`).
3. Migrates forward to head: the November 2026 migrations run on production's own rows,
   which is part of what is being rehearsed.
4. Says how many syllabi there are and in which shape.

The conversion itself then goes through the local API, exactly as it will in production:
POST /api/v1/syllabi/convert-v2 with {"dryRun": true}, then false, then true again (the
second dry run must find nothing to do).
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from sorbonne.services.engine import engine_for
from sorbonne.services.table_copy import load_tables


def isolated_database() -> str:
    url = os.environ.get("DATABASE_URL", "")
    parsed = urlparse(url.replace("+psycopg", ""))
    name = parsed.path.lstrip("/")
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        sys.exit(f"Refusing: {parsed.hostname or url!r} is not this machine.")
    if not name or name.endswith("_test"):
        sys.exit(f"Refusing to load into {name or 'no database'}: the test suite empties test databases.")
    return url


def main(snapshot: Path) -> None:
    url = isolated_database()
    manifest = json.loads((snapshot / "manifest.json").read_text())
    tables = json.loads((snapshot / "database.json").read_text())
    revision = manifest["revision"]
    alembic = Config("alembic.ini")

    print(f"Snapshot {snapshot.name}: saved {manifest['savedAt']}, schema {revision}.")
    print(f"Into {urlparse(url.replace('+psycopg', '')).path.lstrip('/')} on this machine.")
    command.downgrade(alembic, revision)
    counts = load_tables(engine_for(url), tables, source_revision=revision)
    print(f"Loaded {sum(counts.values())} rows in {len(counts)} tables.")
    command.upgrade(alembic, "head")

    with engine_for(url).connect() as connection:
        shapes = Counter(
            (template, version or "1")
            for template, version in connection.execute(
                text("SELECT template_id, content_json ->> 'schemaVersion' FROM syllabi")
            )
        )
    for (template, version), count in sorted(shapes.items()):
        print(f"  {count} syllabi, template {template}, shape v{version}")


if __name__ == "__main__":
    if len(sys.argv) != 2:  # noqa: PLR2004
        sys.exit(__doc__)
    main(Path(sys.argv[1]).expanduser())
