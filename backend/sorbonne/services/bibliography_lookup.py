"""Bounded, copy-only lookup of book and scholarly-reference metadata."""

from __future__ import annotations

from copy import deepcopy
from json import JSONDecodeError, loads
from os import getenv
import re
from time import monotonic
from typing import Any, Callable, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


LookupKind = Literal["book", "article"]
FetchJson = Callable[[str], object]

_MAX_RESULTS = 5
_PROVIDER_RESULT_LIMIT = 20
_CACHE_SECONDS = 300
_MIN_QUERY_LENGTH = 2
_SUCCESS_STATUS = 200
_REQUEST_TIMEOUT_SECONDS = 3
_ALLOWED_HOSTS = {"api.crossref.org", "api.openalex.org", "openlibrary.org", "www.googleapis.com"}
_SEARCH_STOP_WORDS = {"a", "an", "and", "by", "for", "in", "of", "on", "the", "to", "with"}
_MIN_TITLE_QUERY_TOKENS = 2
_MIN_TITLE_QUERY_COVERAGE = 0.75
_MIN_FOCUSED_GOOGLE_QUERY_TOKENS = 3
_GOOGLE_BOOKS_ATTEMPTS = 2


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(  # noqa: N802, PLR0913
        self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


class BibliographyLookupService:
    """Looks up metadata only when a professor explicitly searches for it.

    Provider responses are untrusted: this service reads a small allowlisted subset
    of values, bounds text length, and returns plain data that the caller may copy
    into a syllabus. No provider IDs or provider responses are persisted.
    """

    def __init__(self, fetch_json: FetchJson | None = None, google_books_api_key: str | None = None) -> None:
        self._fetch_json = fetch_json or _fetch_json
        self._google_books_api_key = google_books_api_key or getenv("GOOGLE_BOOKS_API_KEY")
        self._cache: dict[tuple[LookupKind, str], tuple[float, dict[str, list[dict[str, Any]]]]] = {}

    def lookup(self, kind: LookupKind, query: str) -> dict[str, list[dict[str, Any]]]:
        normalized_query = query.strip()
        if len(normalized_query) < _MIN_QUERY_LENGTH:
            raise ValueError("Enter at least two characters to find a reference.")

        key = (kind, normalized_query.casefold())
        cached = self._cache.get(key)
        if cached and monotonic() - cached[0] < _CACHE_SECONDS:
            return deepcopy(cached[1])

        if kind == "book":
            items = self._book_results(normalized_query)
        else:
            items = self._article_results(normalized_query)

        result = {"items": _deduplicate(items)[:_MAX_RESULTS]}
        # A provider timeout must not turn into a five-minute cached "no results"
        # response. Empty searches are retried on the next explicit user search.
        if result["items"]:
            self._cache[key] = (monotonic(), result)
        return deepcopy(result)

    def _book_results(self, query: str) -> list[dict[str, Any]]:
        isbn = _isbn_from_query(query)
        if isbn:
            parameters = {"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"}
            response = _record(self._get(f"https://openlibrary.org/api/books?{urlencode(parameters)}"))
            if results := _mapped_books(list(response.values())):
                return results

        parameters = {"q": query, "limit": _PROVIDER_RESULT_LIMIT}
        response = _record(self._get(f"https://openlibrary.org/search.json?{urlencode(parameters)}"))
        results = _relevant_book_results(_mapped_books(_records(response.get("docs"))), query)
        if results:
            return _rank_book_results(results, query)

        if self._google_books_api_key:
            for google_query in _google_book_queries(query):
                for attempt in range(_GOOGLE_BOOKS_ATTEMPTS):
                    google_parameters = {
                        "q": google_query,
                        "maxResults": _MAX_RESULTS,
                        "printType": "books",
                        "key": self._google_books_api_key,
                    }
                    google = _record(self._get(f"https://www.googleapis.com/books/v1/volumes?{urlencode(google_parameters)}"))
                    if not google and attempt + 1 < _GOOGLE_BOOKS_ATTEMPTS:
                        continue
                    google_results = [_google_book(item) for item in _records(google.get("items"))]
                    if (results := _relevant_book_results([item for item in google_results if item], query)):
                        return _rank_book_results(results, query)
                    break

        crossref_parameters = {"query.bibliographic": query, "rows": _PROVIDER_RESULT_LIMIT}
        crossref = _record(self._get(f"https://api.crossref.org/works?{urlencode(crossref_parameters)}"))
        message = _record(crossref.get("message"))
        crossref_results = [
            item for item in (_crossref_book(value) for value in _records(message.get("items"))) if item
        ]
        return _rank_book_results(_relevant_book_results(crossref_results, query), query)

    def _article_results(self, query: str) -> list[dict[str, Any]]:
        crossref_parameters = {"query.bibliographic": query, "rows": _MAX_RESULTS}
        crossref = _record(self._get(f"https://api.crossref.org/works?{urlencode(crossref_parameters)}"))
        message = _record(crossref.get("message"))
        items = [_crossref_article(item) for item in _records(message.get("items"))]

        # OpenAlex fills gaps when Crossref has fewer relevant results. Its results
        # are deduplicated by DOI/title before the fixed result cap is applied.
        openalex_parameters = {"search": query, "per-page": _MAX_RESULTS}
        openalex = _record(self._get(f"https://api.openalex.org/works?{urlencode(openalex_parameters)}"))
        items.extend(_openalex_article(item) for item in _records(openalex.get("results")))
        return [item for item in items if item]

    def _get(self, url: str) -> object:
        try:
            return self._fetch_json(url)
        except (HTTPError, URLError, TimeoutError, ValueError, JSONDecodeError):
            return {}


def _fetch_json(url: str) -> object:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_HOSTS:
        raise ValueError("Reference lookup provider is not allowed.")

    request = Request(url, headers={"Accept": "application/json", "User-Agent": "SorbonneCoordinatorTools/1.0"})
    opener = build_opener(_NoRedirect())
    with opener.open(request, timeout=_REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310 - fixed HTTPS allowlist above
        if response.status != _SUCCESS_STATUS:
            return {}
        return loads(response.read().decode("utf-8"))


def _open_library_book(value: object) -> dict[str, Any] | None:
    item = _record(value)
    title = _text(item.get("title"))
    if not title:
        return None
    authors = _text_list(item.get("author_name")) or _named_items(item.get("authors"), "name")
    publishers = _text_list(item.get("publisher")) or _named_items(item.get("publishers"), "name")
    years = _text_list(item.get("publish_year"))
    year = _year(item.get("first_publish_year")) or _year(item.get("publish_date")) or (years[0] if years else None)
    identifiers = _record(item.get("identifiers"))
    isbns = (
        _text_list(item.get("isbn"))
        or _text_list(identifiers.get("isbn_13"))
        or _text_list(identifiers.get("isbn_10"))
    )
    return _result(
        provider="Open Library",
        kind="book",
        title=title,
        authors=authors,
        year=year,
        publisher=publishers[0] if publishers else None,
        isbn=isbns[0] if isbns else None,
    )


def _mapped_books(values: object) -> list[dict[str, Any]]:
    results = [_open_library_book(item) for item in values] if isinstance(values, (list, tuple)) else []
    return [item for item in results if item]


def _crossref_article(value: object) -> dict[str, Any] | None:
    item = _record(value)
    titles = _text_list(item.get("title"))
    if not titles:
        return None
    doi = _normalise_doi(_text(item.get("DOI")))
    return _result(
        provider="Crossref",
        kind="article",
        title=titles[0],
        authors=[_join_author(author) for author in _records(item.get("author")) if _join_author(author)],
        year=_crossref_year(item),
        journal=(_text_list(item.get("container-title")) or [None])[0],
        volume=_text(item.get("volume")),
        issue=_text(item.get("issue")),
        pages=_text(item.get("page")),
        doi=doi,
        url=_safe_url(_text(item.get("URL"))),
    )


def _google_book(value: object) -> dict[str, Any] | None:
    item = _record(value)
    volume = _record(item.get("volumeInfo"))
    title = _text(volume.get("title"))
    if not title:
        return None
    identifiers = _records(volume.get("industryIdentifiers"))
    isbn_13 = next(
        (_text(identifier.get("identifier")) for identifier in identifiers if identifier.get("type") == "ISBN_13"),
        None,
    )
    isbn = isbn_13 or next(
        (_text(identifier.get("identifier")) for identifier in identifiers if _text(identifier.get("identifier"))),
        None,
    )
    return _result(
        provider="Google Books",
        kind="book",
        title=title,
        authors=_text_list(volume.get("authors")),
        year=_year(volume.get("publishedDate")),
        publisher=_text(volume.get("publisher")),
        isbn=isbn,
        url=_safe_url(_text(volume.get("infoLink"))),
    )


def _crossref_book(value: object) -> dict[str, Any] | None:
    item = _record(value)
    titles = _text_list(item.get("title"))
    if not titles:
        return None
    return _result(
        provider="Crossref",
        kind="book",
        title=titles[0],
        authors=[_join_author(author) for author in _records(item.get("author")) if _join_author(author)],
        year=_crossref_year(item),
        publisher=_text(item.get("publisher")),
        isbn=(_text_list(item.get("ISBN")) or [None])[0],
    )


def _openalex_article(value: object) -> dict[str, Any] | None:
    item = _record(value)
    title = _text(item.get("title"))
    if not title:
        return None
    location = _record(item.get("primary_location"))
    source = _record(location.get("source"))
    biblio = _record(item.get("biblio"))
    doi = _normalise_doi(_text(item.get("doi")))
    authors = [
        display_name
        for authorship in _records(item.get("authorships"))
        if (display_name := _text(_record(authorship.get("author")).get("display_name")))
    ]
    return _result(
        provider="OpenAlex",
        kind="article",
        title=title,
        authors=authors,
        year=_text(item.get("publication_year")),
        journal=_text(source.get("display_name")),
        volume=_text(biblio.get("volume")),
        issue=_text(biblio.get("issue")),
        pages=_pages(biblio),
        doi=doi,
        url=f"https://doi.org/{doi}" if doi else _safe_url(_text(item.get("id"))),
    )


def _result(  # noqa: PLR0913
    *,
    provider: str,
    kind: LookupKind,
    title: str,
    authors: list[str],
    year: str | None = None,
    publisher: str | None = None,
    isbn: str | None = None,
    journal: str | None = None,
    volume: str | None = None,
    issue: str | None = None,
    pages: str | None = None,
    doi: str | None = None,
    url: str | None = None,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "kind": kind,
        "title": title,
        "authors": authors[:10],
        "year": year,
        "publisher": publisher,
        "isbn": isbn,
        "journal": journal,
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "doi": doi,
        "url": url,
    }


def _deduplicate(items: list[dict[str, Any] | None]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for item in items:
        if item is None:
            continue
        key = _text(item.get("doi")) or "|".join([item["title"].casefold(), " ".join(item["authors"]).casefold()])
        if key in seen:
            continue
        seen.add(key)
        results.append(item)
    return results


def _rank_book_results(items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    """Prefer the book matching the entered title, author, and year over broad matches."""
    query_tokens = set(_search_tokens(query))
    query_years = set(re.findall(r"\b(?:1[0-9]{3}|20[0-9]{2})\b", query))

    def score(item: dict[str, Any]) -> int:
        title_matches = len(query_tokens & set(_search_tokens(item["title"])))
        author_matches = len(query_tokens & set(_search_tokens(" ".join(item["authors"]))))
        year_matches = 1 if item.get("year") in query_years else 0
        return title_matches * 3 + author_matches * 2 + year_matches * 2

    return sorted(items, key=score, reverse=True)


def _relevant_book_results(items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    """Avoid offering a merely similar scholarly work as a book citation."""
    query_tokens = {
        token
        for token in _search_tokens(query)
        if token not in _SEARCH_STOP_WORDS and not token.isdigit()
    }
    if not query_tokens:
        return items

    relevant: list[dict[str, Any]] = []
    for item in items:
        title_tokens = set(_search_tokens(item["title"]))
        author_tokens = set(_search_tokens(" ".join(item["authors"])))
        title_query_tokens = query_tokens - author_tokens
        if len(title_query_tokens) < _MIN_TITLE_QUERY_TOKENS:
            if query_tokens & (title_tokens | author_tokens):
                relevant.append(item)
            continue
        title_coverage = len(title_query_tokens & title_tokens) / len(title_query_tokens)
        if title_coverage >= _MIN_TITLE_QUERY_COVERAGE:
            relevant.append(item)
    return relevant


def _google_book_queries(query: str) -> list[str]:
    """Try a focused Google Books search only when free text is not enough.

    Google Books can treat punctuation-heavy catalogue references as broad keyword
    searches. The second query therefore interprets the final meaningful token as
    an author surname and the preceding tokens as title words. The unqualified
    query remains first so ordinary subject/title searches keep their broad reach.
    """
    if isbn := _isbn_from_query(query):
        return [f"isbn:{isbn}"]

    tokens = [
        token
        for token in _search_tokens(query)
        if token not in _SEARCH_STOP_WORDS and not token.isdigit()
    ]
    if len(tokens) < _MIN_FOCUSED_GOOGLE_QUERY_TOKENS:
        return [query]

    title_tokens, author_token = tokens[:-1], tokens[-1]
    focused_query = " ".join([*(f"intitle:{token}" for token in title_tokens), f"inauthor:{author_token}"])
    return [query, focused_query]


def _isbn_from_query(query: str) -> str | None:
    isbn = "".join(character for character in query if character.isdigit() or character in "Xx")
    return isbn if len(isbn) in {10, 13} else None


def _record(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _text(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    clean = " ".join(str(value).split())
    return clean[:600] or None


def _search_tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.casefold())


def _text_list(value: object) -> list[str]:
    return [text for item in value if (text := _text(item))] if isinstance(value, list) else []


def _named_items(value: object, key: str) -> list[str]:
    return [text for item in _records(value) if (text := _text(item.get(key)))]


def _join_author(author: dict[str, Any]) -> str | None:
    return _text(" ".join(part for key in ("given", "family", "name") if (part := _text(author.get(key)))))


def _crossref_year(item: dict[str, Any]) -> str | None:
    issued = _record(item.get("issued"))
    date_parts = issued.get("date-parts")
    if not isinstance(date_parts, list) or not date_parts or not isinstance(date_parts[0], list) or not date_parts[0]:
        return None
    return _year(date_parts[0][0])


def _year(value: object) -> str | None:
    text = _text(value)
    if not text:
        return None
    match = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", text)
    return match.group(1) if match else None


def _pages(biblio: dict[str, Any]) -> str | None:
    first, last = _text(biblio.get("first_page")), _text(biblio.get("last_page"))
    return f"{first}-{last}" if first and last else first or last


def _normalise_doi(value: str | None) -> str | None:
    if not value:
        return None
    return _text(value.removeprefix("https://doi.org/").removeprefix("http://doi.org/").removeprefix("doi:"))


def _safe_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    return value if parsed.scheme == "https" and parsed.netloc else None
