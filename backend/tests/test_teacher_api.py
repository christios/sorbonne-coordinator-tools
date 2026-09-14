"""The routes behind a teacher's row in the library: what it says, and what it hands over."""

from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from sorbonne.api import teachers as api
from sorbonne.main import app
from sorbonne.services.teacher_store import TeacherStore
from tests.conftest import TEST_DATABASE_URL

BASE = "/api/v1/teachers"


@pytest.fixture
def store() -> TeacherStore:
    return TeacherStore(TEST_DATABASE_URL)


@pytest.fixture
def client(store: TeacherStore) -> TestClient:
    app.dependency_overrides[api.get_store] = lambda: store
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(api.get_store, None)


def a_teacher(store: TeacherStore) -> dict:
    return store.create_teacher(full_name=f"Dr Row {uuid4()}")


def with_hours(store: TeacherStore, teacher_id: str, label: str, hours: list[str]) -> dict:
    """A requisition whose courses carry these hours, written the way a person types them."""
    made = store.create_requisition(teacher_id, label=label, academic_year="2026-2027")
    content = {
        **made["content"],
        "courses": [{"id": str(index), "hours": value} for index, value in enumerate(hours)],
    }
    return store.update_requisition(
        made["id"], expected_revision=made["revision"], label=label, academic_year="2026-2027", content=content
    )


def test_a_row_is_told_what_the_teacher_has_in_one_answer(client: TestClient, store: TeacherStore):
    """Every fact on a row lives in a different table; the list asks for all of them once."""
    teacher = a_teacher(store)
    with_hours(store, teacher["id"], "Physics TD", ["21", "21 h"])
    with_hours(store, teacher["id"], "Spring extension", ["10,5"])
    store.create_time_sheet(
        teacher["id"],
        label="Older",
        academic_year="2026-2027",
        url="https://example.org/old",
        period_start="2026-07-15",
    )
    store.create_time_sheet(
        teacher["id"],
        label="Newest",
        academic_year="2026-2027",
        url="https://example.org/new",
        period_start="2026-08-15",
    )

    summary = client.get(f"{BASE}/summary").json()["summary"][teacher["id"]]

    assert summary["requisitions"] == 2
    # Hours are typed by people: "21", "21 h" and "10,5" all add up the same way here as
    # they do in the requisition editor.
    assert summary["contractedHours"] == 52.5
    assert summary["timeSheets"] == 2
    assert summary["newestTimeSheet"]["label"] == "Newest"
    assert summary["hasDocuments"] is False


def test_a_teacher_with_nothing_is_absent_from_the_summary_rather_than_wrong(
    client: TestClient, store: TeacherStore
):
    """The row falls back to "no requisition, no time sheet" on its own, so a teacher
    nobody has filed anything for costs the answer nothing."""
    teacher = a_teacher(store)
    assert teacher["id"] not in client.get(f"{BASE}/summary").json()["summary"]


def test_several_requisitions_come_back_as_one_zip_named_for_each(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)
    first = with_hours(store, teacher["id"], "Physics TD", ["21"])
    second = with_hours(store, teacher["id"], "Spring extension", ["21"])

    response = client.post(f"{BASE}/{teacher['id']}/requisitions/export", json={"ids": [first["id"], second["id"]]})

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.headers["content-type"] == "application/zip"
    with ZipFile(BytesIO(response.content)) as bundle:
        names = bundle.namelist()
    # Two requisitions for one year would otherwise be one name twice, and unpacking
    # would leave a single file where two were asked for.
    assert len(names) == 2
    assert len(set(names)) == 2
    assert all(name.endswith(".docx") for name in names)


def test_a_requisition_belonging_to_somebody_else_is_refused_not_dropped(
    client: TestClient, store: TeacherStore
):
    """A zip quietly missing one of the things that was ticked is worse than an error."""
    mine = a_teacher(store)
    theirs = a_teacher(store)
    ours = with_hours(store, mine["id"], "Physics TD", ["21"])
    not_ours = with_hours(store, theirs["id"], "Someone else's", ["21"])

    response = client.post(
        f"{BASE}/{mine['id']}/requisitions/export", json={"ids": [ours["id"], not_ours["id"]]}
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_a_time_sheet_carries_the_period_it_covers(client: TestClient, store: TeacherStore):
    """One date names the period, because the cycle runs the 15th to the 14th and a pair
    of months would record "August and September" as two periods rather than one."""
    teacher = a_teacher(store)
    made = client.post(
        f"{BASE}/{teacher['id']}/time-sheets",
        json={
            "label": "Part time sheet",
            "academicYear": "2026-2027",
            "url": "https://example.org/sheet",
            "periodStart": "2026-08-15",
        },
    )
    assert made.status_code == status.HTTP_201_CREATED, made.text
    assert made.json()["periodStart"] == "2026-08-15"

    refused = client.post(
        f"{BASE}/{teacher['id']}/time-sheets",
        json={
            "label": "Part time sheet",
            "academicYear": "2026-2027",
            "url": "https://example.org/other",
            "periodStart": "the middle of August",
        },
    )
    assert refused.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    # A sheet nobody has dated is allowed: it is not the same as one that is overdue.
    undated = client.post(
        f"{BASE}/{teacher['id']}/time-sheets",
        json={"label": "Undated", "academicYear": "2026-2027", "url": "https://example.org/undated"},
    )
    assert undated.status_code == status.HTTP_201_CREATED, undated.text
    assert undated.json()["periodStart"] == ""

    # Newest period first, and the undated one last rather than in the middle.
    held = client.get(f"{BASE}/{teacher['id']}/time-sheets").json()["items"]
    assert [row["label"] for row in held] == ["Part time sheet", "Undated"]


def test_several_teachers_requisitions_come_back_in_a_folder_each(client: TestClient, store: TeacherStore):
    """A payroll run of a dozen people unpacked into one directory is a wall of files."""
    first = a_teacher(store)
    second = a_teacher(store)
    barren = a_teacher(store)
    with_hours(store, first["id"], "Physics TD", ["21"])
    with_hours(store, first["id"], "Spring extension", ["21"])
    with_hours(store, second["id"], "Maths TD", ["42"])

    response = client.post(
        f"{BASE}/export/requisitions",
        json={"teacherIds": [first["id"], second["id"], barren["id"]]},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.headers["content-type"] == "application/zip"
    with ZipFile(BytesIO(response.content)) as bundle:
        names = bundle.namelist()
    assert len(names) == 3
    assert len({name.split("/")[0] for name in names}) == 2
    assert all("/" in name for name in names)
    # The teacher nobody has contracted yet is counted, not treated as a failure.
    assert response.headers["X-Teachers-Without-Requisitions"] == "1"


def test_choosing_only_teachers_with_nothing_to_download_says_so(client: TestClient, store: TeacherStore):
    """Rather than handing back an empty zip that looks like it worked."""
    barren = a_teacher(store)
    response = client.post(f"{BASE}/export/requisitions", json={"teacherIds": [barren["id"]]})
    assert response.status_code == status.HTTP_404_NOT_FOUND
