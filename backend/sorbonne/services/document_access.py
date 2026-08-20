from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport.requests import Request
from google.oauth2 import id_token

from sorbonne.config import config

_bearer = HTTPBearer(auto_error=False)


def document_access_emails() -> frozenset[str]:
    return frozenset(
        email.strip().casefold() for email in config.google_documents_access_emails.split(",") if email.strip()
    )


def require_document_access(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Validate a Google ID token and enforce the document-workflow allowlist."""
    if not config.google_documents_oauth_client_id or not document_access_emails():
        raise HTTPException(status_code=503, detail="Document workflow is not configured.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google sign-in is required.")
    try:
        claims = _verify_google_id_token(credentials.credentials)
        email = str(claims.get("email", "")).strip().casefold()
        verified = claims.get("email_verified") is True
    except Exception as exc:  # Token verification details must not leave the server.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google sign-in is required.") from exc
    if not verified or email not in document_access_emails():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to teacher documents."
        )
    return email


def _verify_google_id_token(token: str) -> dict[str, object]:
    if not config.google_documents_oauth_client_id:
        raise ValueError("Google OAuth client ID is not configured")
    claims = id_token.verify_oauth2_token(token, Request(), config.google_documents_oauth_client_id)
    issuer = claims.get("iss")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise ValueError("Unexpected token issuer")
    return dict(claims)
