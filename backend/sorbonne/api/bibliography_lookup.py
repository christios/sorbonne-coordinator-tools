"""API contract for user-triggered bibliography metadata searches."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.bibliography_lookup import BibliographyLookupService


router = APIRouter(prefix="/bibliography", tags=["bibliography"])
_service = BibliographyLookupService(google_books_api_key=config.google_books_api_key)


class BibliographyLookupItem(BaseModel):
    provider: str
    kind: Literal["book", "article"]
    title: str
    authors: list[str] = Field(default_factory=list)
    year: str | None = None
    publisher: str | None = None
    isbn: str | None = None
    journal: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    doi: str | None = None
    url: str | None = None


class BibliographyLookupResponse(BaseModel):
    items: list[BibliographyLookupItem]


def get_bibliography_lookup_service() -> BibliographyLookupService:
    return _service


@router.get("/lookup", response_model=BibliographyLookupResponse)
def lookup_bibliography(
    kind: Literal["book", "article"],
    q: str = Query(min_length=2, max_length=300),
    service: BibliographyLookupService = Depends(get_bibliography_lookup_service),
) -> dict[str, list[dict[str, object]]]:
    try:
        return service.lookup(kind, q)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
