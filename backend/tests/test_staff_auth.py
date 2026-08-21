import time

import pytest

from sorbonne.config import config
from sorbonne.services import staff_auth
from sorbonne.services.staff_auth import (
    AuthNotConfigured,
    SignInRejected,
    StaffUser,
    issue_session,
    is_configured,
    read_session,
    user_for_request,
    verify_google_credential,
)

STAFF = StaffUser(email="coordinator@sorbonne.ae", name="Coordinator")
pytestmark = pytest.mark.anonymous


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_auth_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "coordinator_access_emails", "coordinator@sorbonne.ae")
    monkeypatch.setattr(config, "session_secret", "test-secret")
    monkeypatch.setattr(config, "session_hours", 12)


def test_a_session_round_trips():
    assert read_session(issue_session(STAFF)) == STAFF


def test_a_session_expires():
    issued_yesterday = issue_session(STAFF, now=time.time() - 13 * 3600)

    assert read_session(issued_yesterday) is None


def test_an_edited_payload_no_longer_verifies():
    encoded, signature = issue_session(STAFF).split(".")
    tampered = f"{encoded[:-4]}AAAA.{signature}"

    assert read_session(tampered) is None


def test_a_session_signed_with_another_secret_is_refused(monkeypatch: pytest.MonkeyPatch):
    stolen = issue_session(STAFF)
    monkeypatch.setattr(config, "session_secret", "a-different-secret")

    assert read_session(stolen) is None


def test_rubbish_is_not_a_session():
    for value in ["", None, "not-a-token", "a.b.c", "...", "x." * 40]:
        assert read_session(value) is None


def test_the_allowlist_is_checked_on_every_read(monkeypatch: pytest.MonkeyPatch):
    token = issue_session(STAFF)
    monkeypatch.setattr(config, "coordinator_access_emails", "someone-else@sorbonne.ae")

    assert read_session(token) is None


def test_nothing_is_issued_or_accepted_when_sign_in_is_unconfigured(monkeypatch: pytest.MonkeyPatch):
    token = issue_session(STAFF)
    monkeypatch.setattr(config, "session_secret", None)

    assert is_configured() is False
    assert read_session(token) is None
    with pytest.raises(AuthNotConfigured):
        issue_session(STAFF)


def test_a_google_account_outside_the_allowlist_is_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        staff_auth.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "https://accounts.google.com",
            "email": "outsider@example.com",
            "email_verified": True,
        },
    )

    with pytest.raises(SignInRejected, match="not on the staff list"):
        verify_google_credential("token")


def test_an_unverified_google_e_mail_is_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        staff_auth.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "https://accounts.google.com",
            "email": "coordinator@sorbonne.ae",
            "email_verified": False,
        },
    )

    with pytest.raises(SignInRejected, match="verified e-mail"):
        verify_google_credential("token")


def test_a_token_from_another_issuer_is_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        staff_auth.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "https://accounts.evil.example",
            "email": "coordinator@sorbonne.ae",
            "email_verified": True,
        },
    )

    with pytest.raises(SignInRejected):
        verify_google_credential("token")


def test_a_google_failure_never_leaks_its_reason(monkeypatch: pytest.MonkeyPatch):
    def explode(*_args, **_kwargs):
        raise ValueError("audience mismatch: expected 12345.apps.googleusercontent.com")

    monkeypatch.setattr(staff_auth.id_token, "verify_oauth2_token", explode)

    with pytest.raises(SignInRejected) as raised:
        verify_google_credential("token")

    assert "audience" not in str(raised.value)


def test_a_bearer_token_is_accepted_for_callers_without_cookies(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        staff_auth.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "https://accounts.google.com",
            "email": "coordinator@sorbonne.ae",
            "email_verified": True,
            "name": "Coordinator",
        },
    )

    assert user_for_request(None, "Bearer google-id-token") == STAFF
    assert user_for_request(None, "Basic google-id-token") is None
    assert user_for_request(None, None) is None
