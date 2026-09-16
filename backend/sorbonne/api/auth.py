"""Sign-in endpoints. Everything else in the application is behind them.

A handler here is written `def`, not `async def`, wherever it has nothing to await. The
work it does is a sequence of blocking database calls, and a coroutine doing that holds
the event loop for its whole duration — one request at a time, for the entire server. A
plain `def` is run on a worker thread instead, so the page's other requests are answered
while this one waits on the database. Only a handler that genuinely awaits something —
the registrar's portal, a file being read — is a coroutine.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.account_access import AccountAccess, granted
from sorbonne.services import coordinator_directory
from sorbonne.services.api_tokens import DEFAULT_LIFETIME_DAYS, MAX_LIFETIME_DAYS, ApiTokenStore, TokenRejected
from sorbonne.services.staff_auth import (
    SESSION_COOKIE,
    AuthNotConfigured,
    SignInRejected,
    StaffUser,
    is_configured,
    issue_session,
    user_for_request,
    verify_google_credential,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class SignInInput(BaseModel):
    credential: str = Field(min_length=1, max_length=4096)


def _profile(user: StaffUser) -> dict[str, Any]:
    """The session carries Google's name; a name an administrator set overrides it.

    `apps` is what the workspace offers this person and what they may do in each, so the
    browser shows only the apps they were given rather than hiding the rest afterwards.
    """
    name = coordinator_directory.name_for(user.email, user.name)
    access = AccountAccess(config.database_url).apps_for(user.email)
    return {
        "email": user.email,
        "name": name,
        "isAdmin": user.is_admin,
        "apps": granted(access, platform_admin=user.is_admin),
    }


@router.get("/config")
def sign_in_config() -> dict[str, Any]:
    """Public: lets the sign-in screen render, or explain that nobody can sign in yet."""
    return {"configured": is_configured(), "clientId": config.google_auth_client_id if is_configured() else None}


@router.post("/session")
def sign_in(body: SignInInput, response: Response) -> dict[str, Any]:
    try:
        user = verify_google_credential(body.credential)
    except AuthNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is not configured for this deployment.",
        ) from exc
    except SignInRejected as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    coordinator_directory.directory().record_sign_in(user.email, user.name)
    response.set_cookie(
        SESSION_COOKIE,
        issue_session(user),
        max_age=config.session_hours * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return _profile(user)


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def current_user(request: Request) -> dict[str, Any]:
    user = user_for_request(request.cookies.get(SESSION_COOKIE), request.headers.get("authorization"))
    if user is None:  # pragma: no cover - the gate rejects these before they arrive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    return _profile(user)


# ------------------------------------------------------------- API tokens


class TokenInput(BaseModel):
    """What a token is for, and how long it should last."""

    name: str = Field(default="", max_length=120)
    days: int = Field(default=DEFAULT_LIFETIME_DAYS, ge=1, le=MAX_LIFETIME_DAYS)


def get_tokens() -> ApiTokenStore:
    return ApiTokenStore(config.database_url)


def _signed_in(request: Request) -> StaffUser:
    user = getattr(request.state, "staff_user", None)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    return user


def _at_the_keyboard(request: Request) -> StaffUser:
    """Tokens are made and unmade from a signed-in browser only.

    A token that could mint another would turn one leaked string into a permanent way in,
    so the one thing a token may not do is make more of itself.
    """
    if getattr(request.state, "auth_kind", "cookie") == "token":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Tokens are managed from a signed-in browser, not with a token.",
        )
    return _signed_in(request)


@router.get("/tokens")
def list_tokens(request: Request, tokens: ApiTokenStore = Depends(get_tokens)) -> dict[str, Any]:
    """Your tokens; an administrator sees everybody's, so a stray one can be found."""
    user = _signed_in(request)
    return {"tokens": tokens.list_for(user.email, everyone=user.is_admin)}


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
def create_token(
    body: TokenInput, request: Request, tokens: ApiTokenStore = Depends(get_tokens)
) -> dict[str, Any]:
    """Mint one. The token is in this answer and nowhere else, ever again."""
    user = _at_the_keyboard(request)
    minted = tokens.mint(name=body.name, email=user.email, days=body.days)
    return {"token": minted.token, "record": minted.record}


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: str, request: Request, tokens: ApiTokenStore = Depends(get_tokens)) -> None:
    user = _at_the_keyboard(request)
    try:
        tokens.revoke(token_id, email=user.email, everyone=user.is_admin)
    except TokenRejected as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
