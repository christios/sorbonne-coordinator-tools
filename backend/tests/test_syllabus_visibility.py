from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.syllabus_visibility import can_edit, can_view, normalise, visible_clause


AUTHOR = StaffUser(email="professor@sorbonne.ae", name="A Professor")
OTHER = StaffUser(email="another@sorbonne.ae", name="Another Professor")
# Whoever maintains the syllabus app. That they also administer accounts is beside the point
# here: these rules ask about this app and are told the answer, rather than reading a flag.
CURATOR = StaffUser(email="coordinator@sorbonne.ae", name="A Coordinator")


def syllabus(**overrides):
    return {"ownerEmail": AUTHOR.email, "visibility": "private", "submittedAt": None, **overrides}


def test_a_draft_is_its_authors_alone_not_even_an_administrators() -> None:
    draft = syllabus()

    assert can_view(draft, AUTHOR)
    assert not can_view(draft, OTHER)
    assert not can_view(draft, CURATOR, administers=True)


def test_submitting_for_review_shows_it_to_an_administrator_and_nobody_else() -> None:
    submitted = syllabus(submittedAt="2026-09-14T10:00:00+00:00")

    assert can_view(submitted, CURATOR, administers=True)
    assert can_view(submitted, AUTHOR)
    assert not can_view(submitted, OTHER)


def test_a_reviewer_reads_a_submitted_syllabus_but_its_author_is_still_writing_it() -> None:
    submitted = syllabus(submittedAt="2026-09-14T10:00:00+00:00")

    assert can_edit(submitted, AUTHOR)
    assert not can_edit(submitted, CURATOR, administers=True)


def test_a_public_syllabus_is_anybodys_to_read_and_only_its_author_or_an_admin_to_change() -> None:
    published = syllabus(visibility="public")

    assert can_view(published, OTHER)
    assert can_edit(published, AUTHOR)
    assert can_edit(published, CURATOR, administers=True)
    assert not can_edit(published, OTHER)


def test_a_syllabus_nobody_owns_is_the_shared_set_an_administrator_keeps() -> None:
    """Written before anyone had their own; an admin made private must not vanish."""
    shared = syllabus(ownerEmail=None, visibility="private")

    assert can_view(shared, CURATOR, administers=True)
    assert can_edit(shared, CURATOR, administers=True)
    assert not can_view(shared, OTHER)


def test_the_list_asks_for_less_when_the_reader_is_not_an_administrator() -> None:
    member_clause, member_params = visible_clause(AUTHOR)
    admin_clause, _ = visible_clause(CURATOR, administers=True)

    assert "owner_email IS NULL" not in member_clause
    assert "submitted_at IS NOT NULL" not in member_clause
    assert member_params["viewer"] == AUTHOR.email
    assert "submitted_at IS NOT NULL" in admin_clause


def test_a_syllabus_is_private_unless_it_says_otherwise() -> None:
    assert normalise(None) == "private"
    assert normalise("nonsense") == "private"
    assert normalise("PUBLIC") == "public"
