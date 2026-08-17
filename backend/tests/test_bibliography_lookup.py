from __future__ import annotations

from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.api.bibliography_lookup import get_bibliography_lookup_service
from sorbonne.main import app
from sorbonne.services.bibliography_lookup import BibliographyLookupService


def test_lookup_returns_safe_book_metadata_from_open_library() -> None:
    requested_urls: list[str] = []

    def fetch_json(url: str) -> object:
        requested_urls.append(url)
        return {
            "docs": [
                {
                    "title": "The Dispossessed",
                    "author_name": ["Ursula K. Le Guin"],
                    "first_publish_year": 1974,
                    "publisher": ["Harper & Row"],
                    "isbn": ["9780061054884"],
                }
            ]
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup("book", "The Dispossessed")

    assert requested_urls and requested_urls[0].startswith("https://openlibrary.org/search.json?")
    assert result == {
        "items": [
            {
                "provider": "Open Library",
                "kind": "book",
                "title": "The Dispossessed",
                "authors": ["Ursula K. Le Guin"],
                "year": "1974",
                "publisher": "Harper & Row",
                "isbn": "9780061054884",
                "journal": None,
                "volume": None,
                "issue": None,
                "pages": None,
                "doi": None,
                "url": None,
            }
        ]
    }


def test_lookup_uses_the_open_library_isbn_endpoint_for_an_isbn() -> None:
    def fetch_json(url: str) -> object:
        assert "api/books" in url
        return {
            "ISBN:9780061054884": {
                "title": "The Dispossessed",
                "authors": [{"name": "Ursula K. Le Guin"}],
                "publish_date": "1974",
                "publishers": [{"name": "Harper & Row"}],
                "identifiers": {"isbn_13": ["9780061054884"]},
            }
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup("book", "978-006-1054884")

    assert result["items"][0]["title"] == "The Dispossessed"
    assert result["items"][0]["authors"] == ["Ursula K. Le Guin"]


def test_lookup_falls_back_to_google_books_when_open_library_has_no_isbn_result() -> None:
    def fetch_json(url: str) -> object:
        if "openlibrary.org" in url:
            return {}
        assert "www.googleapis.com/books/v1/volumes" in url
        assert "q=isbn%3A9781292078861" in url
        return {
            "items": [{
                "volumeInfo": {
                    "title": "Principles & Practice of Physics",
                    "authors": ["Eric Mazur"],
                    "industryIdentifiers": [{"type": "ISBN_13", "identifier": "9781292078861"}],
                }
            }]
        }

    result = BibliographyLookupService(fetch_json=fetch_json, google_books_api_key="test-key").lookup(
        "book", "978-129-2078861"
    )

    assert [item["title"] for item in result["items"]] == ["Principles & Practice of Physics"]
    assert result["items"][0]["isbn"] == "9781292078861"


def test_lookup_falls_back_to_crossref_when_open_library_has_no_book_result() -> None:
    def fetch_json(url: str) -> object:
        if "openlibrary.org" in url:
            return {"docs": []}
        return {
            "message": {
                "items": [{
                    "title": ["Research Methods"],
                    "author": [{"given": "John", "family": "Creswell"}],
                    "issued": {"date-parts": [[2018]]},
                    "publisher": "SAGE",
                    "ISBN": ["9781506386706"],
                }]
            }
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup("book", "Research Methods")

    assert result["items"][0]["provider"] == "Crossref"
    assert result["items"][0]["publisher"] == "SAGE"
    assert result["items"][0]["isbn"] == "9781506386706"


def test_lookup_does_not_cache_an_empty_provider_result() -> None:
    calls = 0

    def fetch_json(_url: str) -> object:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"docs": []}
        return {
            "docs": [{
                "title": "Principles & Practice of Physics",
                "author_name": ["Eric Mazur"],
                "first_publish_year": 2016,
            }]
        }

    service = BibliographyLookupService(fetch_json=fetch_json)

    assert service.lookup("book", "Principles & practice of physics Mazur 2016") == {"items": []}
    assert service.lookup("book", "Principles & practice of physics Mazur 2016")["items"][0]["title"] == (
        "Principles & Practice of Physics"
    )


def test_lookup_does_not_offer_a_crossref_book_with_a_partial_title_match() -> None:
    def fetch_json(url: str) -> object:
        if "openlibrary.org" in url:
            return {"docs": []}
        return {
            "message": {
                "items": [{
                    "title": ["Principles of Lightning Physics"],
                    "author": [{"given": "Vladislav", "family": "Mazur"}],
                    "issued": {"date-parts": [[2016]]},
                    "publisher": "IOP Publishing",
                }]
            }
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup(
        "book", "Principles & practice of physics Mazur 2016"
    )

    assert result == {"items": []}


def test_lookup_ranks_a_specific_book_from_a_broader_open_library_result_set() -> None:
    requested_urls: list[str] = []

    def fetch_json(url: str) -> object:
        requested_urls.append(url)
        return {
            "docs": [{
                "title": "Principles of Lightning Physics",
                "author_name": ["Martin Mazur"],
                "first_publish_year": 2016,
            }]
            + [
                {
                    "title": f"Physics reference {index}",
                    "author_name": ["Different Author"],
                    "first_publish_year": 2016,
                }
                for index in range(1, 6)
            ]
            + [
                {
                    "title": "Principles & Practice of Physics",
                    "author_name": ["Eric Mazur", "Daryl Pedigo"],
                    "first_publish_year": 2016,
                    "publisher": ["Pearson Education Limited"],
                    "isbn": ["9781292078861"],
                }
            ]
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup(
        "book", "Principles & practice of physics Mazur 2016"
    )

    assert "limit=20" in requested_urls[0]
    assert result["items"][0]["title"] == "Principles & Practice of Physics"
    assert result["items"][0]["authors"] == ["Eric Mazur", "Daryl Pedigo"]
    assert result["items"][0]["isbn"] == "9781292078861"


def test_lookup_uses_google_books_when_open_library_has_no_results() -> None:
    google_queries: list[str] = []

    def fetch_json(url: str) -> object:
        if "openlibrary.org" in url:
            return {"docs": []}
        assert "www.googleapis.com/books/v1/volumes" in url
        google_queries.append(url)
        if len(google_queries) == 1:
            return {
                "items": [{
                    "volumeInfo": {
                        "title": "Active Learning in College Science",
                        "authors": ["Joel Michael"],
                    }
                }]
            }
        return {
            "items": [{
                "volumeInfo": {
                    "title": "Principles & Practice of Physics",
                    "authors": ["Eric Mazur", "Daryl Pedigo"],
                    "publishedDate": "2016-01-01",
                    "publisher": "Pearson Education Limited",
                    "industryIdentifiers": [
                        {"type": "ISBN_10", "identifier": "1292078863"},
                        {"type": "ISBN_13", "identifier": "9781292078861"},
                    ],
                    "infoLink": "https://books.google.com/books?id=example",
                }
            }]
        }

    result = BibliographyLookupService(fetch_json=fetch_json, google_books_api_key="test-key").lookup(
        "book", "Principles & practice of physics Mazur 2016"
    )

    assert result["items"] == [{
        "provider": "Google Books",
        "kind": "book",
        "title": "Principles & Practice of Physics",
        "authors": ["Eric Mazur", "Daryl Pedigo"],
        "year": "2016",
        "publisher": "Pearson Education Limited",
        "isbn": "9781292078861",
        "journal": None,
        "volume": None,
        "issue": None,
        "pages": None,
        "doi": None,
        "url": "https://books.google.com/books?id=example",
    }]
    assert "intitle%3Aprinciples" in google_queries[1]
    assert "inauthor%3Amazur" in google_queries[1]


def test_lookup_retries_the_focused_google_books_query_after_a_temporary_failure() -> None:
    expected_focused_attempts = 2
    focused_attempts = 0

    def fetch_json(url: str) -> object:
        nonlocal focused_attempts
        if "openlibrary.org" in url:
            return {"docs": []}
        if "intitle%3Aprinciples" not in url:
            return {"items": []}
        focused_attempts += 1
        if focused_attempts == 1:
            return {}
        return {"items": [{"volumeInfo": {"title": "Principles & Practice of Physics", "authors": ["Eric Mazur"]}}]}

    result = BibliographyLookupService(fetch_json=fetch_json, google_books_api_key="test-key").lookup(
        "book", "Principles and practice of physics Mazur 2016"
    )

    assert [item["title"] for item in result["items"]] == ["Principles & Practice of Physics"]
    assert focused_attempts == expected_focused_attempts


def test_lookup_combines_crossref_and_openalex_without_duplicate_dois() -> None:
    def fetch_json(url: str) -> object:
        if "api.crossref.org" in url:
            return {
                "message": {
                    "items": [
                        {
                            "title": ["Climate law in practice"],
                            "author": [{"given": "Amina", "family": "Saleh"}],
                            "container-title": ["Journal of Climate Law"],
                            "issued": {"date-parts": [[2024]]},
                            "DOI": "10.1000/example",
                            "volume": "12",
                            "issue": "2",
                            "page": "44-59",
                            "URL": "https://doi.org/10.1000/example",
                        }
                    ]
                }
            }
        return {
            "results": [
                {
                    "title": "Climate law in practice",
                    "authorships": [{"author": {"display_name": "Amina Saleh"}}],
                    "primary_location": {"source": {"display_name": "Journal of Climate Law"}},
                    "publication_year": 2024,
                    "doi": "https://doi.org/10.1000/example",
                },
                {
                    "title": "Climate governance today",
                    "authorships": [{"author": {"display_name": "Omar Noor"}}],
                    "primary_location": {"source": {"display_name": "Policy Review"}},
                    "publication_year": 2025,
                    "doi": "https://doi.org/10.1000/second",
                },
            ]
        }

    result = BibliographyLookupService(fetch_json=fetch_json).lookup("article", "climate law")

    assert [item["title"] for item in result["items"]] == ["Climate law in practice", "Climate governance today"]
    assert result["items"][0]["authors"] == ["Amina Saleh"]
    assert result["items"][1]["doi"] == "10.1000/second"


def test_lookup_endpoint_validates_the_query_and_exposes_only_approved_fields() -> None:
    service = BibliographyLookupService(
        fetch_json=lambda _url: {"docs": [{"title": "Reference book", "author_name": ["Author"]}]}
    )
    app.dependency_overrides[get_bibliography_lookup_service] = lambda: service
    client = TestClient(app)
    try:
        response = client.get("/api/v1/bibliography/lookup", params={"kind": "book", "q": "reference"})
        invalid = client.get("/api/v1/bibliography/lookup", params={"kind": "book", "q": "x"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["items"][0] == {
        "provider": "Open Library",
        "kind": "book",
        "title": "Reference book",
        "authors": ["Author"],
        "year": None,
        "publisher": None,
        "isbn": None,
        "journal": None,
        "volume": None,
        "issue": None,
        "pages": None,
        "doi": None,
        "url": None,
    }
    assert invalid.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
