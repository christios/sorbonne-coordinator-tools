"""The invited teacher's door: their own timetable wishes, and nothing else.

Every route here is reached with an invitation's code, and all but the first two with the
invitee's session as well (see `services/wish_invitations`). The staff gate lets this prefix
through to here, and this router is the whole of its check: a code that is no invitation, or
a session that is not for it, is refused with 401, as anything anonymous is elsewhere.

What a teacher may do here is what the SCEN Requests app will do for teachers already on its
list (stage 3): read the open collection and their answer, start from last semester's, and
save until the deadline. The same store, the same rules; only the door differs.

A full-timer starts with their hour reductions for the year: they declare the research ones
here, while the window is open, and read those the Head of Department set. A teacher who leads
a course that semester lays out its weeks here too (the course schedule step), within the
hours the coordinators set. Both steps are for teachers on the semester's Active teachers:
somebody put on its list without being active in it — a new hire, a candidate — gives their
preferences and constraints alone (26 Nov 2026).

A code is a teacher's own link, or the semester's shared link (18 Nov 2026), posted once to
every teacher. By the shared link, signing in with an address the coordinator set for one of
the semester's teachers opens that teacher's form — the invitee's session then says which
invitation it is — and any other address is refused: the coordinator keeps the list.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from sorbonne.api.hour_reductions import ItemInput
from sorbonne.api.teacher_wishes import AnswerInput
from sorbonne.config import config
from sorbonne.services.course_plans import LEAD, CoursePlans, InvalidCoursePlan, NotTheLead, UnknownCourse
from sorbonne.services.engine import engine_for
from sorbonne.services.hour_reductions import HourReductions, InvalidReductions, NotFullTime, year_of
from sorbonne.services.microsoft_identity import verify_microsoft_identity
from sorbonne.services.staff_auth import AuthNotConfigured, SignInRejected, verify_google_identity
from sorbonne.services.teacher_wishes import ClosedForAnswers, InvalidWishes, WishStore
from sorbonne.services.wish_invitations import (
    INVITEE_COOKIE,
    INVITEE_HOURS,
    INVITEE_PATH,
    InvitationStore,
    NotInvited,
    active_in,
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


def get_reductions() -> HourReductions:
    return HourReductions(engine_for(config.database_url))


def get_course_plans() -> CoursePlans:
    return CoursePlans(engine_for(config.database_url))


class SignInInput(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)
    # Whose sign-in the credential is: Google's, or a personal Microsoft account's.
    provider: Literal["google", "microsoft"] = "google"


class CourseLayout(BaseModel):
    """One course the teacher leads: its sessions per teaching week by component, and a note."""

    courseCode: str = Field(min_length=1, max_length=40)
    weeks: dict[str, dict[str, int]] = Field(default_factory=dict, max_length=24)
    # The weeks whose sessions last other than usual, each session's hours: {"CM": {"8": [1.5, 3]}}.
    lengths: dict[str, dict[str, float | list[float]]] = Field(default_factory=dict, max_length=24)
    note: str | None = Field(default=None, max_length=2000)
    # Why the weeks run unevenly over the semester, which the step asks for; "" once they are even.
    paceReason: str | None = Field(default=None, max_length=2000)


class LayoutsInput(BaseModel):
    courses: list[CourseLayout] = Field(default_factory=list, max_length=40)


class DeclarationInput(BaseModel):
    """A full-timer's research reductions for the year, and a word for the Head of Department."""

    items: dict[str, ItemInput] = Field(default_factory=dict, max_length=30)
    note: str | None = Field(default=None, max_length=1000)


def _signed_in(invitation: dict[str, Any], request: Request) -> bool:
    session = read_invitee_session(request.cookies.get(INVITEE_COOKIE))
    return bool(session and session["invitation"] == invitation["id"] and session["email"] == invitation["email"])


def found_door(code: str, invitations: InvitationStore = Depends(get_invitations)) -> dict[str, Any]:
    """The link — a teacher's own, as {"invitation": …}, or the semester's shared one, as
    {"shared": …} — checked before anything else is read of the request, its body included,
    so a code that is neither is refused the same way whatever comes with it."""
    try:
        return {"invitation": invitations.for_code(code)}
    except NotInvited:
        shared = invitations.shared(code)
        if shared is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_VALID) from None
        return {"shared": shared}


def _session_invitation(door: dict[str, Any], request: Request, invitations: InvitationStore) -> dict[str, Any] | None:
    """The invitation the invitee's session opens by this door: the link's own, or — by the
    shared link — whichever of the semester's the session names, at the address it names."""
    if "invitation" in door:
        return door["invitation"] if _signed_in(door["invitation"], request) else None
    session = read_invitee_session(request.cookies.get(INVITEE_COOKIE))
    if not session:
        return None
    found = invitations.by_id(session["invitation"])
    if found is None or found["term_code"] != door["shared"]["term_code"] or found["email"] != session["email"]:
        return None
    return found


def signed_in_invitation(
    request: Request,
    door: dict[str, Any] = Depends(found_door),
    invitations: InvitationStore = Depends(get_invitations),
) -> dict[str, Any]:
    """The link, and the invitee's own session for it."""
    found = _session_invitation(door, request, invitations)
    if found is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=SIGN_IN)
    return found


def _let_in(response: Response, invitation: dict[str, Any], invitations: InvitationStore) -> None:
    """The invitee's session for an invitation, as signing in with its address gives it."""
    invitations.mark(invitation["id"], "signed_in")
    response.set_cookie(
        INVITEE_COOKIE,
        issue_invitee_session(invitation["id"], invitation["email"]),
        max_age=INVITEE_HOURS * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path=INVITEE_PATH,
    )


def _shared_state(shared: dict[str, Any], invitation: dict[str, Any] | None) -> dict[str, Any]:
    """What the shared link shows before the form: the semester, and — signed in already —
    whose form this browser opens."""
    return {
        "shared": True,
        "semesterName": shared["semester_name"],
        "deadline": shared["deadline"],
        "message": shared["message"],
        "teacherName": invitation["teacher_name"] if invitation else "",
        "email": masked(invitation["email"]) if invitation else "",
        "signedIn": invitation is not None,
    }


def shared_sign_in(
    shared: dict[str, Any], email: str, response: Response, invitations: InvitationStore
) -> dict[str, Any]:
    """Signed in by the shared link: the invitation the coordinator made for this address in
    the semester, let in as its own link would be; refused for an address not on the list."""
    invitation = invitations.for_address(shared["term_code"], email)
    if invitation is None:
        semester = f" for {shared['semester_name']}" if shared["semester_name"] else ""
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"{email} is not on the list{semester}. Sign in with the address you gave the coordinator, "
            "or write to them to add this one.",
        )
    _let_in(response, invitation, invitations)
    return invitation


def _teaching(invitation: dict[str, Any], engine: Any) -> bool:
    """On the semester's Active teachers: the only ones with hour reductions and a course schedule."""
    with engine.connect() as connection:
        return active_in(connection, invitation["term_code"], invitation["teacher_id"])


def _reductions(invitation: dict[str, Any], reductions: HourReductions) -> dict[str, Any] | None:
    """A full-timer's year of hour reductions; nothing for anybody else, who never sees the step."""
    term, teacher = invitation["term_code"], invitation["teacher_id"]
    with reductions.engine.connect() as connection:
        if not reductions.is_full_time(connection, teacher):
            return None
    return reductions.for_teacher(year_of(term), teacher)


def _form(
    invitation: dict[str, Any], wishes: WishStore, reductions: HourReductions, plans: CoursePlans
) -> dict[str, Any]:
    """What the teacher's page shows: the call, their answer, whether they may still change it,
    last semester's answer to start from, and — a full-timer's — their hour reductions, and — a
    course lead's — the courses whose weeks they lay out."""
    term, teacher = invitation["term_code"], invitation["teacher_id"]
    semester = wishes.semester(term)
    mine = next((row for row in semester["teachers"] if row["teacherId"] == teacher), None)
    # Somebody not active in the semester gives their preferences and constraints alone.
    teaching = bool(mine and mine["active"])
    return {
        "reductions": _reductions(invitation, reductions) if teaching else None,
        "coursePlans": plans.led_by(term, teacher) if teaching else [],
        "semesterName": invitation["semester_name"],
        "teacherName": invitation["teacher_name"],
        "email": invitation["email"],
        "collection": semester["collection"],
        "calendar": semester["calendar"],
        "wishes": mine["wishes"] if mine else None,
        "window": wishes.window(term, teacher),
        "previous": wishes.previous(term, teacher),
    }


@router.get("/{code}")
def invitation(
    request: Request,
    door: dict[str, Any] = Depends(found_door),
    invitations: InvitationStore = Depends(get_invitations),
) -> dict[str, Any]:
    """What the link is for, before signing in: the semester, whose wishes, and the address
    to sign in with — masked, the link being something that can be forwarded. By the shared
    link: the semester, and whose form this browser opens, if signed in."""
    if "shared" in door:
        return _shared_state(door["shared"], _session_invitation(door, request, invitations))
    found = door["invitation"]
    invitations.mark(found["id"], "opened")
    return {
        "shared": False,
        "semesterName": found["semester_name"],
        "teacherName": found["teacher_name"],
        "email": masked(found["email"]),
        "deadline": found["deadline"],
        "message": found["message"],
        "signedIn": _signed_in(found, request),
    }


@router.post("/{code}/session")
def sign_in(  # noqa: PLR0913 - the credential, the cookie to set, and the records the form reads
    body: SignInInput,
    response: Response,
    door: dict[str, Any] = Depends(found_door),
    invitations: InvitationStore = Depends(get_invitations),
    wishes: WishStore = Depends(get_wishes),
    reductions: HourReductions = Depends(get_reductions),
    plans: CoursePlans = Depends(get_course_plans),
) -> dict[str, Any]:
    """Signing in with Google or a personal Microsoft account. By a teacher's own link: only its
    address. By the shared link: an address the coordinator set for one of the semester's
    teachers, which opens that teacher's form; any other is refused."""
    verify = verify_microsoft_identity if body.provider == "microsoft" else verify_google_identity
    try:
        email, _name = verify(body.credential)
    except AuthNotConfigured as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Sign-in is not configured.") from exc
    except SignInRejected as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if "shared" in door:
        return _form(shared_sign_in(door["shared"], email, response, invitations), wishes, reductions, plans)
    found = door["invitation"]
    if email != found["email"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"This invitation was sent to {masked(found['email'])}. Sign in with that account.",
        )
    _let_in(response, found, invitations)
    return _form(found, wishes, reductions, plans)


@router.delete("/{code}/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, _door: dict[str, Any] = Depends(found_door)) -> None:
    response.delete_cookie(INVITEE_COOKIE, path=INVITEE_PATH)


@router.get("/{code}/form")
def form(
    found: dict[str, Any] = Depends(signed_in_invitation),
    wishes: WishStore = Depends(get_wishes),
    reductions: HourReductions = Depends(get_reductions),
    plans: CoursePlans = Depends(get_course_plans),
) -> dict[str, Any]:
    return _form(found, wishes, reductions, plans)


@router.put("/{code}/reductions")
def declare(
    body: DeclarationInput,
    found: dict[str, Any] = Depends(signed_in_invitation),
    wishes: WishStore = Depends(get_wishes),
    reductions: HourReductions = Depends(get_reductions),
    plans: CoursePlans = Depends(get_course_plans),
) -> dict[str, Any]:
    """A full-timer's research reductions, declared while the preferences are open."""
    if not wishes.window(found["term_code"], found["teacher_id"])["open"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="The deadline has passed, so your hour reductions can no longer be changed here. Write to the "
            "Head of Department.",
        )
    if not _teaching(found, reductions.engine):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Hour reductions are declared by full-time teachers active this semester."
        )
    try:
        reductions.declare(
            year_of(found["term_code"]),
            found["teacher_id"],
            {kind: item.given() for kind, item in body.items.items()},
            actor=found["email"],
            note=body.note,
        )
    except NotFullTime as exc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Hour reductions are declared by full-time teachers."
        ) from exc
    except InvalidReductions as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _form(found, wishes, reductions, plans)


@router.put("/{code}/course-plans")
def lay_out(  # noqa: PLR0913 - the courses, the invitation, and the records the form reads
    body: LayoutsInput,
    found: dict[str, Any] = Depends(signed_in_invitation),
    wishes: WishStore = Depends(get_wishes),
    reductions: HourReductions = Depends(get_reductions),
    plans: CoursePlans = Depends(get_course_plans),
) -> dict[str, Any]:
    """A lead's courses, laid out week by week, while the preferences are open: only courses
    they lead, and only within the hours the coordinators set."""
    if not wishes.window(found["term_code"], found["teacher_id"])["open"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="The deadline has passed, so your course schedule can no longer be changed here. Write to the "
            "coordinator.",
        )
    if not _teaching(found, plans.engine):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="A course schedule is laid out by teachers active this semester."
        )
    try:
        plans.lay_out_all(
            found["term_code"],
            [course.model_dump() for course in body.courses],
            actor=found["email"],
            source=LEAD,
            lead_id=found["teacher_id"],
        )
    except (NotTheLead, UnknownCourse) as exc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"You don't lead {exc.args[0]} this semester, so its weeks are not yours to lay out.",
        ) from exc
    except InvalidCoursePlan as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _form(found, wishes, reductions, plans)


@router.put("/{code}/answer")
def answer(
    body: AnswerInput,
    found: dict[str, Any] = Depends(signed_in_invitation),
    wishes: WishStore = Depends(get_wishes),
    reductions: HourReductions = Depends(get_reductions),
    plans: CoursePlans = Depends(get_course_plans),
) -> dict[str, Any]:
    given = body.given()
    try:
        wishes.save(found["term_code"], found["teacher_id"], given, actor=found["email"], source=SOURCE)
    except ClosedForAnswers as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="The deadline has passed, so your answer can no longer be changed here. Write to the coordinator.",
        ) from exc
    except InvalidWishes as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _form(found, wishes, reductions, plans)
