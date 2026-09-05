"""The gate every request passes through.

Written as deny-by-default: a new router is protected the moment it is mounted,
because nothing is public unless it appears in PUBLIC_PATHS below. The exceptions
are only what a signed-out browser needs in order to sign in — the static app
shell, the health check, and the sign-in endpoints themselves.

When the deployment has no Google client id, allowlist, or session secret, the
gate closes rather than opens: the API answers 503 instead of serving data to
anyone who asks.
"""

from __future__ import annotations

from functools import lru_cache

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from sorbonne.config import config
from sorbonne.services.api_tokens import ApiTokenStore
from sorbonne.services.staff_auth import SESSION_COOKIE, is_configured, read_session, user_for_request

@lru_cache(maxsize=1)
def _tokens() -> ApiTokenStore:
    """One store, not one per request: every authenticated call would otherwise open its
    own connection pool."""
    return ApiTokenStore(config.database_url)


def token_user(token: str):
    """Who an API token speaks for, if anyone. A seam, so a test can hold its own store."""
    return _tokens().user_for(token)


# Everything a signed-out browser is allowed to reach.
PUBLIC_PATHS = frozenset({"/healthcheck", "/api/v1/auth/config", "/api/v1/auth/session"})
PROTECTED_PREFIXES = ("/api/", "/handbook")


def is_public(path: str) -> bool:
    """The static app shell is public; the API and the handbook are not."""
    if path in PUBLIC_PATHS:
        return True
    return not path.startswith(PROTECTED_PREFIXES)


class StaffAuthGate(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or is_public(request.url.path):
            return await call_next(request)

        if not is_configured():
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Sign-in is not configured for this deployment, so the application is "
                    "closed. Set GOOGLE_AUTH_CLIENT_ID, COORDINATOR_ACCESS_EMAILS and SESSION_SECRET."
                },
            )

        cookie = request.cookies.get(SESSION_COOKIE)
        authorization = request.headers.get("authorization")
        user = read_session(cookie)
        # How the caller proved who they are, because a token may not mint another.
        kind = "cookie"
        if user is None and authorization and authorization.lower().startswith("bearer "):
            user = token_user(authorization.split(" ", 1)[1].strip())
            kind = "token"
        if user is None:
            user, kind = user_for_request(cookie, authorization), "google"
        if user is None:
            return JSONResponse(status_code=401, content={"detail": "Sign in to continue."})

        request.state.staff_user = user
        request.state.auth_kind = kind
        return await call_next(request)
