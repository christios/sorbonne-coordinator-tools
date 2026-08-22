"""Client for the SCEN Student Platform's coordinator API.

Timetables live in the student platform, not in this database. This service is the
only place that talks to it, so the access token stays on the server and never
reaches the browser.
"""

from __future__ import annotations

from typing import Any

import httpx

UPLOAD_TIMEOUT_SECONDS = 120.0
REQUEST_TIMEOUT_SECONDS = 30.0


class StudentPlatformNotConfigured(Exception):
    """Raised when the deployment has no student-platform URL or token."""


class StudentPlatformError(Exception):
    """An error the coordinator should see, usually forwarded from the platform."""

    def __init__(
        self, message: str, status_code: int = 502, detail: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        # A structured body when the platform sent one — an edit conflict names the
        # coordinator who got there first, and the screen has to show that.
        self.detail = detail


class StudentPlatformClient:
    def __init__(
        self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._headers = {"X-Admin-Token": token}
        # Tests pass a mock transport; production leaves this unset.
        self._transport = transport

    @property
    def host(self) -> str:
        return httpx.URL(self.base_url).host

    async def list_terms(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v1/admin/terms")
        return payload.get("terms", []) if isinstance(payload, dict) else []

    async def import_term(
        self,
        *,
        name: str,
        timezone: str,
        timetable: tuple[str, bytes],
        enrolments: list[tuple[str, bytes]],
    ) -> dict[str, Any]:
        """One timetable export and one or more student workbooks."""
        spreadsheet = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        files: list[tuple[str, tuple[str, bytes, str]]] = [
            ("timetable", (timetable[0], timetable[1], "application/vnd.ms-excel"))
        ]
        files.extend(("enrolments", (name, content, spreadsheet)) for name, content in enrolments)
        return await self._request(
            "POST",
            "/api/v1/admin/terms",
            data={"name": name, "timezone": timezone},
            files=files,
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )

    async def list_announcements(self) -> dict[str, Any]:
        payload = await self._request("GET", "/api/v1/admin/announcements")
        return payload if isinstance(payload, dict) else {"announcements": [], "icons": []}

    async def replace_announcements(self, announcements: list[dict[str, str]]) -> dict[str, Any]:
        payload = await self._request(
            "PUT", "/api/v1/admin/announcements", json={"announcements": announcements}
        )
        return payload if isinstance(payload, dict) else {"announcements": []}

    async def set_published(self, term_id: str, published: bool) -> dict[str, Any]:
        return await self._request(
            "POST", f"/api/v1/admin/terms/{term_id}/publish", json={"published": published}
        )

    async def delete_term(self, term_id: str) -> None:
        await self._request("DELETE", f"/api/v1/admin/terms/{term_id}")

    async def read_roster(self, term_id: str) -> dict[str, Any]:
        """The term's catalogue plus which CRNs each student id holds."""
        payload = await self._request("GET", f"/api/v1/admin/terms/{term_id}/roster")
        return payload if isinstance(payload, dict) else {"courses": [], "students": []}

    async def set_student_assignment(
        self, *, term_id: str, student_id: str, crns: list[str], version: int, actor: str
    ) -> dict[str, Any]:
        return await self._request(
            "PUT",
            f"/api/v1/admin/terms/{term_id}/roster/{student_id}",
            json={"crns": crns, "version": version, "actor": actor},
        )

    async def _request(
        self, method: str, path: str, *, timeout: float = REQUEST_TIMEOUT_SECONDS, **kwargs: Any
    ) -> Any:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=timeout, transport=self._transport
            ) as client:
                response = await client.request(method, path, headers=self._headers, **kwargs)
        except httpx.RequestError as exc:
            raise StudentPlatformError(
                f"The student platform at {self.host} could not be reached. Try again in a moment.",
                status_code=502,
            ) from exc

        if response.status_code == httpx.codes.UNAUTHORIZED:
            raise StudentPlatformError(
                "The student platform rejected this deployment's access code. Update "
                "SCEN_STUDENT_PLATFORM_TOKEN and redeploy.",
                status_code=502,
            )
        if response.is_error:
            raise StudentPlatformError(
                _detail_of(response),
                status_code=_client_safe_status(response),
                detail=_structured_detail(response),
            )
        if response.status_code == httpx.codes.NO_CONTENT or not response.content:
            return None
        return response.json()


def _detail_of(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"The student platform returned an unexpected error ({response.status_code})."
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, str) and detail.strip():
        return detail
    if isinstance(detail, dict) and isinstance(detail.get("message"), str):
        return detail["message"]
    return f"The student platform returned an unexpected error ({response.status_code})."


def _structured_detail(response: httpx.Response) -> dict[str, Any] | None:
    """An edit conflict answers with an object, not a sentence. Keep it intact."""
    try:
        body = response.json()
    except ValueError:
        return None
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail if isinstance(detail, dict) else None


def _client_safe_status(response: httpx.Response) -> int:
    """Forward the platform's own 4xx so the coordinator sees a fixable message."""
    is_client_error = httpx.codes.BAD_REQUEST <= response.status_code < httpx.codes.INTERNAL_SERVER_ERROR
    return response.status_code if is_client_error else int(httpx.codes.BAD_GATEWAY)
