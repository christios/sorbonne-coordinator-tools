"""Which apps a person may open, and what they may do inside each.

Two different questions used to have one answer. Whether somebody administers *accounts* is
not the same as whether they maintain the *syllabus catalogue*, and neither says they should
be reading the student roster. Each app asks about itself.

Whoever administers accounts is exempt: they can open everything and administer everything,
because the person who hands out access cannot be locked out of what they are handing out.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine, text

from sorbonne.config import config


#: "teachers" was one of these until the part-time teacher database became a page of
#: Students and Timetables. A grant left over from then is simply not returned, which is
#: what makes it harmless: it grants access to nothing, because nothing asks about it.
APPS = ("syllabus", "database", "handbook")
ADMIN = "admin"
MEMBER = "member"
ROLES = frozenset({ADMIN, MEMBER})


def normalise_role(value: str | None) -> str:
    written = (value or "").strip().lower()
    return written if written in ROLES else MEMBER


class AccountAccess:
    """What each invited person may open, one row per person per app."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def apps_for(self, email: str) -> dict[str, str]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT app, role FROM account_apps WHERE email = :email"),
                {"email": email.strip().casefold()},
            ).all()
        return {app: role for app, role in rows if app in APPS}

    def all_apps(self) -> dict[str, dict[str, str]]:
        """Everyone's access at once, so a list of accounts needs one query rather than many."""
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT email, app, role FROM account_apps")).all()
        access: dict[str, dict[str, str]] = {}
        for email, app, role in rows:
            if app in APPS:
                access.setdefault(email, {})[app] = role
        return access

    def set_apps(self, email: str, apps: dict[str, str]) -> dict[str, str]:
        """Replace what this person may open. An app left out is an app taken away."""
        address = email.strip().casefold()
        wanted = {app: normalise_role(role) for app, role in apps.items() if app in APPS}
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM account_apps WHERE email = :email"), {"email": address})
            for app, role in wanted.items():
                connection.execute(
                    text("INSERT INTO account_apps (email, app, role) VALUES (:email, :app, :role)"),
                    {"email": address, "app": app, "role": role},
                )
        return wanted


# One per process, not one per request: this owns a connection pool, and building a fresh one
# for every call leaves its connections behind. A dev server left up for three days had sixty
# idle connections against the database and no room for the tests to open their own.
@lru_cache(maxsize=1)
def account_access() -> AccountAccess:
    return AccountAccess(config.database_url)


def may_open(access: dict[str, str], app: str, *, platform_admin: bool) -> bool:
    return platform_admin or app in access


def administers(access: dict[str, str], app: str, *, platform_admin: bool) -> bool:
    return platform_admin or access.get(app) == ADMIN


def granted(access: dict[str, str], *, platform_admin: bool) -> dict[str, Any]:
    """What to tell the browser, so the workspace offers only what this person may open."""
    if platform_admin:
        return {app: ADMIN for app in APPS}
    return {app: role for app, role in access.items() if app in APPS}
