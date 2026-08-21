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

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from sorbonne.services.staff_auth import SESSION_COOKIE, is_configured, user_for_request

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

        user = user_for_request(request.cookies.get(SESSION_COOKIE), request.headers.get("authorization"))
        if user is None:
            return JSONResponse(status_code=401, content={"detail": "Sign in to continue."})

        request.state.staff_user = user
        return await call_next(request)
