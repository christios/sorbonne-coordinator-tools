"""Tokens for callers that cannot hold a session cookie.

A coordinator signs in with Google and the browser keeps an HttpOnly cookie, which is
exactly what a script cannot do. A token is the other way in: made by a signed-in
coordinator, sent as `Authorization: Bearer <token>`, and carrying that coordinator's
identity and nothing more. Whether they are still admitted, and whether they administer
the application, is read from the staff list on every request just as it is for the
cookie — so a token outlives neither the person's access nor their expiry date.

Only a hash of the token is kept. The token itself exists once, in the answer to the
request that made it; if it is lost it is revoked and another is made.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, text

from sorbonne.services.staff_auth import StaffUser, admission

#: What every token starts with, so one can be recognised on sight in a log or a file.
PREFIX = "scen_"
#: How much of it the list shows, which is enough to tell two apart and not enough to use.
SHOWN = 12
MAX_LIFETIME_DAYS = 365
DEFAULT_LIFETIME_DAYS = 90
#: A write per request would be a write per request; the last use is not that precious.
TOUCH_AFTER_SECONDS = 60


class TokenRejected(Exception):
    """The token is not one this deployment will act on, and why."""


@dataclass(frozen=True)
class MintedToken:
    """A new token: the record, and the secret that will not be shown again."""

    token: str
    record: dict[str, Any]


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(token: str) -> str:
    return sha256(token.strip().encode()).hexdigest()


def _row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "prefix": row["prefix"],
        "email": row["email"],
        "createdAt": row["created_at"],
        "expiresAt": row["expires_at"],
        "lastUsedAt": row["last_used_at"],
        "revokedAt": row["revoked_at"],
    }


class ApiTokenStore:
    def __init__(self, database_url: str) -> None:
        self.engine = create_engine(database_url, pool_pre_ping=True)

    def mint(self, *, name: str, email: str, days: int = DEFAULT_LIFETIME_DAYS) -> MintedToken:
        """Make a token for one coordinator. Shown once, kept as a hash."""
        cleaned = " ".join(str(name or "").split()) or "Untitled token"
        lifetime = max(1, min(int(days or DEFAULT_LIFETIME_DAYS), MAX_LIFETIME_DAYS))
        token = f"{PREFIX}{secrets.token_urlsafe(30)}"
        record = {
            "id": str(uuid4()),
            "name": cleaned[:120],
            "token_hash": _hash(token),
            "prefix": token[:SHOWN],
            "email": email.strip().casefold(),
            "created_at": _now().isoformat(),
            "expires_at": (_now() + timedelta(days=lifetime)).isoformat(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO api_tokens
                            (id, name, token_hash, prefix, email, created_at, expires_at, last_used_at, revoked_at)
                        VALUES (:id, :name, :token_hash, :prefix, :email, :created_at, :expires_at, '', '')"""),
                record,
            )
        return MintedToken(token=token, record={**_row({**record, "last_used_at": "", "revoked_at": ""})})

    def list_for(self, email: str, *, everyone: bool = False) -> list[dict[str, Any]]:
        """A coordinator's own tokens; an administrator may see everybody's."""
        clause = "" if everyone else " WHERE email = :email"
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"SELECT * FROM api_tokens{clause} ORDER BY created_at DESC"),  # noqa: S608
                    {} if everyone else {"email": email.strip().casefold()},
                )
                .mappings()
                .all()
            )
        return [_row(row) for row in rows]

    def revoke(self, token_id: str, *, email: str, everyone: bool = False) -> None:
        """Stop a token working. Kept in the list, so it is clear it once existed."""
        clause = "" if everyone else " AND email = :email"
        with self.engine.begin() as connection:
            revoked = connection.execute(
                text(f"""UPDATE api_tokens SET revoked_at = :now
                         WHERE id = :id AND revoked_at = ''{clause}"""),  # noqa: S608
                {
                    "id": token_id,
                    "now": _now().isoformat(),
                    **({} if everyone else {"email": email.strip().casefold()}),
                },
            ).rowcount
        if revoked == 0:
            raise TokenRejected("That token is not one of yours, or it was revoked already.")

    def user_for(self, token: str) -> StaffUser | None:
        """Who is calling, or nothing at all.

        A token says who made it; it does not say what they may do. That is read from the
        staff list here, the same question the session cookie is asked on every request,
        so access taken away in Settings is access taken away from the token.
        """
        if not token or not token.strip().startswith(PREFIX):
            return None
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("SELECT * FROM api_tokens WHERE token_hash = :hash"), {"hash": _hash(token)}
                )
                .mappings()
                .first()
            )
            if row is None or row["revoked_at"]:
                return None
            if row["expires_at"] and row["expires_at"] <= _now().isoformat():
                return None
            email = row["email"]
            # The same question the cookie is asked: somebody removed from the staff list
            # loses their tokens with their sign-in.
            access = admission(email) if email else None
            if access is None:
                return None
            self._touch(connection, row)
        return StaffUser(email=email, name=email, is_admin=access.is_admin)

    @staticmethod
    def _touch(connection: Any, row: Any) -> None:
        now = _now()
        last = row["last_used_at"]
        if last:
            try:
                if (now - datetime.fromisoformat(last)).total_seconds() < TOUCH_AFTER_SECONDS:
                    return
            except ValueError:
                pass
        connection.execute(
            text("UPDATE api_tokens SET last_used_at = :now WHERE id = :id"),
            {"id": row["id"], "now": now.isoformat()},
        )
