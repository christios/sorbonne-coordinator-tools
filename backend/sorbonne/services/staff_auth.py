"""Google sign-in for the whole application.

A coordinator signs in with Google in the browser; the ID token is verified here,
checked against the staff allowlist, and exchanged for a short-lived signed session
cookie. Everything after that — API calls and the handbook alike — is authorised
from that cookie, so no page or endpoint answers an anonymous caller.

The cookie is signed, not encrypted: it carries only the e-mail and display name
already known to the signed-in person, and a expiry the server enforces.
"""

from __future__ import annotations

import base64
import hmac
import json
import time
from dataclasses import dataclass
from hashlib import sha256

from google.auth.transport.requests import Request
from google.oauth2 import id_token

from sorbonne.config import config

SESSION_COOKIE = "sorbonne_staff_session"
GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})


class AuthNotConfigured(Exception):
    """The deployment has no client id, allowlist, or session secret."""


class SignInRejected(Exception):
    """The Google account is not one this deployment lets in."""


@dataclass(frozen=True)
class StaffUser:
    email: str
    name: str


def allowed_emails() -> frozenset[str]:
    return frozenset(
        email.strip().casefold() for email in config.coordinator_access_emails.split(",") if email.strip()
    )


def is_configured() -> bool:
    return bool(config.google_auth_client_id and config.session_secret and allowed_emails())


def require_configured() -> None:
    if not is_configured():
        raise AuthNotConfigured


def verify_google_credential(credential: str) -> StaffUser:
    """Check a Google ID token and the staff allowlist. Raises, never returns a guess."""
    require_configured()
    try:
        claims = id_token.verify_oauth2_token(credential, Request(), config.google_auth_client_id)
    except Exception as exc:  # Verification details must not leave the server.
        raise SignInRejected("That Google sign-in could not be verified.") from exc

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise SignInRejected("That Google sign-in could not be verified.")
    if claims.get("email_verified") is not True:
        raise SignInRejected("That Google account has no verified e-mail address.")

    email = str(claims.get("email", "")).strip().casefold()
    if email not in allowed_emails():
        raise SignInRejected("That account is not on the staff list for this application.")
    return StaffUser(email=email, name=str(claims.get("name") or email))


def _sign(payload: bytes) -> str:
    secret = (config.session_secret or "").encode()
    return base64.urlsafe_b64encode(hmac.new(secret, payload, sha256).digest()).decode().rstrip("=")


def issue_session(user: StaffUser, *, now: float | None = None) -> str:
    require_configured()
    expires = int((now if now is not None else time.time()) + config.session_hours * 3600)
    payload = json.dumps({"email": user.email, "name": user.name, "exp": expires}, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{encoded}.{_sign(encoded.encode())}"


def read_session(token: str | None, *, now: float | None = None) -> StaffUser | None:
    """Return the signed-in user, or None for anything that is not a live, intact session."""
    if not token or not is_configured() or token.count(".") != 1:
        return None
    encoded, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(encoded.encode())):
        return None
    try:
        padding = "=" * (-len(encoded) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded + padding))
    except (ValueError, json.JSONDecodeError):
        return None

    expires = claims.get("exp")
    if not isinstance(expires, int) or expires < (now if now is not None else time.time()):
        return None
    email = str(claims.get("email", "")).strip().casefold()
    if not email or email not in allowed_emails():
        # Someone removed from the allowlist loses access on their next request.
        return None
    return StaffUser(email=email, name=str(claims.get("name") or email))


def user_for_request(cookie: str | None, authorization: str | None, *, now: float | None = None) -> StaffUser | None:
    """A session cookie, or a Google ID token for callers that cannot hold cookies."""
    user = read_session(cookie, now=now)
    if user is not None:
        return user
    if authorization and authorization.lower().startswith("bearer "):
        try:
            return verify_google_credential(authorization.split(" ", 1)[1].strip())
        except (AuthNotConfigured, SignInRejected):
            return None
    return None
