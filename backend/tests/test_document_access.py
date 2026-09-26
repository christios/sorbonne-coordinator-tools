from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from sorbonne.config import config
from sorbonne.services.document_access import require_document_access
from sorbonne.services.staff_auth import StaffUser


def _request(user: StaffUser | None, kind: str = "cookie") -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(staff_user=user, auth_kind=kind))


def test_document_access_is_disabled_without_an_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_documents_access_emails", "")

    with pytest.raises(HTTPException) as response:
        require_document_access(_request(StaffUser(email="staff@example.edu", name="Staff")))  # type: ignore[arg-type]

    assert response.value.status_code == 503  # noqa: PLR2004


def test_the_application_sign_in_is_enough_for_somebody_on_the_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_documents_access_emails", "Staff@Example.edu, other@example.edu")

    email = require_document_access(_request(StaffUser(email="staff@example.edu", name="Staff")))  # type: ignore[arg-type]

    assert email == "staff@example.edu"


def test_somebody_signed_in_but_not_on_the_allowlist_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_documents_access_emails", "staff@example.edu")

    with pytest.raises(HTTPException) as response:
        require_document_access(_request(StaffUser(email="coordinator@example.edu", name="Coordinator")))  # type: ignore[arg-type]

    assert response.value.status_code == 403  # noqa: PLR2004


def test_an_api_token_does_not_open_teacher_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_documents_access_emails", "staff@example.edu")

    with pytest.raises(HTTPException) as response:
        require_document_access(_request(StaffUser(email="staff@example.edu", name="Staff"), kind="token"))  # type: ignore[arg-type]

    assert response.value.status_code == 401  # noqa: PLR2004


def test_nobody_signed_in_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "google_documents_access_emails", "staff@example.edu")

    with pytest.raises(HTTPException) as response:
        require_document_access(_request(None))  # type: ignore[arg-type]

    assert response.value.status_code == 401  # noqa: PLR2004
