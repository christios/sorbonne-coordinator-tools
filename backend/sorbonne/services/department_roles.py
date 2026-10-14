"""Who holds a role the department's paperwork names — the Head of Department, so far.

The Part Time Sheet is signed by the Head of Department, and that is one person for the
whole department rather than whoever approved a given period: it is said once, in
Settings, and every sheet reads it. The person is one of the Active teachers, kept by
their row, so a name corrected on the portal is corrected on the next sheet too.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

HEAD_OF_DEPARTMENT = "head_of_department"

#: The name and address an Active teacher goes by: the portal's where the row is linked
#: to a profile there, what was stored otherwise — the way the Active teachers page shows them.
_PERSON = """SELECT a.id,
                    coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), '') AS full_name,
                    coalesce(nullif(p.psuad_email, ''), nullif(a.email, ''), '') AS email
             FROM active_teachers a
             LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
             WHERE a.id = :id"""


class UnknownActiveTeacher(ValueError):
    """Not a row of Active teachers."""


class DepartmentRoles:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def head(self) -> dict[str, Any]:
        """The Head of Department, or blanks when nobody is named — or the row has gone."""
        with self.engine.connect() as connection:
            held = (
                connection.execute(
                    text("SELECT active_teacher_id, updated_at, updated_by FROM department_roles WHERE role = :role"),
                    {"role": HEAD_OF_DEPARTMENT},
                )
                .mappings()
                .first()
            )
            person = (
                connection.execute(text(_PERSON), {"id": held["active_teacher_id"]}).mappings().first()
                if held
                else None
            )
        return {
            "activeTeacherId": person["id"] if person else "",
            "fullName": person["full_name"] if person else "",
            "email": person["email"] if person else "",
            "updatedAt": held["updated_at"] if held else "",
            "updatedBy": held["updated_by"] if held else "",
        }

    def set_head(self, active_teacher_id: str, *, actor: str = "") -> dict[str, Any]:
        """Name the Head of Department; a blank id names nobody."""
        chosen = (active_teacher_id or "").strip()
        with self.engine.begin() as connection:
            if not chosen:
                connection.execute(
                    text("DELETE FROM department_roles WHERE role = :role"), {"role": HEAD_OF_DEPARTMENT}
                )
            else:
                if connection.execute(text(_PERSON), {"id": chosen}).first() is None:
                    raise UnknownActiveTeacher("That person is not on Active teachers.")
                connection.execute(
                    text("""INSERT INTO department_roles (role, active_teacher_id, updated_at, updated_by)
                            VALUES (:role, :id, :at, :by)
                            ON CONFLICT (role) DO UPDATE
                            SET active_teacher_id = EXCLUDED.active_teacher_id,
                                updated_at = EXCLUDED.updated_at,
                                updated_by = EXCLUDED.updated_by"""),
                    {
                        "role": HEAD_OF_DEPARTMENT,
                        "id": chosen,
                        "at": datetime.now(UTC).isoformat(timespec="seconds"),
                        "by": actor,
                    },
                )
        return self.head()
