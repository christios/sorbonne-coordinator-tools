"""Putting back what a backup holds and production has lost — an administrator's only.

The other half of `export`: the backups `backup_prod.py` keeps are that export's tables,
and this takes some of their rows back in. Only the rows a deleted cohort takes with it
(see `table_copy.RESTORABLE`), only rows that are missing, and only for an administrator:
it writes to production, so it asks what reading production out asks.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.table_copy import RestoreRefused, restore_rows

router = APIRouter(prefix="/restore", tags=["restore"])


def get_engine() -> Engine:
    return engine_for(config.database_url)


class RestoreInput(BaseModel):
    # Each as the export hands it over: {"columns": [...], "rows": [[...], ...]}.
    tables: dict[str, dict[str, Any]]
    remove_if_empty: list[str] = Field(default_factory=list, alias="removeIfEmpty")


@router.post("")
def restore(body: RestoreInput, request: Request, engine: Engine = Depends(get_engine)) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can restore rows.")
    try:
        return restore_rows(engine, body.tables, remove_if_empty=body.remove_if_empty)
    except RestoreRefused as refused:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(refused)) from refused
    except IntegrityError as broken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Those rows do not fit what is here now, so nothing was restored: {broken.orig}",
        ) from broken
