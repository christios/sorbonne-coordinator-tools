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

The Student Hub is not copied: it is an application of its own, and this machine's Hub has
semesters it imported itself, under ids of its own. Production's sets, week counts and
portal links name production's semesters, which this Hub has never heard of — the sets
arrived and no semester showed them. So production's semesters are paired with this
Hub's by name, and the copy is written naming this Hub's.

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


def _named(term: dict[str, Any]) -> str:
    return " ".join(str(term.get("name", "")).lower().split())


def _begins(a: str, b: str) -> bool:
    return bool(a and b) and (a.startswith(f"{b} ") or b.startswith(f"{a} "))


#: How a production semester is recognised here, most certain first.
_SAME = (
    lambda theirs, ours: _named(theirs) == _named(ours),
    # "Semester 1" here for production's "Semester 1 2026-27".
    lambda theirs, ours: _begins(_named(theirs), _named(ours)),
    lambda theirs, ours: bool(theirs.get("timetableFilename"))
    and theirs.get("timetableFilename") == ours.get("timetableFilename"),
)


def semester_pairs(production: list[dict[str, Any]], here: list[dict[str, Any]]) -> tuple[dict[str, str], list[str]]:
    """Production's semesters paired with this Hub's: {production's id: this Hub's id}.

    The same id needs no pairing — a Hub pointed at production's has them all. Otherwise
    the same name, then a name that begins with the other, then the same timetable file.
    A rule that finds two candidates pairs nothing rather than guess, and no semester here
    is paired twice. The second answer names production's semesters left unpaired.
    """
    ours = {term["id"] for term in here}
    taken = {term["id"] for term in production if term["id"] in ours}
    pairs: dict[str, str] = {}
    unpaired: list[str] = []
    for theirs in production:
        if theirs["id"] in ours:
            continue
        match = None
        for same in _SAME:
            found = [term for term in here if term["id"] not in taken and same(theirs, term)]
            if found:
                match = found[0] if len(found) == 1 else None
                break
        if match is None:
            unpaired.append(str(theirs.get("name") or theirs["id"]))
            continue
        pairs[theirs["id"]] = match["id"]
        taken.add(match["id"])
    return pairs, unpaired


def hub_semesters() -> list[dict[str, Any]] | None:
    """This machine's Student Hub semesters, or None when no Hub is set up here."""
    if not config.scen_student_platform_url or not config.scen_student_platform_token:
        return None
    hub = config.scen_student_platform_url.rstrip("/")
    try:
        listing = call(f"{hub}/api/v1/admin/terms", headers={"X-Admin-Token": config.scen_student_platform_token})
    except (Refused, OSError) as failure:
        raise Refused(
            f"This machine's Student Hub ({urlparse(hub).netloc}) is not answering, so production's "
            "semesters cannot be matched to its own. Start it (./dev.sh start) and copy again."
        ) from failure
    return listing.get("terms", []) if isinstance(listing, dict) else []


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

    theirs = call(f"{source}/api/v1/timetables/terms", headers=headers).get("terms", [])
    ours = hub_semesters()
    pairs, unpaired = semester_pairs(theirs, ours) if ours is not None else ({}, [])
    names = {term["id"]: term.get("name", "") for term in [*theirs, *(ours or [])]}
    semesters = {
        "paired": [{"production": names[a], "here": names[b]} for a, b in pairs.items()],
        "unpaired": unpaired,
    }
    for pair in semesters["paired"]:
        say(f"  semester: production's {pair['production']!r} is {pair['here']!r} here")
    for name in unpaired:
        say(f"  semester: production's {name!r} has no match on this machine's Student Hub")

    if dry_run:
        say("\nDRY RUN — nothing written.")
        return {
            "dryRun": True,
            "revision": listing["revision"],
            "tables": {t["name"]: t["rows"] for t in tables},
            "semesters": semesters,
        }

    try:
        loaded = load_tables(engine_for(url), payload, source_revision=listing["revision"], renames=pairs)
    except SchemaMismatch as mismatch:
        raise Refused(str(mismatch)) from mismatch
    say(f"\nDone: {len(loaded)} tables, {sum(loaded.values())} rows, exactly as production holds them.")
    return {
        "dryRun": False,
        "revision": listing["revision"],
        "tables": loaded,
        "rows": sum(loaded.values()),
        "semesters": semesters,
    }


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
