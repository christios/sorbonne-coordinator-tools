"""The department's programmes — Settings → Programmes.

The programmes are the department's students' — the ones its groups and cohorts are
written in, "MATH - Mathematics", "PHYS - Physics" — each under the code it means when
admissions has recoded it (MATS means MATH: the programme_codes list, which every comparison
of a student's programme reads). Each has an official name the department may write, which
the registrar's "Mathematics" is not, and the course codes that count as it, by
prefix: MATH's are MATH and CPSC. A course whose code says nothing useful — the Foundation
Year's Mathematics Readiness, SCEN-102 — can be put in one by hand, or in none, by code, so
any course the plan has can be, whether or not it is on the list of active courses.

Read by every page that narrows its courses to a programme; changed by an administrator,
since it changes what those pages show everybody.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from sorbonne.services.programme_codes import as_code, same_as_map

#: A course said to belong to no programme, whatever its code.
NONE = "NONE"
PREFIX = re.compile(r"^[A-Z0-9]{1,10}$")
COURSE_CODE = re.compile(r"^[A-Z0-9][A-Z0-9 _-]{0,29}$")


class InvalidCourseProgram(ValueError):
    """Prefixes, or a course's programme, that cannot be kept — said in words."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _prefixes(raw: list[str]) -> list[str]:
    """["math", " cpsc- "] → ["MATH", "CPSC"]: uppercase, once each, in the order given."""
    said: list[str] = []
    for value in raw:
        prefix = str(value or "").strip().upper().rstrip("-")
        if not prefix:
            continue
        if not PREFIX.match(prefix):
            raise InvalidCourseProgram(f"{prefix!r} is not the start of a course code, like MATH or PHYS.")
        if prefix not in said:
            said.append(prefix)
    return said


def _written(raw: str) -> list[str]:
    """A cohort's programmes as stored: a JSON list of codes or "CODE - Name" strings."""
    try:
        held = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(value) for value in held] if isinstance(held, list) else []


def _named(written: str) -> str:
    """ "MATH - Mathematics" → "Mathematics"; a bare code has no name."""
    found = re.search(r"\s+-\s+(.+)$", written.strip())
    return found.group(1).strip() if found else ""


MOST_NAME = 120


def programmes(connection: Connection) -> list[dict[str, str]]:
    """The department's programmes: code and the registrar's name, once under the code each means.

    From what its groups' sub-rows and its cohorts are written in, and any programme the
    department has written something for — a name, course codes, a code meaning it — so a
    programme does not vanish from the list the day its last group is deleted.
    """
    same_as = same_as_map(connection)
    named: dict[str, str] = {}

    def hold(written: str) -> None:
        code = as_code(written)
        if not code:
            return
        meant = same_as.get(code.casefold(), code.casefold()).upper()
        name = _named(written)
        # The name its own code is written with wins over a recoded one's.
        if name and (meant not in named or not named[meant] or code == meant):
            named[meant] = name
        else:
            named.setdefault(meant, "")

    for (program,) in connection.execute(text("SELECT DISTINCT program FROM group_majors")).all():
        hold(str(program or ""))
    for (written,) in connection.execute(text("SELECT DISTINCT major_codes FROM student_cohorts")).all():
        for program in _written(str(written or "")):
            hold(program)
    for table, column in (
        ("programme_course_prefixes", "programme"),
        ("programme_names", "programme"),
        ("programme_codes", "same_as"),
    ):
        for (code,) in connection.execute(text(f"SELECT DISTINCT {column} FROM {table}")).all():  # noqa: S608
            named.setdefault(str(code).upper(), "")
    return [{"code": code, "registrarName": named[code]} for code in sorted(named)]


class CoursePrograms:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def state(self) -> dict[str, Any]:
        """Each programme — its names, the codes that mean it, its course codes — and every course put by hand.

        `name` is what the pages' filters call it, short: the registrar's "Mathematics", the
        official name where the registrar gives none, the code when there is neither. The
        official name — "Bachelor of Science in Mathematics" — is beside it, for what is
        written out in full.
        """
        with self.engine.connect() as connection:
            official = dict(connection.execute(text("SELECT programme, official_name FROM programme_names")).all())
            aliases: dict[str, list[str]] = {}
            for code, meant in connection.execute(
                text("SELECT code, same_as FROM programme_codes ORDER BY code")
            ).all():
                aliases.setdefault(str(meant).upper(), []).append(str(code).upper())
            prefixes: dict[str, list[str]] = {}
            for prefix, programme in connection.execute(
                text("SELECT prefix, programme FROM programme_course_prefixes ORDER BY prefix")
            ).all():
                prefixes.setdefault(str(programme), []).append(str(prefix))
            courses = connection.execute(
                text("SELECT course_code, programme FROM course_programs ORDER BY course_code")
            ).all()
            return {
                "programmes": [
                    {
                        "code": programme["code"],
                        "name": programme["registrarName"] or official.get(programme["code"]) or programme["code"],
                        "officialName": official.get(programme["code"], ""),
                        "registrarName": programme["registrarName"],
                        "aliases": aliases.get(programme["code"], []),
                        "prefixes": prefixes.get(programme["code"], []),
                    }
                    for programme in programmes(connection)
                ],
                "courses": {str(code): str(programme) for code, programme in courses},
            }

    def _known(self, connection: Connection, code: str) -> str:
        said = str(code or "").strip().upper()
        if said not in {programme["code"] for programme in programmes(connection)}:
            raise InvalidCourseProgram(f"{said or 'A blank'!r} is not one of the department's programmes.")
        return said

    def set_prefixes(self, programme: str, prefixes: list[str], *, actor: str = "") -> dict[str, Any]:
        """The course codes that count as a programme, by how they start — none of another programme's."""
        said = _prefixes(prefixes)
        with self.engine.begin() as connection:
            code = self._known(connection, programme)
            # A prefix is one programme's at most: it is the row's key.
            taken = connection.execute(
                text(
                    "SELECT prefix, programme FROM programme_course_prefixes WHERE programme <> :code ORDER BY prefix"
                ),
                {"code": code},
            ).all()
            clash = [(prefix, other) for prefix, other in taken if prefix in said]
            if clash:
                prefix, other = clash[0]
                raise InvalidCourseProgram(f"{prefix} already counts as {other}.")
            kept = connection.execute(
                text("SELECT prefix FROM programme_course_prefixes WHERE programme = :code"), {"code": code}
            ).scalars()
            gone = [prefix for prefix in kept if prefix not in said]
            if gone:
                connection.execute(
                    text("DELETE FROM programme_course_prefixes WHERE programme = :code AND prefix = ANY(:gone)"),
                    {"code": code, "gone": gone},
                )
            for prefix in said:
                connection.execute(
                    text(
                        """INSERT INTO programme_course_prefixes (prefix, programme, set_at, set_by)
                           VALUES (:prefix, :code, :now, :actor)
                           ON CONFLICT (prefix) DO NOTHING"""
                    ),
                    {"prefix": prefix, "code": code, "now": _now(), "actor": actor},
                )
        return self.state()

    def set_official_name(self, programme: str, official_name: str, *, actor: str = "") -> dict[str, Any]:
        """The programme's official name — "Bachelor of Science in Mathematics" — or "" for none."""
        said = re.sub(r"\s+", " ", str(official_name or "")).strip()
        if len(said) > MOST_NAME:
            raise InvalidCourseProgram(f"A programme's official name is {MOST_NAME} characters at most.")
        with self.engine.begin() as connection:
            code = self._known(connection, programme)
            if not said:
                connection.execute(text("DELETE FROM programme_names WHERE programme = :code"), {"code": code})
            else:
                connection.execute(
                    text(
                        """INSERT INTO programme_names (programme, official_name, set_at, set_by)
                           VALUES (:code, :name, :now, :actor)
                           ON CONFLICT (programme)
                           DO UPDATE SET official_name = excluded.official_name,
                                         set_at = excluded.set_at,
                                         set_by = excluded.set_by"""
                    ),
                    {"code": code, "name": said, "now": _now(), "actor": actor},
                )
        return self.state()

    def put_course(self, course_code: str, programme: str, *, actor: str = "") -> dict[str, Any]:
        """Say which programme a course belongs to — or NONE — whatever its code says."""
        code = str(course_code or "").strip().upper()
        if not COURSE_CODE.match(code):
            raise InvalidCourseProgram(f"{code or 'A blank'!r} is not a course code.")
        with self.engine.begin() as connection:
            said = NONE if str(programme or "").strip().upper() == NONE else self._known(connection, programme)
            connection.execute(
                text(
                    """INSERT INTO course_programs (course_code, programme, set_at, set_by)
                       VALUES (:code, :programme, :now, :actor)
                       ON CONFLICT (course_code)
                       DO UPDATE SET programme = excluded.programme,
                                     set_at = excluded.set_at,
                                     set_by = excluded.set_by"""
                ),
                {"code": code, "programme": said, "now": _now(), "actor": actor},
            )
        return self.state()

    def clear_course(self, course_code: str) -> dict[str, Any]:
        """Back to what the course's code says."""
        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM course_programs WHERE course_code = :code"),
                {"code": str(course_code or "").strip().upper()},
            )
        return self.state()
