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


def _sign(payload: bytes) -> str:
    # A key of its own, derived from the staff secret: an invitee's cookie can never pass for
    # a staff session, nor a staff session for an invitee's.
    key = (config.session_secret or "").encode() + b"\x00wish-invitee"
    return base64.urlsafe_b64encode(hmac.new(key, payload, hashlib.sha256).digest()).decode().rstrip("=")


def issue_invitee_session(invitation_id: str, email: str, *, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + INVITEE_HOURS * 3600)
    payload = json.dumps({"inv": invitation_id, "email": email, "exp": expires}, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{encoded}.{_sign(encoded.encode())}"


def read_invitee_session(token: str | None, *, now: float | None = None) -> dict[str, str] | None:
    """The invitation and address a cookie was signed for, or None for anything else."""
    if not token or not config.session_secret or token.count(".") != 1:
        return None
    encoded, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(encoded.encode())):
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    expires = claims.get("exp")
    if not isinstance(expires, int) or expires < (now if now is not None else time.time()):
        return None
    return {"invitation": str(claims.get("inv") or ""), "email": str(claims.get("email") or "")}


def masked(email: str) -> str:
    """"c*****@gmail.com": enough to recognise one's own address, not to harvest it."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}{'*' * max(3, len(name) - 1)}@{domain}" if domain else email


# ---------------------------------------------------------------------- the invitations


class InvitationStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def invite(self, term_code: str, teacher_id: str, email: str, actor: str = "") -> tuple[str, dict[str, Any]]:
        """Invite a teacher of the semester at a Google address. The code is returned once."""
        term = _term(term_code)
        address = (email or "").strip().casefold()
        if not _EMAIL.match(address) or len(address) > LONGEST_EMAIL:
            raise InvalidWishes("Give the address they sign in to Google with: someone@gmail.com.")
        with self.engine.begin() as connection:
            collecting = connection.execute(
                text("SELECT 1 FROM wish_collections WHERE term_code = :term"), {"term": term}
            ).first()
            if collecting is None:
                raise NoCollection(term)
            active = connection.execute(
                text("SELECT 1 FROM active_teacher_terms WHERE active_id = :id AND term_code = :term"),
                {"id": teacher_id, "term": term},
            ).first()
            if active is None:
                raise UnknownTeacher(teacher_id)
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

    def for_code(self, code: str) -> dict[str, Any]:
        """The invitation a link stands for, with its teacher and semester; NotInvited otherwise."""
        if not code or len(code) > LONGEST_CODE:
            raise NotInvited
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("""SELECT i.*,
                               coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), i.email) AS teacher_name,
                               coalesce(nullif(t.name, ''), '') AS semester_name,
                               c.deadline AS deadline, c.message AS message
                        FROM wish_invitations i
                        JOIN active_teachers a ON a.id = i.teacher_id
                        LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                        LEFT JOIN plan_terms t ON t.term_code = i.term_code
                        JOIN wish_collections c ON c.term_code = i.term_code
                        WHERE i.code_hash = :hash AND i.withdrawn_at = ''"""),
                    {"hash": _hash(code)},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise NotInvited
        return dict(row)

    def mark(self, invitation_id: str, field: str) -> None:
        """Note the first time the link was opened, or the last time it was signed in with."""
        column = {"opened": "opened_at", "signed_in": "signed_in_at"}[field]
        only_first = "AND opened_at = ''" if field == "opened" else ""
        with self.engine.begin() as connection:
            connection.execute(
                text(f"UPDATE wish_invitations SET {column} = :at WHERE id = :id {only_first}"),  # noqa: S608 - fixed names
                {"at": _now(), "id": invitation_id},
            )
