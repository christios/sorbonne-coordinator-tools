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
names are a different matter. The department's own list — Active teachers, with their
e-mail addresses — is left behind unless `--teachers` is passed. The name typed on a
section always travels, because it is part of the timetabler's request and a copy without
it cannot show the request at all; it is a name and it is worth knowing that it moves.

What it copies, in the order the writes depend on one another:

  1. cohorts            so their ids exist to hang everything else from
  2. a view             the only route that creates students is a view's sync. Deleted
                        again afterwards: a view is a portal sync target, not a container
  3. students           the ids production holds
  4. their cohorts      because a view's sync writes cohort_id NULL
  5. discrepancy rules  without them every cohort reads "Nothing to flag", which looks
                        like good news and is an empty rulebook
  6. sets, courses,     one cohort at a time, keeping a production id -> local id map.
     groups, sections     A section travels with its request as well as its CRN — the
                          teacher the department confirmed, the hours, the anticipated
                          size, the room, day and time asked for, the constraints
  7. placements         which need every group above to exist first
  8. the register       active courses and CRNs, and the term link — what the checks
                        decide is "ours", and without them Active Courses is empty

Not copied: history, pull evidence, dismissals, timestamps and actors. Those live in the
browser, not on the server, and this copies the server. So the Cohorts page will still say
"N rules cannot be judged: no pull this browser holds carries student status" until you run
a Portal sync against localhost — the extension is already injected into
http://localhost:*/*, so that is the whole remedy.

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


def copy_everything(  # noqa: PLR0913 - one keyword per thing the caller may choose
    *,
    source: str = PROD,
    into: str = LOCAL,
    replace: bool = False,
    teachers: bool = False,
    dry_run: bool = False,
    say=print,
) -> dict[str, Any]:
    """The whole copy, once. The CLI and the dev-only route are both thin wrappers on this.

    One implementation, so there is one set of rules about what travels: no student names
    because the server holds none, and no staff names unless asked for.
    """
    into = local_only(into)
    source = source.rstrip("/")

    read_headers = {"Authorization": f"Bearer {token()}"}
    write_headers = {} if dry_run else _local_session()

    api = f"{source}/api/v1/student-database"
    here = f"{into}/api/v1/student-database"
    read = lambda path: call(f"{api}{path}", headers=read_headers)  # noqa: E731
    write = lambda path, body, method="POST": call(  # noqa: E731
        f"{here}{path}", headers=write_headers, method=method, body=body
    )

    if dry_run:
        say("DRY RUN — reading production, writing nothing.\n")

    # Writing into a database that already holds cohorts would duplicate every one of
    # them, and the second copy is indistinguishable from the first on screen. Refused
    # rather than merged: there is no sensible way to merge two copies of a cohort.
    if not dry_run:
        _make_room(here, into, write_headers, replace=replace, say=say)

    # ---------------------------------------------------------------- 1. cohorts
    cohorts = read("/cohorts")["cohorts"]
    say(f"cohorts: {len(cohorts)}")
    for cohort in cohorts:
        say(f"  {cohort['name']} ({cohort['memberCount']} members, {cohort['scopeCount']} sets)")
    cohort_id = {} if dry_run else _copy_cohorts(write, cohorts)

    # ------------------------------------------------- 2-4. students and cohorts
    students = read("/students")["students"]
    say(f"\nstudents: {len(students)} (ids and status only — the server holds no names)")
    placed_in_cohorts = 0
    if not dry_run:
        placed_in_cohorts = _copy_students(here, write_headers, write, students, cohort_id)
        say(f"  placed into cohorts: {placed_in_cohorts}")

    # ------------------------------------------------------- rules and register
    #
    # The rules are the whole reason the Cohorts page says anything. Without them a copy
    # of production reads "Nothing to flag" for every cohort, which looks like good news
    # and is actually an empty rulebook.
    rules = read("/discrepancy-rules")["rules"]
    say(f"\nrules: {len(rules)}")
    if not dry_run:
        _copy_rules(write, rules, cohort_id)

    say("\nsemesters:")
    terms = {} if dry_run else _term_map(source, into, read_headers, write_headers, say)

    # ------------------------------------- 5. sets, courses, groups and the CRNs
    #
    # Every catalogue first, THEN every placement, and one group map across all of them.
    # A set open to every cohort — the languages — is created once, under the cohort whose
    # row holds it, and the other three place their students into those same groups. Doing
    # a cohort end to end would drop those placements, because the group they name belongs
    # to a cohort that has not been reached yet, or was reached and forgotten.
    sets, group_id, placed, requests = _copy_plans(
        read, write, here, write_headers, cohorts, cohort_id, terms, say, dry_run=dry_run
    )

    where = {"source": source, "into": into, "read": read_headers, "write": write_headers}
    _copy_register(where, terms, say, dry_run=dry_run)

    if teachers and not dry_run:
        say("\nactive teachers: copying (this step carries staff names and e-mail addresses)")
        for row in call(f"{source}/api/v1/portal/active-teachers", headers=read_headers)["teachers"]:
            call(
                f"{into}/api/v1/portal/active-teachers",
                headers=write_headers,
                method="POST",
                body={"portalTeacherIds": [row["portalTeacherId"]] if row.get("portalTeacherId") else []},
            )
    elif not teachers:
        say("\nactive teachers: skipped (they carry names)")

    say("\nDone. Run a Portal sync against localhost to fill this browser's side.")
    return {
        "cohorts": len(cohorts),
        "students": len(students),
        "inCohorts": placed_in_cohorts,
        "sets": sets,
        "groups": len(group_id),
        "placements": placed,
        "sections": requests,
        "rules": len(rules),
        "teachers": teachers,
        "dryRun": dry_run,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--into", default=LOCAL, help="the local instance to write to")
    parser.add_argument("--from", dest="source", default=PROD, help="where to read from")
    parser.add_argument("--dry-run", action="store_true", help="say what would be written, write nothing")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="empty the local cohorts, students and register first. Without it, a second run duplicates them.",
    )
    parser.add_argument(
        "--teachers",
        action="store_true",
        help="also copy the active-teacher list. Off by default: it is the only step that carries names.",
    )
    arguments = parser.parse_args()
    copy_everything(
        source=arguments.source,
        into=arguments.into,
        replace=arguments.replace,
        teachers=arguments.teachers,
        dry_run=arguments.dry_run,
    )
    return 0


def _copy_plans(  # noqa: PLR0913 - the map it threads through is the point
    read, write, here, write_headers, cohorts, cohort_id, terms, say, *, dry_run: bool
) -> tuple[int, dict[str, str], int, int]:
    """Every catalogue, then every placement — in that order, and never per cohort.

    A set open to every cohort is created once, under the cohort whose row holds it, and
    the other three place their students into those same groups. Doing a cohort end to end
    drops those placements, because the group they name belongs to a cohort that has not
    been reached yet, or was reached and forgotten. That silently lost 154 of them once.
    """
    say("")
    group_id: dict[str, str] = {}
    sets = 0
    requests = 0
    for cohort in cohorts:
        catalogue = read(f"/cohorts/{cohort['id']}/catalogue")["scopes"]
        sets += len(catalogue)
        say(f"{cohort['name']}: {len(catalogue)} sets, {sum(len(s['groups']) for s in catalogue)} groups")
        if not dry_run:
            requests += _copy_catalogue(write, catalogue, cohort_id[cohort["id"]], terms, group_id)
    if requests:
        say(f"\nsections carrying a request: {requests}")
    if dry_run:
        return sets, group_id, 0, 0

    say("")
    placed = 0
    for cohort in cohorts:
        assignments = read(f"/cohorts/{cohort['id']}/assignments")["assignments"]
        here_placed = _copy_placements(here, write, write_headers, assignments, group_id)
        placed += here_placed
        say(f"{cohort['name']}: placed {here_placed}")
    return sets, group_id, placed, requests


def _copy_cohorts(write, cohorts: list[dict[str, Any]]) -> dict[str, str]:
    """The cohorts themselves. Returns production id -> local id, which everything else needs."""
    return {
        cohort["id"]: write(
            "/cohorts",
            {
                "name": cohort["name"],
                "term": cohort.get("term", ""),
                "notes": cohort.get("notes", ""),
                "majors": cohort.get("majors", []),
                "terms": cohort.get("terms", []),
                "yearLevel": cohort.get("yearLevel", ""),
            },
        )["id"]
        for cohort in cohorts
    }


def _copy_rules(write, rules: list[dict[str, Any]], cohort_id: dict[str, str]) -> None:
    """Replaced wholesale, which is the route's own shape and the only honest one.

    A local rulebook that has drifted from production's is worse than no rulebook: it
    flags things production does not and stays quiet about things it does, and every
    difference reads as a finding rather than as a stale copy.
    """
    write(
        "/discrepancy-rules",
        {
            "rules": [
                {
                    "field": rule["field"],
                    "kind": rule["kind"],
                    "values": rule.get("values", []),
                    # A rule for one cohort has to follow that cohort to its new id.
                    "cohortId": cohort_id.get(rule.get("cohortId", ""), ""),
                }
                for rule in rules
            ]
        },
        method="PUT",
    )


def _copy_register(where: dict[str, Any], terms: dict[str, str], say, *, dry_run: bool) -> None:
    """The department's own register: which courses and CRNs it answers for, and the term link.

    Without these the Active Courses page is empty and the registration check has nothing
    to judge against — it decides what is "ours" from exactly this list.
    """
    source, into = where["source"], where["into"]
    read_headers, write_headers = where["read"], where["write"]
    there = lambda path: call(f"{source}/api/v1/portal{path}", headers=read_headers)  # noqa: E731
    courses = there("/active-courses")["courses"]
    crns = there("/active-crns")["crns"]
    links = there("/term-links")["links"]
    say(f"\nregister: {len(courses)} courses, {len(crns)} CRNs, {len(links)} term link(s)")
    if dry_run:
        return
    call(
        f"{into}/api/v1/portal/active-courses",
        headers=write_headers,
        method="POST",
        body={"courseCodes": sorted({row["courseCode"] for row in courses if row.get("courseCode")}), "byHand": []},
    )
    call(
        f"{into}/api/v1/portal/active-crns",
        headers=write_headers,
        method="POST",
        body={
            "courseCodes": [],
            "crns": [
                {"termCode": row.get("termCode", ""), "crn": row["crn"], "courseCode": row.get("courseCode", "")}
                for row in crns
                if row.get("crn")
            ],
        },
    )
    # `links` is {term id: portal term code}, and the term id is production's — so it
    # goes through the same name-matched map the sets do, or the link points at nothing.
    for prod_term, portal_code in links.items():
        here_term = terms.get(prod_term)
        if here_term:
            call(
                f"{into}/api/v1/portal/term-links/{here_term}",
                headers=write_headers,
                method="PUT",
                body={"portalTermCode": portal_code},
            )


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
        # The department's own planning, then the register it is judged against. The
        # register has to go too: adding to it is additive by design, so a second copy
        # without this leaves a union of both — 42 courses where production has 31.
        tables = (
            "group_assignments", "group_crns", "scope_groups", "scope_courses", "cohort_scopes",
            "active_course_crns", "active_courses", "term_links",
        )
        for table in tables:
            connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed names, no interpolation of input
        connection.execute(text("DELETE FROM students"))
        connection.execute(text("DELETE FROM student_cohorts"))


VIEW_NAME = "Copied from production — delete me"


def _copy_students(
    here: str, headers: dict[str, str], write, students: list[dict[str, Any]], cohort_id: dict[str, str]
) -> int:
    """The ids, then who belongs where — a view's sync writes cohort_id NULL, so it is two steps.

    The view is made, used and then DELETED, because a view is not a container: it is a
    portal sync target. One left behind puts a list called "Copied from production" in the
    Portal sync button for ever after, and the next sync dutifully asks the registrar for
    it. Deleting it drops the membership rows and nothing else — the students stay, and so
    do their cohorts. Verified: 2,976 students and 314 placements survived it.
    """
    view = write("/views", {"name": VIEW_NAME, "description": "", "filter": {}})
    try:
        write(f"/views/{view['id']}/sync", {"studentIds": [row["studentId"] for row in students]})
        by_cohort: dict[str, list[str]] = {}
        for row in students:
            if row.get("cohortId"):
                by_cohort.setdefault(row["cohortId"], []).append(row["studentId"])
        for prod_id, ids in by_cohort.items():
            if prod_id in cohort_id:
                write("/students/cohort", {"studentIds": ids, "cohortId": cohort_id[prod_id]})
        return sum(len(ids) for ids in by_cohort.values())
    finally:
        # In a finally, because a half-finished copy that leaves a sync target behind is
        # worse than a half-finished copy.
        call(f"{here}/views/{view['id']}", headers=headers, method="DELETE")


def _term_map(
    source: str, into: str, read_headers: dict[str, str], write_headers: dict[str, str], say
) -> dict[str, str]:
    """Production's semester ids to this machine's, matched by name.

    A set's `term_id` names a semester of the Student Hub, and the two Hubs are different
    deployments with different ids — so copying the id verbatim attaches every set to a
    semester that does not exist here, and the sets are invisible without a single error.
    Names are matched loosely because they are not written identically either: production
    says "Semester 1 2026-27" where this machine says "Semester 1".
    """
    there = call(f"{source}/api/v1/timetables/terms", headers=read_headers)["terms"]
    here = call(f"{into}/api/v1/timetables/terms", headers=write_headers)["terms"]
    fold = lambda name: "".join(ch for ch in name.lower() if ch.isalnum())  # noqa: E731
    mapped: dict[str, str] = {}
    for term in there:
        match = next(
            (row for row in here if fold(row["name"]) == fold(term["name"])),
            next((row for row in here if fold(row["name"]) in fold(term["name"])), None),
        )
        if match:
            mapped[term["id"]] = match["id"]
            say(f"  {term['name']} -> {match['name']}")
        else:
            say(f"  {term['name']} -> NOTHING HERE. Its sets will be copied but invisible.")
    return mapped


#: Everything a section carries beyond its CRN and the name on it — the timetabler's
#: request. `PUT` on the cell writes the CRN and the name; the rest is a `PATCH`, and
#: leaving it out copied production as a grid of CRNs with the request stripped out of it.
#: Measured on production the day this was fixed: 141 sections, of which 81 named a teacher
#: the department had confirmed, 139 a duration, 134 an anticipated size and 25 a
#: constraint. None of it arrived, so Teacher hours read "Not confirmed" for everybody.
REQUEST_FIELDS = (
    "teacherId",
    "hours",
    "sessionsPerWeek",
    "duration",
    "weeks",
    "anticipated",
    "roomPref",
    "dayPref",
    "timePref",
    "constraints",
    "comments",
    "retired",
)


def _request_of(cell: dict[str, Any]) -> dict[str, Any]:
    """The section's request, as the PATCH takes it — only what is actually said."""
    return {field: cell[field] for field in REQUEST_FIELDS if cell.get(field) not in ("", 0, False, None)}


def _copy_catalogue(
    write, catalogue: list[dict[str, Any]], here_cohort: str, terms: dict[str, str], group_id: dict[str, str]
) -> int:
    """The sets, their courses, their groups and the CRNs in them.

    Fills `group_id` (production id -> local id) and returns how many sections carried a
    request. A set, a course, a group and a section each travel with everything the API
    will take: the nesting, the component, and the timetabler's request. Anything left
    behind here is silently missing from the copy, and reads on screen as a fact about
    production rather than as a gap in this script.
    """
    scope_id: dict[str, str] = {}
    requests = 0
    # Parents before children, so a nested set's parent already exists to be named.
    for scope in sorted(catalogue, key=lambda row: bool(row.get("parentScopeId"))):
        made = write(
            f"/cohorts/{here_cohort}/scopes",
            {
                "code": scope["code"],
                "name": scope.get("name", ""),
                "note": scope.get("note", ""),
                "termId": terms.get(scope.get("termId", ""), scope.get("termId", "")),
                "kind": scope.get("kind", "shared"),
                "openToAll": bool(scope.get("openToAll")),
                "parentScopeId": scope_id.get(scope.get("parentScopeId", ""), ""),
            },
        )
        scope_id[scope["id"]] = made["id"]
        course_id = {
            course["id"]: write(
                f"/scopes/{made['id']}/courses",
                {
                    "code": course["code"],
                    "name": course.get("name", ""),
                    # Which of the course's parts this set is — CM, TD, TP. Every course in
                    # production carries one, and without it a card cannot say what it is.
                    "component": course.get("component", ""),
                },
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
                    # A nested set's group sits inside one of the parent's, which was
                    # written above — the parent set comes first in the loop.
                    "parentGroupId": group_id.get(group.get("parentGroupId", ""), ""),
                },
            )["id"]
            group_id[group["id"]] = here_group
            for prod_course, cell in (group.get("crns") or {}).items():
                if cell.get("crn") and prod_course in course_id:
                    at = f"/groups/{here_group}/courses/{course_id[prod_course]}"
                    write(at, {"crn": cell["crn"], "teacher": cell.get("teacher", "")}, method="PUT")
                    request = _request_of(cell)
                    if request:
                        write(at, request, method="PATCH")
                        requests += 1
    return requests


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
