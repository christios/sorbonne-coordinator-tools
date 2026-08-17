"""Public catalogue-management API for the syllabus workspace."""
# ruff: noqa: PLR0913

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.syllabus_catalogue_store import (
    CATALOGUE_CATEGORIES,
    CatalogueNotFound,
    CatalogueRevisionConflict,
    SyllabusCatalogueStore,
)


router = APIRouter(prefix="/syllabus-catalogues", tags=["syllabus catalogues"])


class CatalogueEntryRequest(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    payload: dict[str, Any] = Field(default_factory=dict)
    parentId: str | None = None
    sortOrder: int = Field(default=0, ge=0)


class CatalogueEntryUpdateRequest(CatalogueEntryRequest):
    expectedRevision: int = Field(ge=1)


class RetireCatalogueEntryRequest(BaseModel):
    expectedRevision: int = Field(ge=1)


def get_catalogue_store() -> SyllabusCatalogueStore:
    return SyllabusCatalogueStore(config.database_url)


@router.get("/{category}")
def list_catalogue_entries(
    category: str,
    query: str = Query(default="", max_length=200),
    parent_id: str | None = Query(default=None, alias="parentId"),
    include_retired: bool = Query(default=False, alias="includeRetired"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    store: SyllabusCatalogueStore = Depends(get_catalogue_store),
) -> dict[str, Any]:  # noqa: PLR0913
    _validate_category(category)
    return {
        "items": store.list(
            category, query=query, parent_id=parent_id, include_retired=include_retired, limit=limit, offset=offset
        ),
        "offset": offset,
        "limit": limit,
    }


@router.post("/{category}", status_code=201)
def create_catalogue_entry(
    category: str, request: CatalogueEntryRequest, store: SyllabusCatalogueStore = Depends(get_catalogue_store)
) -> dict[str, Any]:
    _validate_category(category)
    return store.create(
        category, label=request.label, payload=request.payload, parent_id=request.parentId, sort_order=request.sortOrder
    )


@router.get("/{category}/{item_id}")
def get_catalogue_entry(
    category: str, item_id: str, store: SyllabusCatalogueStore = Depends(get_catalogue_store)
) -> dict[str, Any]:
    _validate_category(category)
    try:
        return store.get(category, item_id)
    except CatalogueNotFound as exc:
        raise HTTPException(status_code=404, detail="Catalogue entry not found.") from exc


@router.patch("/{category}/{item_id}")
def update_catalogue_entry(
    category: str,
    item_id: str,
    request: CatalogueEntryUpdateRequest,
    store: SyllabusCatalogueStore = Depends(get_catalogue_store),
) -> dict[str, Any]:
    _validate_category(category)
    try:
        return store.update(
            category,
            item_id,
            expected_revision=request.expectedRevision,
            label=request.label,
            payload=request.payload,
            parent_id=request.parentId,
            sort_order=request.sortOrder,
        )
    except CatalogueNotFound as exc:
        raise HTTPException(status_code=404, detail="Catalogue entry not found.") from exc
    except CatalogueRevisionConflict as exc:
        raise HTTPException(
            status_code=409, detail="This catalogue entry changed elsewhere. Reload it before saving again."
        ) from exc


@router.post("/{category}/{item_id}/retire")
def retire_catalogue_entry(
    category: str,
    item_id: str,
    request: RetireCatalogueEntryRequest,
    store: SyllabusCatalogueStore = Depends(get_catalogue_store),
) -> dict[str, Any]:
    _validate_category(category)
    try:
        return store.retire(category, item_id, expected_revision=request.expectedRevision)
    except CatalogueNotFound as exc:
        raise HTTPException(status_code=404, detail="Catalogue entry not found.") from exc
    except CatalogueRevisionConflict as exc:
        raise HTTPException(
            status_code=409, detail="This catalogue entry changed elsewhere. Reload it before retiring it."
        ) from exc


def _validate_category(category: str) -> None:
    if category not in CATALOGUE_CATEGORIES:
        raise HTTPException(status_code=404, detail="Catalogue category not found.")
