"""Make this machine's database production's: every table, every row, ids and all.

    uv run python scripts/copy_prod_to_dev.py --dry-run
    uv run python scripts/copy_prod_to_dev.py

The house rule is that production data moves through the application's own API, and this
keeps it: production is only ever read, through its admin-only export, with the API token
already on this machine. No production database URL is needed and none is created.

It used to copy features — cohorts, then students, then rules, then sets, some thirty steps
each translating production's ids into local ones — and every table added after a step was
written was a table it silently left behind. A survey found half the schema missing:
warning dismissals, cancellations and covers, the registrar's removed and added classes,
comments, student history, tasks, syllabi, users. Each absence looked, on a developer's
screen, like a bug in a page. Now it copies tables. See `sorbonne/services/table_copy.py`
for what travels, what does not, and why.

**No student names travel, because the server holds none.** Staff names and contact
details do; API tokens do not, being credentials.

It writes straight into this machine's database, which is what makes it an exact copy: the
local API would hand out new ids, and ids are what every other table points with. That is
also why it is so careful about which database this is.

NEVER point this at `sorbonne_test`. `backend/tests/conftest.py` runs `alembic upgrade
head` against TEST_DATABASE_URL session-wide, and two autouse fixtures DELETE from thirteen
tables. One pytest run would destroy the copy — and this would destroy the tests' database.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.table_copy import SchemaMismatch, load_tables

PROD = "https://sorbonne-coordinator-tools.fastapicloud.dev"
LOCAL = "http://localhost:8000"
TOKEN_FILE = Path.home() / ".config" / "sorbonne-token.env"
# Cloudflare rejects urllib's default user agent with error 1010.
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) copy_prod_to_dev"


class Refused(Exception):
    """A safety rule said no, or the far end would not answer. The message is the point."""

    def __init__(self, message: str, *, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


def local_only(url: str) -> str:
    """The one guard that matters: this writes, and only ever to this machine.

    By hostname rather than by prefix, because "localhost.example.com" starts with the
    right letters.
    """
    host = urlparse(url.replace("+psycopg", "")).hostname or ""
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise Refused(f"Refusing to write to {host or url!r}: this only ever writes to this machine.")
    return url.rstrip("/")


def local_database(url: str) -> str:
    """This machine's database, and not the one the tests wipe."""
    local_only(url)
    name = urlparse(url.replace("+psycopg", "")).path.lstrip("/")
    if name == "sorbonne_test" or name.endswith("_test"):
        raise Refused(f"Refusing to copy into {name}: the test suite empties it on every run.")
    return url


def token() -> str:
    if not TOKEN_FILE.exists():
        raise Refused(f"No API token at {TOKEN_FILE}. It is read, never printed.")
    for line in TOKEN_FILE.read_text().splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "SORBONNE_TOKEN":
            return value.strip().strip('"').strip("'")
    raise Refused(f"{TOKEN_FILE} has no SORBONNE_TOKEN.")


def call(url: str, *, headers: dict[str, str], method: str = "GET", body: Any = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)  # noqa: S310 - http(s) only, checked above
    request.add_header("User-Agent", AGENT)
    for key, value in headers.items():
        request.add_header(key, value)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=300) as answer:  # noqa: S310
            raw = answer.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise Refused(f"{method} {urlparse(url).path} -> {error.code}. {detail}", code=error.code) from error


def copy_everything(
    *,
    source: str = PROD,
    database_url: str | None = None,
    dry_run: bool = False,
    say=print,
) -> dict[str, Any]:
    """The whole copy, once. The CLI and the dev-only route are both thin wrappers on this.

    Everything production would give is read before anything here is touched, and the load
    is one transaction: a copy that fails halfway leaves this machine as it was, not half
    production's.
    """
    url = local_database(database_url or config.database_url)
    source = source.rstrip("/")
    headers = {"Authorization": f"Bearer {token()}"}

    listing = call(f"{source}/api/v1/export", headers=headers)
    tables = listing["tables"]
    say(f"production is at revision {listing['revision']}: {len(tables)} tables, "
        f"{sum(table['rows'] for table in tables)} rows")
    for name, reason in sorted(listing.get("excluded", {}).items()):
        say(f"  left behind: {name} — {reason}")

    payload: dict[str, dict[str, Any]] = {}
    for table in tables:
        payload[table["name"]] = call(f"{source}/api/v1/export/{table['name']}", headers=headers)
        say(f"  read {table['name']}: {len(payload[table['name']]['rows'])}")

    if dry_run:
        say("\nDRY RUN — nothing written.")
        return {"dryRun": True, "revision": listing["revision"], "tables": {t["name"]: t["rows"] for t in tables}}

    try:
        loaded = load_tables(engine_for(url), payload, source_revision=listing["revision"])
    except SchemaMismatch as mismatch:
        raise Refused(str(mismatch)) from mismatch
    say(f"\nDone: {len(loaded)} tables, {sum(loaded.values())} rows, exactly as production holds them.")
    return {"dryRun": False, "revision": listing["revision"], "tables": loaded, "rows": sum(loaded.values())}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="source", default=PROD, help="where to read from")
    parser.add_argument("--dry-run", action="store_true", help="read everything, write nothing")
    arguments = parser.parse_args()
    try:
        copy_everything(source=arguments.source, dry_run=arguments.dry_run)
    except Refused as refusal:
        print(refusal, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
