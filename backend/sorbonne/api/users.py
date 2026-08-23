"""Managing who may sign in. Administrators only, from Settings → Users."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.services import coordinator_directory
from sorbonne.services.coordinator_directory import (
    AccountAlreadyInvited,
    AccountNotFound,
    CoordinatorDirectory,
    InvalidEmail,
    normalize_email,
)
from sorbonne.services.staff_auth import StaffUser, owner_emails

router = APIRouter(prefix="/users", tags=["users"])


class InviteInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    isAdmin: bool = False


class AccountUpdate(BaseModel):
    isAdmin: bool | None = None
    isActive: bool | None = None
    # What to call this person in the application, instead of whatever Google says.
    displayName: str | None = Field(default=None, max_length=120)


def require_directory() -> CoordinatorDirectory:
    return coordinator_directory.directory()


def require_admin(request: Request) -> StaffUser:
    """The sign-in gate has already admitted this caller; only admins get further."""
    user = getattr(request.state, "staff_user", None)
    if user is None:  # pragma: no cover - the gate rejects these before they arrive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can manage who may sign in.",
        )
    return user


def _address(email: str) -> str:
    try:
        return normalize_email(email)
    except InvalidEmail as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def _refuse_owners(address: str) -> None:
    if address in owner_emails():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{address} is set with COORDINATOR_ACCESS_EMAILS and is changed there, not here.",
        )


@router.get("")
async def list_accounts(
    _admin: StaffUser = Depends(require_admin),
    directory: CoordinatorDirectory = Depends(require_directory),
) -> dict[str, Any]:
    """Invited accounts, plus the owners the environment grants access to."""
    return {"accounts": directory.list_accounts(), "owners": sorted(owner_emails())}


@router.post("", status_code=status.HTTP_201_CREATED)
async def invite(
    body: InviteInput,
    admin: StaffUser = Depends(require_admin),
    directory: CoordinatorDirectory = Depends(require_directory),
) -> dict[str, Any]:
    address = _address(body.email)
    _refuse_owners(address)
    try:
        return directory.invite(address, is_admin=body.isAdmin, invited_by=admin.email)
    except AccountAlreadyInvited as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/{email}")
async def update_account(
    email: str,
    body: AccountUpdate,
    admin: StaffUser = Depends(require_admin),
    directory: CoordinatorDirectory = Depends(require_directory),
) -> dict[str, Any]:
    address = _address(email)
    _refuse_owners(address)
    # Renaming yourself is harmless; changing your own access is not.
    if address == admin.email and (body.isAdmin is not None or body.isActive is not None):
        # Nobody may quietly demote or suspend themselves and lock the door behind them.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot change your own access here."
        )
    try:
        return directory.update(
            address, is_admin=body.isAdmin, is_active=body.isActive, display_name=body.displayName
        )
    except AccountNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/{email}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_account(
    email: str,
    admin: StaffUser = Depends(require_admin),
    directory: CoordinatorDirectory = Depends(require_directory),
) -> None:
    address = _address(email)
    _refuse_owners(address)
    if address == admin.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot remove your own access here."
        )
    try:
        directory.remove(address)
    except AccountNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
