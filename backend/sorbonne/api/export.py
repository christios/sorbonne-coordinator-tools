"""Every table, read out whole, for a developer's Copy prod — and for nothing else.

Production's side of copying production. Read-only, an administrator's only, and every
table except the few `table_copy.EXCLUDED` names with a reason. What a developer's machine
then does with the rows is its own business and lives in `dev_tools`, which production
does not even mount.

An administrator's, not merely a signed-in coordinator's: this is the whole database in
two requests, staff contact details included, and the question "may this person have all
of it" has the same answer as "may this person decide who signs in".
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.engine import Engine

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.table_copy import EXCLUDED, copied_tables, export_table, revision, row_counts

router = APIRouter(prefix="/export", tags=["export"])


def get_engine() -> Engine:
    return engine_for(config.database_url)


def _administrator(request: Request) -> None:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can read the whole database out.",
        )


@router.get("")
def list_tables(request: Request, engine: Engine = Depends(get_engine)) -> dict[str, Any]:
    """What there is to copy, how much of it, and at which revision of the schema."""
    _administrator(request)
    counts = row_counts(engine)
    return {
        "revision": revision(engine),
        "tables": [{"name": name, "rows": counts[name]} for name in copied_tables(engine)],
        "excluded": EXCLUDED,
    }


@router.get("/{name}")
def read_table(name: str, request: Request, engine: Engine = Depends(get_engine)) -> dict[str, Any]:
    """One table, every row. An excluded table is refused as though it did not exist."""
    _administrator(request)
    try:
        return export_table(engine, name)
    except KeyError as missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"There is no table {name} to copy."
        ) from missing
