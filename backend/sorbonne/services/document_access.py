from __future__ import annotations

from fastapi import HTTPException, Request, status

from sorbonne.config import config


def document_access_emails() -> frozenset[str]:
    return frozenset(
        email.strip().casefold() for email in config.google_documents_access_emails.split(",") if email.strip()
    )


def require_document_access(request: Request) -> str:
    """The signed-in person, if they are on the document-workflow allowlist.

    Teachers' documents — passports, degrees — asked for a second Google sign-in on top of
    the application's own, which had already proved who was at the keyboard. The session
    is enough to say who it is. What it cannot do is decide who may read these: that is
    still the allowlist's, narrower than the application's.

    A person, not a script: an API token speaks for its owner in the tables, but a token
    left in a shell history should not also open a teacher's passport.
    """
    if not document_access_emails():
        raise HTTPException(status_code=503, detail="Document workflow is not configured.")
    user = getattr(request.state, "staff_user", None)
    if user is None or getattr(request.state, "auth_kind", "") == "token":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to reach teacher documents.")
    email = str(getattr(user, "email", "")).strip().casefold()
    if email not in document_access_emails():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to teacher documents."
        )
    return email
