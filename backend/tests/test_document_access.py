import pytest
from fastapi import HTTPException

from sorbonne.config import config
from sorbonne.services.document_access import require_document_access


def test_document_access_is_disabled_without_explicit_oauth_and_allowlist_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "google_documents_oauth_client_id", None)
    monkeypatch.setattr(config, "google_documents_access_emails", "")

    with pytest.raises(HTTPException) as response:
        require_document_access(None)

    assert response.value.status_code == 503  # noqa: PLR2004


def test_document_access_requires_a_google_bearer_token_even_for_an_allowlisted_deployment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "google_documents_oauth_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "google_documents_access_emails", "staff@example.edu")

    with pytest.raises(HTTPException) as response:
        require_document_access(None)

    assert response.value.status_code == 401  # noqa: PLR2004
