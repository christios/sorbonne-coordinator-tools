from urllib.parse import parse_qs

import json

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.api import timetables as timetables_api
from sorbonne.config import config
from sorbonne.main import app
from sorbonne.services.student_timetables import StudentPlatformClient

PLATFORM_URL = "https://scen-student-platform.example.dev"
SESSION_COUNT = 975
TERM = {
    "id": "term-1",
    "name": "Physics & Maths — Semester 1",
    "slug": "physics-maths-semester-1",
    "isPublished": False,
    "courseCount": 43,
    "sessionCount": SESSION_COUNT,
    "studentCount": 180,
}


def platform(handler) -> StudentPlatformClient:
    return StudentPlatformClient(PLATFORM_URL, "secret", transport=httpx.MockTransport(handler))


@pytest.fixture
def client() -> TestClient:
    yield TestClient(app)
    app.dependency_overrides.pop(timetables_api.require_client, None)


def use(client: TestClient, handler) -> TestClient:
    app.dependency_overrides[timetables_api.require_client] = lambda: platform(handler)
    return client


def upload(client: TestClient, student_files: list[str] | None = None) -> httpx.Response:
    files = [("timetable", ("timetable.xls", b"timetable-bytes", "application/vnd.ms-excel"))]
    for name in student_files or ["students.xlsx"]:
        files.append(("enrolments", (name, f"{name}-bytes".encode(), "application/vnd.ms-excel")))
    return client.post(
        "/api/v1/timetables/terms",
        data={"name": "Physics & Maths — Semester 1", "timezone": "Asia/Dubai"},
        files=files,
    )


def test_status_reports_when_the_integration_is_not_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(config, "scen_student_platform_url", None)
    monkeypatch.setattr(config, "scen_student_platform_token", None)

    assert client.get("/api/v1/timetables/status").json() == {"configured": False, "host": None}


def test_status_names_the_platform_it_will_upload_to(client: TestClient, monkeypatch):
    monkeypatch.setattr(config, "scen_student_platform_url", PLATFORM_URL)
    monkeypatch.setattr(config, "scen_student_platform_token", "secret")

    assert client.get("/api/v1/timetables/status").json() == {
        "configured": True,
        "host": "scen-student-platform.example.dev",
    }


def test_uploads_are_refused_until_the_deployment_is_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(config, "scen_student_platform_url", None)
    monkeypatch.setattr(config, "scen_student_platform_token", None)

    response = upload(client)

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "SCEN_STUDENT_PLATFORM_URL" in response.json()["detail"]


def test_import_forwards_both_workbooks_and_returns_the_platform_summary(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["token"] = request.headers.get("X-Admin-Token")
        body = request.content.decode("latin-1")
        seen["has_timetable"] = "timetable-bytes" in body
        seen["has_students"] = "students.xlsx-bytes" in body
        return httpx.Response(status.HTTP_201_CREATED, json=TERM)

    response = upload(use(client, handler))

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["sessionCount"] == SESSION_COUNT
    assert seen == {
        "path": "/api/v1/admin/terms",
        "token": "secret",
        "has_timetable": True,
        "has_students": True,
    }


def test_a_rejected_workbook_keeps_the_platform_s_own_explanation(client: TestClient):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status.HTTP_400_BAD_REQUEST,
            json={"detail": "That file could not be read as an Excel workbook."},
        )

    response = upload(use(client, handler))

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "That file could not be read as an Excel workbook."


def test_a_stale_access_code_is_reported_as_a_deployment_problem(client: TestClient):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status.HTTP_401_UNAUTHORIZED, json={"detail": "Incorrect access code."})

    response = upload(use(client, handler))

    assert response.status_code == status.HTTP_502_BAD_GATEWAY
    assert "SCEN_STUDENT_PLATFORM_TOKEN" in response.json()["detail"]


def test_an_unreachable_platform_is_reported_without_a_stack_trace(client: TestClient):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    response = upload(use(client, handler))

    assert response.status_code == status.HTTP_502_BAD_GATEWAY
    assert "could not be reached" in response.json()["detail"]


def test_empty_uploads_are_rejected_before_the_platform_is_called(client: TestClient):
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("the platform should not be called")

    response = use(client, handler).post(
        "/api/v1/timetables/terms",
        data={"name": "Empty"},
        files=[
            ("timetable", ("timetable.xls", b"", "application/vnd.ms-excel")),
            ("enrolments", ("students.xlsx", b"student-bytes", "application/vnd.ms-excel")),
        ],
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_listing_terms_passes_the_platform_response_through(client: TestClient):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status.HTTP_200_OK, json={"terms": [TERM]})

    response = use(client, handler).get("/api/v1/timetables/terms")

    assert response.json()["terms"][0]["slug"] == "physics-maths-semester-1"


def test_publishing_a_term_forwards_the_flag(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = request.content.decode()
        return httpx.Response(status.HTTP_200_OK, json={**TERM, "isPublished": True})

    response = use(client, handler).post("/api/v1/timetables/terms/term-1/publish", json={"published": True})

    assert response.json()["isPublished"] is True
    assert seen["path"] == "/api/v1/admin/terms/term-1/publish"
    assert '"published":true' in seen["body"].replace(" ", "")


def test_deleting_a_term_reports_no_content(client: TestClient):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status.HTTP_204_NO_CONTENT)

    response = use(client, handler).delete("/api/v1/timetables/terms/term-1")

    assert response.status_code == status.HTTP_204_NO_CONTENT


def test_announcements_are_read_through_the_platform(client: TestClient):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/admin/announcements"
        return httpx.Response(
            status.HTTP_200_OK,
            json={"announcements": [{"id": "a1", "icon": "info", "message": "Week 1 starts Monday"}],
                  "icons": ["info", "alert"]},
        )

    payload = use(client, handler).get("/api/v1/timetables/announcements").json()

    assert payload["announcements"][0]["message"] == "Week 1 starts Monday"
    assert payload["icons"] == ["info", "alert"]


def test_saving_announcements_forwards_the_whole_strip(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["body"] = request.content.decode()
        return httpx.Response(status.HTTP_200_OK, json={"announcements": []})

    response = use(client, handler).put(
        "/api/v1/timetables/announcements",
        json={"announcements": [{"icon": "alert", "message": "Room 5.033 is closed"}]},
    )

    assert response.status_code == status.HTTP_200_OK
    assert seen["method"] == "PUT"
    assert "Room 5.033 is closed" in seen["body"]


def test_a_notice_keeps_its_id_level_and_audience_across_the_proxy(client: TestClient):
    """All three decide what a student sees, and none is this application's to invent.

    The id is how the platform recognises a notice it already holds, which is what keeps
    a student's dismissal of it alive; the level is how loudly it lands; the cohort key is
    who it lands on. Dropping any of them on the way through would be silent and would
    only show up on a student's phone.
    """
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content.decode())
        return httpx.Response(status.HTTP_200_OK, json={"announcements": []})

    use(client, handler).put(
        "/api/v1/timetables/announcements?term=term-1",
        json={
            "announcements": [
                {
                    "id": "a1",
                    "icon": "alert",
                    "level": "urgent",
                    "cohortKey": "cohort-foundation",
                    "message": "Room 5.033 is closed",
                }
            ]
        },
    )

    assert seen["body"]["announcements"] == [
        {
            "id": "a1",
            "icon": "alert",
            "level": "urgent",
            "cohortKey": "cohort-foundation",
            "message": "Room 5.033 is closed",
        }
    ]


def test_a_rejected_announcement_keeps_the_platform_s_message(client: TestClient):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status.HTTP_400_BAD_REQUEST, json={"detail": "“unicorn” is not one of the available icons."}
        )

    response = use(client, handler).put(
        "/api/v1/timetables/announcements",
        json={"announcements": [{"icon": "unicorn", "message": "Surprise"}]},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "available icons" in response.json()["detail"]


def test_every_student_workbook_is_forwarded(client: TestClient):
    """FYS, L1, L2 and the languages arrive as separate files."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode("latin-1")
        seen["names"] = [name for name in ("FYS-Groups.xlsx", "L1-Groups.xlsx", "LANG-Groups.xlsx") if name in body]
        return httpx.Response(status.HTTP_201_CREATED, json=TERM)

    response = upload(use(client, handler), ["FYS-Groups.xlsx", "L1-Groups.xlsx", "LANG-Groups.xlsx"])

    assert response.status_code == status.HTTP_201_CREATED
    assert seen["names"] == ["FYS-Groups.xlsx", "L1-Groups.xlsx", "LANG-Groups.xlsx"]



PREVIEW = {
    "term": TERM,
    "baseUpdatedAt": "2026-08-24T09:00:00+00:00",
    "filename": "revised.xls",
    "summary": {"unchanged": 970, "changed": 4, "added": 1, "removed": 0},
    "courses": [
        {
            "crn": "22151",
            "code": "MATH-001-CM-GR.A",
            "title": "Pre-Calculus",
            "status": "present",
            "sessions": [
                {
                    "status": "changed",
                    "sessionId": "s1",
                    "changes": ["room 7.113 → 9.001"],
                    "matchedOn": "same day, same start time",
                    "isCertain": True,
                }
            ],
        }
    ],
}


def test_previewing_forwards_the_export_and_returns_the_diff(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["token"] = request.headers.get("X-Admin-Token")
        seen["has_timetable"] = "revised-bytes" in request.content.decode("latin-1")
        return httpx.Response(status.HTTP_200_OK, json=PREVIEW)

    response = use(client, handler).post(
        "/api/v1/timetables/terms/term-1/timetable/preview",
        files={"timetable": ("revised.xls", b"revised-bytes", "application/vnd.ms-excel")},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["courses"][0]["sessions"][0]["changes"] == ["room 7.113 → 9.001"]
    assert seen == {
        "path": "/api/v1/admin/terms/term-1/timetable/preview",
        "token": "secret",
        "has_timetable": True,
    }


def test_an_empty_export_is_refused_before_the_platform_is_called(client: TestClient):
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("the platform should not be called")

    response = use(client, handler).post(
        "/api/v1/timetables/terms/term-1/timetable/preview",
        files={"timetable": ("revised.xls", b"", "application/vnd.ms-excel")},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_applying_forwards_the_version_and_the_approved_rows(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        # No files attached, so httpx sends a urlencoded form and the timestamp arrives escaped.
        form = parse_qs(request.content.decode())
        seen["has_version"] = form["base_updated_at"] == [PREVIEW["baseUpdatedAt"]]
        seen["has_operations"] = "updateSession" in form["operations"][0]
        return httpx.Response(status.HTTP_200_OK, json={**TERM, "applied": {"updateSession": 1}})

    response = use(client, handler).post(
        "/api/v1/timetables/terms/term-1/timetable/apply",
        data={
            "base_updated_at": PREVIEW["baseUpdatedAt"],
            "filename": "revised.xls",
            "operations": '[{"op":"updateSession","sessionId":"s1","room":"9.001"}]',
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["applied"]["updateSession"] == 1
    assert seen == {
        "path": "/api/v1/admin/terms/term-1/timetable/apply",
        "has_version": True,
        "has_operations": True,
    }


def test_attached_student_workbooks_travel_with_the_approved_rows(client: TestClient):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode("latin-1")
        seen["has_students"] = "L1-Groups.xlsx" in body
        return httpx.Response(status.HTTP_200_OK, json=TERM)

    response = use(client, handler).post(
        "/api/v1/timetables/terms/term-1/timetable/apply",
        data={
            "base_updated_at": PREVIEW["baseUpdatedAt"],
            "filename": "revised.xls",
            "operations": '[{"op":"addCourse","crn":"24999"}]',
        },
        files=[("enrolments", ("L1-Groups.xlsx", b"student-bytes", "application/vnd.ms-excel"))],
    )

    assert response.status_code == status.HTTP_200_OK
    assert seen["has_students"] is True


def test_a_review_the_platform_calls_stale_is_forwarded_as_a_conflict(client: TestClient):
    """The coordinator has to see their colleague's changes, not overwrite them."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status.HTTP_409_CONFLICT,
            json={"detail": "This semester was changed by somebody else since you uploaded the file."},
        )

    response = use(client, handler).post(
        "/api/v1/timetables/terms/term-1/timetable/apply",
        data={
            "base_updated_at": "stale",
            "filename": "revised.xls",
            "operations": '[{"op":"updateSession","sessionId":"s1"}]',
        },
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert "changed by somebody else" in response.json()["detail"]


def test_a_semester_is_imported_from_the_export_alone(client: TestClient):
    """No student lists. Enrolments are this application's own and reach the platform by publish."""
    sent: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["body"] = request.content
        return httpx.Response(201, json={"id": "term-1", "name": "S1", "studentCount": 0})

    response = use(client, handler).post(
        "/api/v1/timetables/terms",
        data={"name": "Physics & Maths — Semester 1", "timezone": "Asia/Dubai"},
        files=[("timetable", ("timetable.xls", b"timetable-bytes", "application/vnd.ms-excel"))],
    )

    assert response.status_code == status.HTTP_201_CREATED, response.text
    assert response.json()["studentCount"] == 0
    assert b"students.xlsx" not in sent["body"]
