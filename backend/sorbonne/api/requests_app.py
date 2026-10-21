"""Where SCEN Requests reads every teacher's classes.

One route, read-only. The caller is the SCEN Requests app's flow, which copies the answer
into SharePoint every hour and whenever a coordinator presses Sync now; it carries the
department's requests key rather than a sign-in, and the gate in `services/auth_gate.py`
checks it before this is reached. Nothing the app does is ever written back here.
"""

from typing import Any

from fastapi import APIRouter, Depends

from sorbonne.config import config
from sorbonne.services.teacher_classes import TeacherClasses

router = APIRouter(prefix="/requests", tags=["requests"])


def get_classes() -> TeacherClasses:
    return TeacherClasses(config.database_url)


@router.get("/classes")
def classes(service: TeacherClasses = Depends(get_classes)) -> dict[str, Any]:
    """Every Active teacher, and their classes from two weeks back to the end of the timetable.

    The contract is `requests.classes.v1`. A class keeps the Timesheets pre-fill's id, so a
    request about it and the timesheet line for it can be matched later.
    """
    return service.classes()
