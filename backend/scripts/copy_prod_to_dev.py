"""Copy production's cohorts, sets, groups and placements into a local database.

    uv run python scripts/copy_prod_to_dev.py --dry-run
    uv run python scripts/copy_prod_to_dev.py

Why this shape, since a database dump would be one command: the house rule is that
production data moves through the application's own API, and this keeps it. It reads with
the API token already on this machine and writes to a local instance with a session minted
by `dev_session.py`, so no production database URL is needed and none is created.

**No student names travel, because the server holds none.** `students` is ids and status;
`sync_registrations` states and enforces "only ids and CRNs are written". Names live in the
coordinator's browser, and this copies the server, so there is nothing to redact. Staff
names are a different matter and are left behind unless `--teachers` is passed.

What it copies, in the order the writes depend on one another:

  1. cohorts            so their ids exist to hang everything else from
  2. a view             the only route that creates students is a view's sync
  3. students           the ids production holds
  4. their cohorts      because a view's sync writes cohort_id NULL
  5. sets, courses,     one cohort at a time, keeping a production id -> local id map
     groups, CRNs
  6. placements         which need every group above to exist first

Not copied: history, pull evidence, dismissals, timestamps and actors. Those live in the
browser or are not worth forging. Run a Portal sync against localhost afterwards to fill
the browser side — the extension is already injected into http://localhost:*/*.

NEVER point this at `sorbonne_test`. `backend/tests/conftest.py` runs `alembic upgrade
head` against TEST_DATABASE_URL session-wide, and two autouse fixtures DELETE from thirteen
tables. One pytest run would destroy the copy.
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

from sqlalchemy import create_engine, text

from sorbonne.config import config
from sorbonne.services.staff_auth import SESSION_COOKIE, StaffUser, issue_session, owner_emails

PROD = "https://sorbonne-coordinator-tools.fastapicloud.dev"
LOCAL = "http://localhost:8000"
TOKEN_FILE = Path.home() / ".config" / "sorbonne-token.env"
# Cloudflare rejects urllib's default user agent with error 1010.
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) copy_prod_to_dev"


class Refused(Exception):
    """A safety rule said no. Never caught; the message is the whole point."""


def local_only(url: str) -> str:
    """The one guard that matters: this script writes, and only ever to this machine.

    A mistyped host here would replay production's cohorts into production, or into
    whatever else answered. Checked by hostname rather than by prefix, because
    "http://localhost.example.com" starts with the right letters.
    """
    host = urlparse(url).hostname or ""
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise Refused(f"Refusing to write to {host or url!r}: this script only ever writes to this machine.")
    return url.rstrip("/")


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
        with urllib.request.urlopen(request, timeout=120) as answer:  # noqa: S310
            raw = answer.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise Refused(f"{method} {urlparse(url).path} -> {error.code}. {detail}") from error


def main() -> int:  # noqa: PLR0915 - one straight line of steps, read top to bottom
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--into", default=LOCAL, help="the local instance to write to")
    parser.add_argument("--from", dest="source", default=PROD, help="where to read from")
    parser.add_argument("--dry-run", action="store_true", help="say what would be written, write nothing")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="empty the local cohorts, students and views first. Without it, a second run duplicates everything.",
    )
    parser.add_argument(
        "--teachers",
        action="store_true",
        help="also copy the active-teacher list. Off by default: it is the only step that carries names.",
    )
    arguments = parser.parse_args()

    into = local_only(arguments.into)
    source = arguments.source.rstrip("/")

    read_headers = {"Authorization": f"Bearer {token()}"}
    write_headers = {} if arguments.dry_run else _local_session()

    api = f"{source}/api/v1/student-database"
    here = f"{into}/api/v1/student-database"
    read = lambda path: call(f"{api}{path}", headers=read_headers)  # noqa: E731
    write = lambda path, body, method="POST": call(  # noqa: E731
        f"{here}{path}", headers=write_headers, method=method, body=body
    )

    say = print
    if arguments.dry_run:
        say("DRY RUN — reading production, writing nothing.\n")

    # Writing into a database that already holds cohorts would duplicate every one of
    # them, and the second copy is indistinguishable from the first on screen. Refused
    # rather than merged: there is no sensible way to merge two copies of a cohort.
    if not arguments.dry_run:
        _make_room(here, into, write_headers, replace=arguments.replace, say=say)

    # ---------------------------------------------------------------- 1. cohorts
    cohorts = read("/cohorts")["cohorts"]
    say(f"cohorts: {len(cohorts)}")
    cohort_id: dict[str, str] = {}
    for cohort in cohorts:
        say(f"  {cohort['name']} ({cohort['memberCount']} members, {cohort['scopeCount']} sets)")
        if arguments.dry_run:
            continue
        made = write(
            "/cohorts",
            {
                "name": cohort["name"],
                "term": cohort.get("term", ""),
                "notes": cohort.get("notes", ""),
                "majors": cohort.get("majors", []),
                "terms": cohort.get("terms", []),
                "yearLevel": cohort.get("yearLevel", ""),
            },
        )
        cohort_id[cohort["id"]] = made["id"]

    # ------------------------------------------------- 2-4. students and cohorts
    students = read("/students")["students"]
    say(f"\nstudents: {len(students)} (ids and status only — the server holds no names)")
    if not arguments.dry_run:
        say(f"  placed into cohorts: {_copy_students(here, write_headers, write, students, cohort_id)}")

    # ------------------------------------- 5. sets, courses, groups and the CRNs
    #
    # Every catalogue first, THEN every placement, and one group map across all of them.
    # A set open to every cohort — the languages — is created once, under the cohort whose
    # row holds it, and the other three place their students into those same groups. Doing
    # a cohort end to end would drop those placements, because the group they name belongs
    # to a cohort that has not been reached yet, or was reached and forgotten.
    say("")
    group_id: dict[str, str] = {}
    for cohort in cohorts:
        catalogue = read(f"/cohorts/{cohort['id']}/catalogue")["scopes"]
        groups = sum(len(scope["groups"]) for scope in catalogue)
        say(f"{cohort['name']}: {len(catalogue)} sets, {groups} groups")
        if arguments.dry_run:
            continue
        group_id.update(_copy_catalogue(write, catalogue, cohort_id[cohort["id"]]))

    if not arguments.dry_run:
        say("")
        for cohort in cohorts:
            assignments = read(f"/cohorts/{cohort['id']}/assignments")["assignments"]
            placed = _copy_placements(here, write, write_headers, assignments, group_id)
            say(f"{cohort['name']}: placed {placed}")

    if arguments.teachers and not arguments.dry_run:
        say("\nactive teachers: copying (this step carries staff names and e-mail addresses)")
        for row in call(f"{source}/api/v1/portal/active-teachers", headers=read_headers)["teachers"]:
            call(
                f"{into}/api/v1/portal/active-teachers",
                headers=write_headers,
                method="POST",
                body={"portalTeacherIds": [row["portalTeacherId"]] if row.get("portalTeacherId") else []},
            )
    elif not arguments.teachers:
        say("\nactive teachers: skipped (pass --teachers to copy them; they carry names)")

    say("\nDone. Run a Portal sync against localhost to fill this browser's side.")
    return 0


def _local_session() -> dict[str, str]:
    """A staff cookie for this machine, signed the way the real gate signs one.

    It exercises the gate rather than bypassing it: the e-mail must be on
    COORDINATOR_ACCESS_EMAILS and the signature must match this deployment's secret.
    """
    if not config.session_secret:
        raise Refused("SESSION_SECRET is not set in backend/.env, so no local session can be minted.")
    email = next(iter(sorted(owner_emails())), "")
    if not email:
        raise Refused("COORDINATOR_ACCESS_EMAILS is empty, so nobody may sign in locally.")
    return {"Cookie": f"{SESSION_COOKIE}={issue_session(StaffUser(email=email, name='copy'))}"}


def _make_room(here: str, into: str, headers: dict[str, str], *, replace: bool, say) -> None:
    """Refuse to write into a database that already holds a copy, unless told to replace it."""
    held = call(f"{here}/cohorts", headers=headers)["cohorts"]
    if not held:
        return
    if not replace:
        raise Refused(
            f"{into} already holds {len(held)} cohorts. Pass --replace to empty them first, "
            "or point --into at an empty instance."
        )
    _empty_local(into)
    say(f"emptied {len(held)} cohorts and their students from {into}\n")


def _empty_local(into: str) -> None:
    """Clear the local copy, straight through the local database.

    Direct SQL, not the API, because there is no route that deletes a cohort's students
    and none should exist. Safe here for the one reason that matters: `into` has already
    been through `local_only`, and this reads its URL from this machine's own .env — it
    has no way to reach anything but this laptop.
    """
    local_only(into)
    url = config.database_url
    if urlparse(url.replace("postgresql+psycopg://", "postgresql://")).hostname not in {"localhost", "127.0.0.1"}:
        raise Refused(f"DATABASE_URL does not point at this machine: {url.split('@')[-1]}")
    with create_engine(url).begin() as connection:
        for table in ("group_assignments", "group_crns", "scope_groups", "scope_courses", "cohort_scopes"):
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed names, no interpolation of input
        connection.execute(text("DELETE FROM students"))
        connection.execute(text("DELETE FROM student_cohorts"))


VIEW_NAME = "Copied from production"


def _copy_students(
    here: str, headers: dict[str, str], write, students: list[dict[str, Any]], cohort_id: dict[str, str]
) -> int:
    """The ids, then who belongs where — a view's sync writes cohort_id NULL, so it is two steps.

    The view is reused when it is already there. --replace empties the data, not the
    containers, and a view is a saved question rather than a copy of anything; re-creating
    it would fail on its name and re-syncing it asks exactly what it asked before.
    """
    held = [view for view in call(f"{here}/views", headers=headers)["views"] if view["name"] == VIEW_NAME]
    view = held[0] if held else write("/views", {"name": VIEW_NAME, "description": "", "filter": {}})
    write(f"/views/{view['id']}/sync", {"studentIds": [row["studentId"] for row in students]})
    by_cohort: dict[str, list[str]] = {}
    for row in students:
        if row.get("cohortId"):
            by_cohort.setdefault(row["cohortId"], []).append(row["studentId"])
    for prod_id, ids in by_cohort.items():
        if prod_id in cohort_id:
            write("/students/cohort", {"studentIds": ids, "cohortId": cohort_id[prod_id]})
    return sum(len(ids) for ids in by_cohort.values())


def _copy_catalogue(write, catalogue: list[dict[str, Any]], here_cohort: str) -> dict[str, str]:
    """The sets, their courses, their groups and the CRNs in them. Returns prod id -> local id."""
    group_id: dict[str, str] = {}
    # Parents before children, so a nested set's parent already exists.
    for scope in sorted(catalogue, key=lambda row: bool(row.get("parentScopeId"))):
        made = write(
            f"/cohorts/{here_cohort}/scopes",
            {
                "code": scope["code"],
                "name": scope.get("name", ""),
                "note": scope.get("note", ""),
                "termId": scope.get("termId", ""),
                "kind": scope.get("kind", "shared"),
                "openToAll": bool(scope.get("openToAll")),
            },
        )
        course_id = {
            course["id"]: write(
                f"/scopes/{made['id']}/courses",
                {"code": course["code"], "name": course.get("name", "")},
            )["id"]
            for course in scope["courses"]
        }
        for group in scope["groups"]:
            here_group = write(
                f"/scopes/{made['id']}/groups",
                {
                    "label": group["label"],
                    "capacity": group.get("capacity", 0),
                    "note": group.get("note", ""),
                    "program": group.get("program", ""),
                },
            )["id"]
            group_id[group["id"]] = here_group
            for prod_course, cell in (group.get("crns") or {}).items():
                if cell.get("crn") and prod_course in course_id:
                    write(
                        f"/groups/{here_group}/courses/{course_id[prod_course]}",
                        {"crn": cell["crn"], "teacher": cell.get("teacher", "")},
                        method="PUT",
                    )
    return group_id


def _copy_placements(
    here: str, write, headers: dict[str, str], assignments: dict[str, Any], group_id: dict[str, str]
) -> int:
    """Who sits where. One request per group, since that is what the route takes."""
    want: dict[str, list[str]] = {}
    for student, by_scope in assignments.items():
        for prod_group in by_scope.values():
            if prod_group in group_id:
                want.setdefault(prod_group, []).append(student)
    placed = 0
    for prod_group, ids in want.items():
        scope_here = _scope_of(here, headers, group_id[prod_group])
        if scope_here:
            report = write(
                f"/scopes/{scope_here}/assignments",
                {"studentIds": ids, "groupId": group_id[prod_group]},
                method="PUT",
            )
            placed += report.get("assigned", 0)
    return placed


def _scope_of(here: str, headers: dict[str, str], group_id: str) -> str:
    """Which local set a local group belongs to. Cached, because it is asked per group."""
    if group_id in _scope_of.cache:  # type: ignore[attr-defined]
        return _scope_of.cache[group_id]  # type: ignore[attr-defined]
    cards = call(f"{here}/course-cards", headers=headers)["cohorts"]
    for cohort in cards:
        for scope in cohort["scopes"]:
            for group in scope["groups"]:
                _scope_of.cache[group["id"]] = scope["id"]  # type: ignore[attr-defined]
    return _scope_of.cache.get(group_id, "")  # type: ignore[attr-defined]


_scope_of.cache = {}  # type: ignore[attr-defined]


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as refusal:
        print(f"\n{refusal}", file=sys.stderr)
        sys.exit(1)
