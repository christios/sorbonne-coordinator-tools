"""The invited teacher's door: their own timetable wishes, and nothing else.

Every route here is reached with an invitation's code, and all but the first two with the
invitee's session as well (see `services/wish_invitations`). The staff gate lets this prefix
through to here, and this router is the whole of its check: a code that is no invitation, or
a session that is not for it, is refused with 401, as anything anonymous is elsewhere.

What a teacher may do here is what the SCEN Requests app will do for teachers already on its
list (stage 3): read the open collection and their answer, start from last semester's, and
save until the deadline. The same store, the same rules; only the door differs.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from sorbonne.api.teacher_wishes import AnswerInput
from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import AuthNotConfigured, SignInRejected, verify_google_identity
from sorbonne.services.teacher_wishes import ClosedForAnswers, InvalidWishes, WishStore
from sorbonne.services.wish_invitations import (
    INVITEE_COOKIE,
    INVITEE_HOURS,
    INVITEE_PATH,
    InvitationStore,
    NotInvited,
    issue_invitee_session,
    masked,
    read_invitee_session,
)

router = APIRouter(prefix="/invite/wishes", tags=["wish invitations"])

NOT_VALID = "This invitation link is not valid any more. Ask the coordinator who sent it for a new one."
SIGN_IN = "Sign in with the Google account this invitation was sent to."
#: The source an answer given here is recorded with.
SOURCE = "invitation"


def get_invitations() -> InvitationStore:
    return InvitationStore(engine_for(config.database_url))


def get_wishes() -> WishStore:
    return WishStore(engine_for(config.database_url))


class SignInInput(BaseModel):
    credential: str = Field(min_length=1, max_length=4096)


def _invitation(code: str, invitations: InvitationStore) -> dict[str, Any]:
    try:
        return invitations.for_code(code)
    except NotInvited as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_VALID) from exc


def _signed_in(invitation: dict[str, Any], request: Request) -> bool:
    session = read_invitee_session(request.cookies.get(INVITEE_COOKIE))
    return bool(session and session["invitation"] == invitation["id"] and session["email"] == invitation["email"])


def found_invitation(code: str, invitations: InvitationStore = Depends(get_invitations)) -> dict[str, Any]:
    """The link, checked before anything else is read of the request — its body included — so a
    code that is no invitation is refused the same way whatever comes with it."""
    return _invitation(code, invitations)


def signed_in_invitation(request: Request, found: dict[str, Any] = Depends(found_invitation)) -> dict[str, Any]:
    """The link, and the invitee's own session for it."""
    if not _signed_in(found, request):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=SIGN_IN)
    return found


def _form(invitation: dict[str, Any], wishes: WishStore) -> dict[str, Any]:
    """What the teacher's page shows: the call, their answer, whether they may still change it,
    and last semester's answer to start from."""
    term, teacher = invitation["term_code"], invitation["teacher_id"]
    semester = wishes.semester(term)
    mine = next((row for row in semester["teachers"] if row["teacherId"] == teacher), None)
    return {
        "semesterName": invitation["semester_name"],
        "teacherName": invitation["teacher_name"],
        "email": invitation["email"],
        "collection": semester["collection"],
        "wishes": mine["wishes"] if mine else None,
        "window": wishes.window(term, teacher),
        "previous": wishes.previous(term, teacher),
    }


@router.get("/{code}")
def invitation(
    request: Request,
    found: dict[str, Any] = Depends(found_invitation),
    invitations: InvitationStore = Depends(get_invitations),
) -> dict[str, Any]:
    """What the link is for, before signing in: the semester, whose wishes, and the address
    to sign in with — masked, the link being something that can be forwarded."""
    invitations.mark(found["id"], "opened")
    return {
        "semesterName": found["semester_name"],
        "teacherName": found["teacher_name"],
        "email": masked(found["email"]),
        "deadline": found["deadline"],
        "message": found["message"],
        "signedIn": _signed_in(found, request),
    }


@router.post("/{code}/session")
def sign_in(
    body: SignInInput,
    response: Response,
    found: dict[str, Any] = Depends(found_invitation),
    invitations: InvitationStore = Depends(get_invitations),
    wishes: WishStore = Depends(get_wishes),
) -> dict[str, Any]:
    try:
        email, _name = verify_google_identity(body.credential)
    except AuthNotConfigured as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Sign-in is not configured.") from exc
    except SignInRejected as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if email != found["email"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"This invitation was sent to {masked(found['email'])}. Sign in with that Google account.",
        )
    invitations.mark(found["id"], "signed_in")
    response.set_cookie(
        INVITEE_COOKIE,
        issue_invitee_session(found["id"], email),
        max_age=INVITEE_HOURS * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path=INVITEE_PATH,
    )
    return _form(found, wishes)


@router.delete("/{code}/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, _found: dict[str, Any] = Depends(found_invitation)) -> None:
    response.delete_cookie(INVITEE_COOKIE, path=INVITEE_PATH)


@router.get("/{code}/form")
def form(
    found: dict[str, Any] = Depends(signed_in_invitation), wishes: WishStore = Depends(get_wishes)
) -> dict[str, Any]:
    return _form(found, wishes)


@router.put("/{code}/answer")
def answer(
    body: AnswerInput,
    found: dict[str, Any] = Depends(signed_in_invitation),
    wishes: WishStore = Depends(get_wishes),
) -> dict[str, Any]:
    given = body.model_dump()
    given["away"] = [{"from": entry.start, "to": entry.end, "reason": entry.reason} for entry in body.away]
    try:
        wishes.save(found["term_code"], found["teacher_id"], given, actor=found["email"], source=SOURCE)
    except ClosedForAnswers as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="The deadline has passed, so your answer can no longer be changed here. Write to the coordinator.",
        ) from exc
    except InvalidWishes as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _form(found, wishes)
