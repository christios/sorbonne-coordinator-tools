"""Claude, connected as a coordinator who allowed it to read.

A custom connector in Claude reaches this application the way any OAuth client reaches a
server: it registers itself, sends the coordinator here to allow it, and trades the code
that comes back for a key. This module is the registering, the allowing and the keys. It
is kept apart from API tokens because nobody copies these: Claude holds them and renews
them itself, which is what lets a coordinator who cannot install anything connect at all.

Everything it hands out is read-only. A key lasts an hour. The refresh that renews it is
replaced every time it is used and lapses after thirty days unused, so a stolen one works
once at most. Whether the coordinator is still on the staff list is asked on every
request, as it is for the cookie, so taking somebody off the list disconnects Claude too.

Only Claude may register: its hosted callback, or the loopback one Claude Code uses on a
port of its own. A client that could name any address could have this page send a
coordinator's code wherever it liked.

Only hashes of the codes and keys are kept.
"""

from __future__ import annotations

import base64
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

from sqlalchemy import text
from starlette.requests import Request

from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser, admission

#: What a connector's key starts with, so the gate knows where to look it up.
ACCESS_PREFIX = "scenc_"
REFRESH_PREFIX = "scenr_"
CODE_LIFETIME = timedelta(minutes=5)
ACCESS_LIFETIME = timedelta(hours=1)
REFRESH_LIFETIME = timedelta(days=30)
#: Where claude.ai, the Desktop app and the phone all come back to.
HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1"})
SCOPE = "read"
#: A write per request would be a write per request; the last use is not that precious.
TOUCH_AFTER_SECONDS = 60
#: RFC 7636's bounds on a code verifier.
VERIFIER_LENGTHS = range(43, 129)
#: Where the connector answers; what a coordinator pastes into Claude ends with it.
MCP_PATH = "/mcp"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "testserver"})


class RegistrationRejected(Exception):
    """A client this deployment will not register, and why."""


class GrantRejected(Exception):
    """A code or a refresh this deployment will not honour. OAuth calls it invalid_grant."""


@dataclass(frozen=True)
class IssuedKeys:
    access_token: str
    refresh_token: str
    expires_in: int

    def as_response(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "token_type": "Bearer",
            "expires_in": self.expires_in,
            "refresh_token": self.refresh_token,
            "scope": SCOPE,
        }


def _now() -> datetime:
    return datetime.now(UTC)


def public_base(request: Request) -> str:
    """This deployment's address as Claude reaches it.

    Behind the host's proxy the request arrives as plain http, so anything that is not
    this machine is https: that is the only way Claude can reach it.
    """
    host = request.url.netloc
    scheme = request.url.scheme if (request.url.hostname or "") in LOCAL_HOSTS else "https"
    return f"{scheme}://{host}"


def resource_metadata_url(request: Request) -> str:
    """Where a 401 from the connector tells Claude to start signing in."""
    return f"{public_base(request)}/.well-known/oauth-protected-resource{MCP_PATH}"


def _hash(value: str) -> str:
    return sha256(value.strip().encode()).hexdigest()


def _loopback(uri: str) -> tuple[str, str] | None:
    """`(host, path)` for a Claude Code callback on any port, or None for anything else."""
    parts = urlsplit(uri)
    if parts.scheme != "http" or parts.hostname not in LOOPBACK_HOSTS or parts.query or parts.fragment:
        return None
    return parts.hostname, parts.path


def callback_allowed(uri: str) -> bool:
    """Whether a client may register this address to be sent back to."""
    if uri == HOSTED_CALLBACK:
        return True
    loopback = _loopback(uri)
    return loopback is not None and loopback[1] == "/callback"


def callback_matches(registered: list[str], given: str) -> bool:
    """Whether `given` is one of the registered callbacks — a loopback one on any port."""
    if given in registered:
        return True
    wanted = _loopback(given)
    return wanted is not None and any(_loopback(uri) == wanted for uri in registered)


def pkce_matches(verifier: str, challenge: str) -> bool:
    """S256, the only method offered: the challenge is the verifier's hash."""
    if len(verifier) not in VERIFIER_LENGTHS:
        return False
    digest = base64.urlsafe_b64encode(sha256(verifier.encode()).digest()).decode().rstrip("=")
    return secrets.compare_digest(digest, challenge)


def _grant(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "clientName": row["client_name"],
        "email": row["email"],
        "createdAt": row["created_at"],
        "lastUsedAt": row["last_used_at"],
        "revokedAt": row["revoked_at"],
        # The connection lapses when its renewal does, unless Claude renews it first.
        "expiresAt": row["refresh_expires_at"],
    }


class ConnectorStore:
    def __init__(self, database_url: str) -> None:
        self.engine = engine_for(database_url)

    # ------------------------------------------------------------- registering

    def register(self, *, name: str, redirect_uris: list[str]) -> dict[str, Any]:
        """Dynamic client registration (RFC 7591), for Claude's callbacks only."""
        uris = [str(uri).strip() for uri in redirect_uris or [] if str(uri).strip()]
        if not uris:
            raise RegistrationRejected("Name at least one redirect URI.")
        refused = [uri for uri in uris if not callback_allowed(uri)]
        if refused:
            raise RegistrationRejected(f"Only Claude may connect here, and {refused[0]} is not Claude's.")
        record = {
            "id": str(uuid4()),
            "name": " ".join(str(name or "").split())[:120] or "Claude",
            "redirect_uris": json.dumps(uris),
            "created_at": _now().isoformat(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO oauth_clients (id, name, redirect_uris, created_at)
                        VALUES (:id, :name, :redirect_uris, :created_at)"""),
                record,
            )
        return {"id": record["id"], "name": record["name"], "redirectUris": uris}

    def client(self, client_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM oauth_clients WHERE id = :id"), {"id": client_id or ""})
                .mappings()
                .first()
            )
        if row is None:
            return None
        return {"id": row["id"], "name": row["name"], "redirectUris": json.loads(row["redirect_uris"])}

    # ------------------------------------------------------------- allowing

    def issue_code(self, *, client_id: str, email: str, redirect_uri: str, code_challenge: str) -> str:
        """What the coordinator's "Allow" sends back to Claude. One use, five minutes."""
        code = secrets.token_urlsafe(32)
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO oauth_codes
                            (code_hash, client_id, email, redirect_uri, code_challenge, created_at, expires_at, used_at)
                        VALUES (:code_hash, :client_id, :email, :redirect_uri, :code_challenge, :created_at,
                                :expires_at, '')"""),
                {
                    "code_hash": _hash(code),
                    "client_id": client_id,
                    "email": email.strip().casefold(),
                    "redirect_uri": redirect_uri,
                    "code_challenge": code_challenge,
                    "created_at": _now().isoformat(),
                    "expires_at": (_now() + CODE_LIFETIME).isoformat(),
                },
            )
        return code

    def redeem(self, *, client_id: str, code: str, redirect_uri: str, verifier: str) -> IssuedKeys:
        """A code for keys, once, by the client it was issued to and with its verifier."""
        # Spent, and that committed, before it is checked: a code tried with the wrong
        # verifier or by the wrong client is gone too, not left for a second guess.
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("SELECT * FROM oauth_codes WHERE code_hash = :hash FOR UPDATE"), {"hash": _hash(code or "")}
                )
                .mappings()
                .first()
            )
            if row is not None and not row["used_at"] and row["expires_at"] > _now().isoformat():
                connection.execute(
                    text("UPDATE oauth_codes SET used_at = :now WHERE code_hash = :hash"),
                    {"now": _now().isoformat(), "hash": row["code_hash"]},
                )
            else:
                row = None
        if row is None:
            raise GrantRejected("That code is unknown, used or expired.")
        if row["client_id"] != client_id or row["redirect_uri"] != redirect_uri:
            raise GrantRejected("That code was not issued to this client.")
        if not pkce_matches(verifier or "", row["code_challenge"]):
            raise GrantRejected("The code verifier does not match.")
        if admission(row["email"]) is None:
            raise GrantRejected("That coordinator is no longer on the staff list.")
        with self.engine.begin() as connection:
            client = connection.execute(
                text("SELECT name FROM oauth_clients WHERE id = :id"), {"id": client_id}
            ).scalar()
            keys = self._keys()
            connection.execute(
                text("""INSERT INTO connector_grants
                            (id, client_id, client_name, email, created_at, last_used_at, revoked_at,
                             access_hash, access_expires_at, refresh_hash, refresh_expires_at)
                        VALUES (:id, :client_id, :client_name, :email, :now, '', '',
                                :access_hash, :access_expires_at, :refresh_hash, :refresh_expires_at)"""),
                {
                    "id": str(uuid4()),
                    "client_id": client_id,
                    "client_name": client or "Claude",
                    "email": row["email"],
                    "now": _now().isoformat(),
                    **self._hashes(keys),
                },
            )
        return keys

    def refresh(self, *, client_id: str, refresh_token: str) -> IssuedKeys:
        """New keys for a refresh, which is then spent: each one renews the connection once."""
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("SELECT * FROM connector_grants WHERE refresh_hash = :hash FOR UPDATE"),
                    {"hash": _hash(refresh_token or "")},
                )
                .mappings()
                .first()
            )
            if row is None or row["revoked_at"] or row["refresh_expires_at"] <= _now().isoformat():
                raise GrantRejected("That refresh is unknown, revoked or expired.")
            if row["client_id"] != client_id:
                raise GrantRejected("That refresh was not issued to this client.")
            if admission(row["email"]) is None:
                raise GrantRejected("That coordinator is no longer on the staff list.")
            keys = self._keys()
            connection.execute(
                text("""UPDATE connector_grants
                        SET access_hash = :access_hash, access_expires_at = :access_expires_at,
                            refresh_hash = :refresh_hash, refresh_expires_at = :refresh_expires_at
                        WHERE id = :id"""),
                {"id": row["id"], **self._hashes(keys)},
            )
        return keys

    @staticmethod
    def _keys() -> IssuedKeys:
        return IssuedKeys(
            access_token=f"{ACCESS_PREFIX}{secrets.token_urlsafe(30)}",
            refresh_token=f"{REFRESH_PREFIX}{secrets.token_urlsafe(30)}",
            expires_in=int(ACCESS_LIFETIME.total_seconds()),
        )

    @staticmethod
    def _hashes(keys: IssuedKeys) -> dict[str, str]:
        return {
            "access_hash": _hash(keys.access_token),
            "access_expires_at": (_now() + ACCESS_LIFETIME).isoformat(),
            "refresh_hash": _hash(keys.refresh_token),
            "refresh_expires_at": (_now() + REFRESH_LIFETIME).isoformat(),
        }

    # ------------------------------------------------------------- the key at work

    def user_for(self, access_token: str) -> StaffUser | None:
        """Who a connector's key speaks for — always read-only — or nobody."""
        if not access_token or not access_token.strip().startswith(ACCESS_PREFIX):
            return None
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("SELECT * FROM connector_grants WHERE access_hash = :hash"), {"hash": _hash(access_token)}
                )
                .mappings()
                .first()
            )
            if row is None or row["revoked_at"] or row["access_expires_at"] <= _now().isoformat():
                return None
            # The same question the cookie is asked: off the staff list, off Claude.
            access = admission(row["email"])
            if access is None:
                return None
            self._touch(connection, row)
        return StaffUser(email=row["email"], name=row["email"], is_admin=access.is_admin, read_only=True)

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
            text("UPDATE connector_grants SET last_used_at = :now WHERE id = :id"),
            {"id": row["id"], "now": now.isoformat()},
        )

    # ------------------------------------------------------------- the list in Settings

    def grants_for(self, email: str, *, everyone: bool = False) -> list[dict[str, Any]]:
        """A coordinator's own connections; an administrator may see everybody's."""
        clause = "" if everyone else " WHERE email = :email"
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(f"SELECT * FROM connector_grants{clause} ORDER BY created_at DESC"),  # noqa: S608
                    {} if everyone else {"email": email.strip().casefold()},
                )
                .mappings()
                .all()
            )
        return [_grant(row) for row in rows]

    def revoke(self, grant_id: str, *, email: str, everyone: bool = False) -> None:
        """Disconnect Claude at once. Kept in the list, so it is clear it once existed."""
        clause = "" if everyone else " AND email = :email"
        with self.engine.begin() as connection:
            revoked = connection.execute(
                text(f"""UPDATE connector_grants SET revoked_at = :now
                         WHERE id = :id AND revoked_at = ''{clause}"""),  # noqa: S608
                {
                    "id": grant_id,
                    "now": _now().isoformat(),
                    **({} if everyone else {"email": email.strip().casefold()}),
                },
            ).rowcount
        if revoked == 0:
            raise GrantRejected("That connection is not one of yours, or it was revoked already.")
