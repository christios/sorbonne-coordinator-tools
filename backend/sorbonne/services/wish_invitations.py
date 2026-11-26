"""Invitations: a teacher gives their timetable wishes themselves, through a link.

A coordinator invites a teacher on the semester's Active teachers, at the Google address they
will sign in with. The invitation is a link with a long random code; only the code's hash is
kept, so the link exists in the email the coordinator sends and nowhere else. Inviting again
withdraws the link before.

Opening the link asks the teacher to sign in with Google — and only the address invited is
let in. They are then given a session of their own, separate from the staff's: signed with a
key of its own, held in a cookie of its own scoped to the invitation's door, and good for
that one invitation. It opens their own wishes for that semester and nothing else; the staff
session does not open it either.

A semester may also have one shared link, posted once to every teacher (18 Nov 2026). Signing
in by it with an address the coordinator set for one of the semester's teachers — an
invitation standing for it — opens that teacher's form, as their own link would. Any other
address is refused: the coordinator keeps the list.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from sorbonne.config import config
from sorbonne.services.teacher_wishes import InvalidWishes, NoCollection, UnknownTeacher, _term

#: The invited teacher's cookie, and where it is sent: their door only.
INVITEE_COOKIE = "scen_wishes_invitee"
INVITEE_PATH = "/api/v1/invite/wishes"
#: How long a signed-in invitee stays signed in.
INVITEE_HOURS = 24 * 14
#: How many random bytes a link's code carries: 256 bits, past guessing.
CODE_BYTES = 32
#: The longest an address may be, and the longest a code may be to be looked at at all.
LONGEST_EMAIL, LONGEST_CODE = 254, 128
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class NotInvited(LookupError):
    """A code that is no invitation, or one withdrawn, or for a semester no longer collecting."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


# ---------------------------------------------------------------------- the invitee's session


def _sign(payload: bytes, purpose: bytes = b"wish-invitee") -> str:
    # A key of its own, derived from the staff secret: an invitee's cookie can never pass for
    # a staff session, nor a staff session for an invitee's — nor a requester's for either.
    key = (config.session_secret or "").encode() + b"\x00" + purpose
    return base64.urlsafe_b64encode(hmac.new(key, payload, hashlib.sha256).digest()).decode().rstrip("=")


def _issue(claims: dict[str, Any], purpose: bytes, now: float | None) -> str:
    expires = int((now if now is not None else time.time()) + INVITEE_HOURS * 3600)
    payload = json.dumps({**claims, "exp": expires}, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{encoded}.{_sign(encoded.encode(), purpose)}"


def _read(token: str | None, purpose: bytes, now: float | None) -> dict[str, Any] | None:
    if not token or not config.session_secret or token.count(".") != 1:
        return None
    encoded, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(encoded.encode(), purpose)):
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    expires = claims.get("exp") if isinstance(claims, dict) else None
    if not isinstance(expires, int) or expires < (now if now is not None else time.time()):
        return None
    return claims


def issue_invitee_session(invitation_id: str, email: str, *, now: float | None = None) -> str:
    return _issue({"inv": invitation_id, "email": email}, b"wish-invitee", now)


def read_invitee_session(token: str | None, *, now: float | None = None) -> dict[str, str] | None:
    """The invitation and address a cookie was signed for, or None for anything else."""
    claims = _read(token, b"wish-invitee", now)
    if claims is None:
        return None
    return {"invitation": str(claims.get("inv") or ""), "email": str(claims.get("email") or "")}


def sign_in_address(email: str) -> str:
    """The address somebody signs in with, as kept: trimmed and in one case; refused if it is none."""
    address = (email or "").strip().casefold()
    if not _EMAIL.match(address) or len(address) > LONGEST_EMAIL:
        raise InvalidWishes("Give the address they sign in with: a Gmail one, or a personal Outlook or Hotmail.")
    return address


def on_the_list(connection: Any, term: str, teacher_id: str) -> bool:
    """On the semester's Timetable preferences list: active in it, put on it by a coordinator,
    or with an answer for it."""
    return (
        connection.execute(
            text("""SELECT 1
                    WHERE EXISTS (SELECT 1 FROM active_teacher_terms WHERE active_id = :id AND term_code = :term)
                       OR EXISTS (SELECT 1 FROM wish_people WHERE teacher_id = :id AND term_code = :term)
                       OR EXISTS (SELECT 1 FROM teacher_wishes WHERE teacher_id = :id AND term_code = :term)"""),
            {"id": teacher_id, "term": term},
        ).first()
        is not None
    )


def active_in(connection: Any, term: str, teacher_id: str) -> bool:
    """On the semester's Active teachers: only they get hour reductions and a course schedule."""
    return (
        connection.execute(
            text("SELECT 1 FROM active_teacher_terms WHERE active_id = :id AND term_code = :term"),
            {"id": teacher_id, "term": term},
        ).first()
        is not None
    )


def masked(email: str) -> str:
    """"c*****@gmail.com": enough to recognise one's own address, not to harvest it."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}{'*' * max(3, len(name) - 1)}@{domain}" if domain else email


# ---------------------------------------------------------------------- the invitations


class InvitationStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def invite(self, term_code: str, teacher_id: str, email: str, actor: str = "") -> tuple[str, dict[str, Any]]:
        """Invite somebody on the semester's list at a Google address. The code is returned once."""
        term = _term(term_code)
        address = sign_in_address(email)
        with self.engine.begin() as connection:
            collecting = connection.execute(
                text("SELECT 1 FROM wish_collections WHERE term_code = :term"), {"term": term}
            ).first()
            if collecting is None:
                raise NoCollection(term)
            if not on_the_list(connection, term, teacher_id):
                raise UnknownTeacher(teacher_id)
            return self.invite_within(connection, term, teacher_id, address, actor)

    @staticmethod
    def invite_within(
        connection: Any, term: str, teacher_id: str, address: str, actor: str = ""
    ) -> tuple[str, dict[str, Any]]:
        """The invitation made, in a transaction already open: the one before withdrawn."""
        at = _now()
        connection.execute(
            text("""UPDATE wish_invitations SET withdrawn_at = :at
                    WHERE term_code = :term AND teacher_id = :id AND withdrawn_at = ''"""),
            {"at": at, "term": term, "id": teacher_id},
        )
        code = secrets.token_urlsafe(CODE_BYTES)
        record = {
            "id": uuid.uuid4().hex,
            "term": term,
            "teacher": teacher_id,
            "email": address,
            "hash": _hash(code),
            "at": at,
            "by": actor,
        }
        connection.execute(
            text("""INSERT INTO wish_invitations
                        (id, term_code, teacher_id, email, code_hash, created_at, created_by)
                    VALUES (:id, :term, :teacher, :email, :hash, :at, :by)"""),
            record,
        )
        return code, {"email": address, "createdAt": at, "createdBy": actor, "openedAt": "", "signedInAt": ""}

    def withdraw(self, term_code: str, teacher_id: str) -> None:
        term = _term(term_code)
        with self.engine.begin() as connection:
            connection.execute(
                text("""UPDATE wish_invitations SET withdrawn_at = :at
                        WHERE term_code = :term AND teacher_id = :id AND withdrawn_at = ''"""),
                {"at": _now(), "term": term, "id": teacher_id},
            )

    def _standing(self, where: str, values: dict[str, Any]) -> dict[str, Any] | None:
        """The first invitation not withdrawn that `where` picks, newest first, with its teacher
        and semester."""
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(f"""SELECT i.*,
                               coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), i.email) AS teacher_name,
                               coalesce(nullif(t.name, ''), '') AS semester_name,
                               c.deadline AS deadline, c.message AS message
                        FROM wish_invitations i
                        JOIN active_teachers a ON a.id = i.teacher_id
                        LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                        LEFT JOIN plan_terms t ON t.term_code = i.term_code
                        JOIN wish_collections c ON c.term_code = i.term_code
                        WHERE i.withdrawn_at = '' AND {where}
                        ORDER BY i.created_at DESC LIMIT 1"""),  # noqa: S608 - `where` is one of three fixed clauses
                    values,
                )
                .mappings()
                .first()
            )
        return dict(row) if row is not None else None

    def for_code(self, code: str) -> dict[str, Any]:
        """The invitation a link stands for, with its teacher and semester; NotInvited otherwise."""
        if not code or len(code) > LONGEST_CODE:
            raise NotInvited
        found = self._standing("i.code_hash = :hash", {"hash": _hash(code)})
        if found is None:
            raise NotInvited
        return found

    def by_id(self, invitation_id: str) -> dict[str, Any] | None:
        """An invitation still standing, by its id: what an invitee's session names."""
        return self._standing("i.id = :id", {"id": invitation_id}) if invitation_id else None

    def for_address(self, term_code: str, email: str) -> dict[str, Any] | None:
        """The invitation standing for an address in a semester, if any: the latest made."""
        address = (email or "").strip().casefold()
        if not address:
            return None
        return self._standing("i.term_code = :term AND i.email = :email", {"term": term_code, "email": address})

    # ------------------------------------------------------------------ the shared link

    def make_share_link(self, term_code: str) -> str:
        """The semester's one link for every teacher, made new: the one before stops working."""
        term = _term(term_code)
        code = secrets.token_urlsafe(CODE_BYTES)
        with self.engine.begin() as connection:
            changed = connection.execute(
                text("UPDATE wish_collections SET share_code = :code WHERE term_code = :term"),
                {"code": code, "term": term},
            ).rowcount
        if not changed:
            raise NoCollection(term)
        return code

    def shared(self, code: str) -> dict[str, Any] | None:
        """The semester a shared link is for, or None if it is no shared link."""
        if not code or len(code) > LONGEST_CODE:
            return None
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("""SELECT c.term_code, c.deadline, c.message, coalesce(nullif(t.name, ''), '') AS semester_name
                            FROM wish_collections c LEFT JOIN plan_terms t ON t.term_code = c.term_code
                            WHERE c.share_code = :code AND c.share_code <> ''"""),
                    {"code": code},
                )
                .mappings()
                .first()
            )
        return dict(row) if row is not None else None

    def mark(self, invitation_id: str, field: str) -> None:
        """Note the first time the link was opened, or the last time it was signed in with."""
        column = {"opened": "opened_at", "signed_in": "signed_in_at"}[field]
        only_first = "AND opened_at = ''" if field == "opened" else ""
        with self.engine.begin() as connection:
            connection.execute(
                text(f"UPDATE wish_invitations SET {column} = :at WHERE id = :id {only_first}"),  # noqa: S608 - fixed names
                {"at": _now(), "id": invitation_id},
            )
