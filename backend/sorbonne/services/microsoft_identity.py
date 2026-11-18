"""Who a Microsoft sign-in says signed in: personal Microsoft accounts only (Outlook, Hotmail,
Live), for invited teachers who do not use Google (18 Nov 2026).

The browser signs in at Microsoft and hands the ID token over, as Google's sign-in does; here
it is checked — signed by one of Microsoft's keys, for this application, unexpired — and taken
only from the consumers' directory, the one every personal Microsoft account lives in. A work
or school account (a university's, say) is refused: those are another directory, and another
matter, left out on purpose.

Microsoft publishes its keys as a JSON Web Key Set; each carries its certificate, which is
turned into the PEM form google-auth's JWT check takes, so no other library is needed. The
keys are kept for an hour and fetched again for a key not seen yet (Microsoft rolls them).
"""

from __future__ import annotations

import base64
import json
import threading
import time
from typing import Any

import httpx
from google.auth import jwt

from sorbonne.config import config
from sorbonne.services.staff_auth import SignInRejected

#: The directory every personal Microsoft account lives in, and the issuer its tokens carry.
CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad"
ISSUER = f"https://login.microsoftonline.com/{CONSUMERS}/v2.0"
KEYS_URL = "https://login.microsoftonline.com/consumers/discovery/v2.0/keys"
#: How long Microsoft's keys are kept before being fetched again.
KEYS_SECONDS = 3600
#: Clock difference forgiven between Microsoft and this server.
SKEW_SECONDS = 60
REFUSED = "That Microsoft sign-in could not be verified."

_keys: dict[str, str] = {}
_fetched_at = 0.0
_lock = threading.Lock()


def is_configured() -> bool:
    return bool(config.microsoft_client_id)


def _pem(certificate: str) -> str:
    """A certificate as Microsoft sends it (base64 DER), in the PEM form google-auth reads."""
    lines = [certificate[at : at + 64] for at in range(0, len(certificate), 64)]
    return "-----BEGIN CERTIFICATE-----\n" + "\n".join(lines) + "\n-----END CERTIFICATE-----\n"


def _fetch() -> dict[str, str]:
    answer = httpx.get(KEYS_URL, timeout=10)
    answer.raise_for_status()
    keys = answer.json().get("keys", [])
    return {key["kid"]: _pem(key["x5c"][0]) for key in keys if key.get("kid") and key.get("x5c")}


def _key(kid: str) -> str | None:
    """Microsoft's certificate for a key id: kept for an hour, fetched again for one not seen."""
    global _keys, _fetched_at  # noqa: PLW0603 - a process-wide cache of public keys
    with _lock:
        if kid not in _keys or time.time() - _fetched_at > KEYS_SECONDS:
            _keys, _fetched_at = _fetch(), time.time()
        return _keys.get(kid)


def _kid(token: str) -> str:
    header = token.split(".", 1)[0]
    return str(json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4))).get("kid") or "")


def verify_microsoft_identity(token: str) -> tuple[str, str]:
    """Who a Microsoft ID token says signed in — their address and name — if it is a personal
    account's, for this application, and unexpired. Raises, never returns a guess."""
    if not is_configured():
        raise SignInRejected("Microsoft sign-in is not set up here.")
    try:
        certificate = _key(_kid(token))
        if certificate is None:
            raise SignInRejected(REFUSED)
        claims: dict[str, Any] = jwt.decode(
            token,
            certs={_kid(token): certificate},
            audience=config.microsoft_client_id,
            clock_skew_in_seconds=SKEW_SECONDS,
        )
    except SignInRejected:
        raise
    except Exception as exc:  # Verification details must not leave the server.
        raise SignInRejected(REFUSED) from exc
    if claims.get("iss") != ISSUER or claims.get("tid") != CONSUMERS:
        raise SignInRejected(
            "Sign in with a personal Microsoft account (Outlook, Hotmail or Live), not a work or school one."
        )
    email = str(claims.get("email") or claims.get("preferred_username") or "").strip().casefold()
    if "@" not in email:
        raise SignInRejected("That Microsoft account has no e-mail address.")
    return email, str(claims.get("name") or email)
