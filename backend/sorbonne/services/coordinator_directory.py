"""Who may sign in to Coordinator Tools.

COORDINATOR_ACCESS_EMAILS names the people who own the deployment: they are always
admitted and always administrators, so a database mishap can never lock everyone
out of the application. Everybody else is invited here, by an administrator, and
can be promoted, suspended, or removed without a redeploy.

Every request through the sign-in gate asks this module whether the caller is
still admitted, so answers are cached for a few seconds; a change made through the
API clears the cache at once, which is what an administrator watching the screen
expects to see.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from sorbonne.config import config

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CACHE_SECONDS = 15


class AccountNotFound(Exception):
    pass


class AccountAlreadyInvited(Exception):
    pass


class InvalidEmail(Exception):
    pass


@dataclass(frozen=True)
class Access:
    """What the directory says about one address: admitted, and how far."""

    is_admin: bool


def normalize_email(email: str) -> str:
    address = email.strip().casefold()
    if not EMAIL_PATTERN.match(address):
        raise InvalidEmail(f"{email.strip() or 'That address'} is not an e-mail address.")
    return address


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _account(row: Any) -> dict[str, Any]:
    return {
        "email": row.email,
        "name": row.name,
        "isAdmin": row.is_admin,
        "isActive": row.is_active,
        "invitedBy": row.invited_by,
        "createdAt": row.created_at,
        "lastSeenAt": row.last_seen_at,
    }


class CoordinatorDirectory:
    """PostgreSQL persistence for invited coordinator accounts."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(database_url, pool_pre_ping=True)

    def list_accounts(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT * FROM coordinator_accounts ORDER BY is_active DESC, email")
            ).all()
        return [_account(row) for row in rows]

    def invite(self, email: str, *, is_admin: bool = False, invited_by: str = "") -> dict[str, Any]:
        address = normalize_email(email)
        try:
            with self.engine.begin() as connection:
                row = connection.execute(
                    text(
                        """
                        INSERT INTO coordinator_accounts (email, name, is_admin, is_active, invited_by, created_at)
                        VALUES (:email, '', :is_admin, TRUE, :invited_by, :created_at)
                        RETURNING *
                        """
                    ),
                    {
                        "email": address,
                        "is_admin": is_admin,
                        "invited_by": invited_by.strip().casefold(),
                        "created_at": _timestamp(),
                    },
                ).one()
        except IntegrityError as exc:
            raise AccountAlreadyInvited(f"{address} has already been invited.") from exc
        forget(address)
        return _account(row)

    def update(self, email: str, *, is_admin: bool | None = None, is_active: bool | None = None) -> dict[str, Any]:
        address = normalize_email(email)
        assignments = {"is_admin": is_admin, "is_active": is_active}
        changes = {column: value for column, value in assignments.items() if value is not None}
        if not changes:
            return self.get(address)

        clauses = ", ".join(f"{column} = :{column}" for column in changes)
        with self.engine.begin() as connection:
            row = connection.execute(
                text(f"UPDATE coordinator_accounts SET {clauses} WHERE email = :email RETURNING *"),
                {"email": address, **changes},
            ).one_or_none()
        if row is None:
            raise AccountNotFound(f"{address} is not on the staff list.")
        forget(address)
        return _account(row)

    def remove(self, email: str) -> None:
        address = normalize_email(email)
        with self.engine.begin() as connection:
            removed = connection.execute(
                text("DELETE FROM coordinator_accounts WHERE email = :email RETURNING email"),
                {"email": address},
            ).one_or_none()
        if removed is None:
            raise AccountNotFound(f"{address} is not on the staff list.")
        forget(address)

    def get(self, email: str) -> dict[str, Any]:
        address = normalize_email(email)
        with self.engine.connect() as connection:
            row = connection.execute(
                text("SELECT * FROM coordinator_accounts WHERE email = :email"), {"email": address}
            ).one_or_none()
        if row is None:
            raise AccountNotFound(f"{address} is not on the staff list.")
        return _account(row)

    def access(self, email: str) -> Access | None:
        """None for anybody this directory does not admit — unknown or suspended alike."""
        with self.engine.connect() as connection:
            row = connection.execute(
                text("SELECT is_admin, is_active FROM coordinator_accounts WHERE email = :email"),
                {"email": email.strip().casefold()},
            ).one_or_none()
        if row is None or not row.is_active:
            return None
        return Access(is_admin=row.is_admin)

    def record_sign_in(self, email: str, name: str) -> None:
        """Remember the display name and the moment, for anyone the directory holds."""
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE coordinator_accounts SET name = :name, last_seen_at = :seen_at
                    WHERE email = :email
                    """
                ),
                {"email": email.strip().casefold(), "name": name, "seen_at": _timestamp()},
            )


_cache: dict[str, tuple[float, Access | None]] = {}


@lru_cache(maxsize=1)
def directory() -> CoordinatorDirectory:
    """The one directory this process talks to, opened on first use."""
    return CoordinatorDirectory(config.database_url)


def forget(email: str | None = None) -> None:
    """Drop cached answers, so a change of access takes effect on the next request."""
    if email is None:
        _cache.clear()
    else:
        _cache.pop(email.strip().casefold(), None)


def access_for(email: str, *, now: float | None = None) -> Access | None:
    address = email.strip().casefold()
    moment = now if now is not None else time.monotonic()
    cached = _cache.get(address)
    if cached is not None and cached[0] > moment:
        return cached[1]

    access = directory().access(address)
    _cache[address] = (moment + CACHE_SECONDS, access)
    return access
