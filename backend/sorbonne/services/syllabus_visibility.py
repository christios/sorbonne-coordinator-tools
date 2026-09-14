"""Who may read and who may change a syllabus.

A syllabus is private while it is being written, and private means private: an administrator
cannot read a professor's unfinished draft any more than another professor can. What an
author can do is **submit it for review**, which is the moment it becomes an administrator's
business — and only theirs. Public is the last step: anybody signed in may read it.

A syllabus with no owner belongs to nobody in particular. Those are the ones the department
wrote before anyone had their own, and they are the shared set an administrator curates; an
administrator keeps seeing them whatever their visibility, or one made private would be lost
for good.
"""

from __future__ import annotations

from typing import Any

from sorbonne.services.staff_auth import StaffUser


PRIVATE = "private"
PUBLIC = "public"
VISIBILITIES = frozenset({PRIVATE, PUBLIC})


def normalise(value: str | None, default: str = PRIVATE) -> str:
    written = (value or "").strip().lower()
    return written if written in VISIBILITIES else default


def visible_clause(user: StaffUser) -> tuple[str, dict[str, Any]]:
    """A WHERE fragment narrowing a list to what this person may read, and its parameters."""
    clauses = ["visibility = :public", "owner_email = :viewer"]
    if user.is_admin:
        # The shared set, and anything an author has asked to have reviewed.
        clauses.append("owner_email IS NULL")
        clauses.append("submitted_at IS NOT NULL")
    return "(" + " OR ".join(clauses) + ")", {"public": PUBLIC, "viewer": user.email}


def can_view(syllabus: dict[str, Any], user: StaffUser) -> bool:
    owner = syllabus.get("ownerEmail")
    if syllabus.get("visibility") == PUBLIC or owner == user.email:
        return True
    return bool(user.is_admin) and (owner is None or bool(syllabus.get("submittedAt")))


def can_edit(syllabus: dict[str, Any], user: StaffUser) -> bool:
    """Writing, renaming, moving, deleting.

    An author owns their own throughout. An administrator maintains the shared set and the
    public ones; a syllabus submitted for review they may read and comment on, but its author
    is still the one writing it.
    """
    owner = syllabus.get("ownerEmail")
    if owner is not None and owner == user.email:
        return True
    return bool(user.is_admin) and (owner is None or syllabus.get("visibility") == PUBLIC)
