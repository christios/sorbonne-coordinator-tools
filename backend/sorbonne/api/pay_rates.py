"""The department's pay rates for part-timers, by academic year and degree, in Settings.

Read by anybody, since every Part Time Sheet is paid at them; set by an administrator.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.engine import engine_for
from sorbonne.services.pay_rates import InvalidRates, PayRates

router = APIRouter(prefix="/pay-rates", tags=["pay-rates"])


def get_rates() -> PayRates:
    return PayRates(engine_for(config.database_url))


class YearInput(BaseModel):
    # degree -> sheet -> rate; a cell left out or null is work that degree is not paid for.
    rates: dict[str, dict[str, float | None]] = Field(default_factory=dict)


@router.get("")
def read_rates(rates: PayRates = Depends(get_rates)) -> dict[str, Any]:
    return {"years": rates.table()}


@router.put("/{year}")
def set_year(year: str, body: YearInput, request: Request, rates: PayRates = Depends(get_rates)) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can set the pay rates."
        )
    try:
        return {"years": rates.set_year(year, body.rates, actor=str(getattr(staff, "email", "") or ""))}
    except InvalidRates as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
