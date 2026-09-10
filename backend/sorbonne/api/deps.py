"""Dependencies shared by more than one router, and by routers that must not need each other.

`optional_client` lives here rather than beside `require_client` in `api/timetables.py`
so that the routes which must keep working without the SCEN Student Hub depend on this
module and not on the Hub-gated one. `get_client` itself still comes from there — it is
where the client is built — but the *decision* to tolerate its absence belongs to the
callers who can, and they now have somewhere neutral to ask.
"""

from __future__ import annotations

from sorbonne.api.timetables import get_client
from sorbonne.services.student_timetables import StudentPlatformClient, StudentPlatformNotConfigured


def optional_client() -> StudentPlatformClient | None:
    """The Hub if this deployment has one, and None if it has not.

    Beside `require_client`, never instead of it. Publishing and uploading must go on
    answering 503 when the Hub is unconfigured — they genuinely cannot be done without it,
    and pretending otherwise would publish a semester nobody can read. What this is for is
    the questions that have a real answer either way: a clash the registrar's own timetable
    can settle should not be unanswerable because a separate deployment is down.
    """
    try:
        return get_client()
    except StudentPlatformNotConfigured:
        return None
