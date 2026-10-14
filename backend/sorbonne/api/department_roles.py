"""Who holds the roles the department's paperwork names: the Head of Department, in Settings.

Read by anybody, since every Part Time Sheet is signed with it; set by an administrator.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services import coordinator_directory
from sorbonne.services.department_roles import DepartmentRoles, UnknownActiveTeacher
from sorbonne.services.engine import engine_for

router = APIRouter(prefix="/department-roles", tags=["department-roles"])


def get_roles() -> DepartmentRoles:
    return DepartmentRoles(engine_for(config.database_url))


class HeadInput(BaseModel):
    # An Active teacher's row id; blank names nobody.
    activeTeacherId: str = Field(default="", max_length=200)


def _named(head: dict[str, Any]) -> dict[str, Any]:
    email = head["updatedBy"]
    return {**head, "updatedByName": coordinator_directory.name_for(email, "") if email else ""}


@router.get("/head-of-department")
def read_head(roles: DepartmentRoles = Depends(get_roles)) -> dict[str, Any]:
    return _named(roles.head())


@router.put("/head-of-department")
def set_head(body: HeadInput, request: Request, roles: DepartmentRoles = Depends(get_roles)) -> dict[str, Any]:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can say who the Head of Department is.",
        )
    try:
        return _named(roles.set_head(body.activeTeacherId, actor=str(getattr(staff, "email", "") or "")))
    except UnknownActiveTeacher as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
