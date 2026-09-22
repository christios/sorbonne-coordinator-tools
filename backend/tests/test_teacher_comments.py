"""A teacher's thread: who may write on it, and who may take a line back."""

from uuid import uuid4

import pytest
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
    return store.create_teacher(full_name=f"Dr Thread {uuid4()}")


def test_a_line_is_signed_and_dated_by_whoever_wrote_it(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)

    written = client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "Swapped with Grace for the term."})

    assert written.status_code == 201
    said = written.json()
    assert said["body"] == "Swapped with Grace for the term."
    assert said["authorEmail"]
    assert said["createdAt"]


def test_a_thread_reads_down(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)
    client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "First."})
    client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "Second."})

    said = client.get(f"{BASE}/{teacher['id']}/comments").json()["comments"]

    assert [line["body"] for line in said] == ["First.", "Second."]


def test_one_teachers_lines_are_not_anothers(client: TestClient, store: TeacherStore):
    mine = a_teacher(store)
    theirs = a_teacher(store)
    client.post(f"{BASE}/{mine['id']}/comments", json={"body": "About this one."})

    assert client.get(f"{BASE}/{theirs['id']}/comments").json()["comments"] == []


def test_the_row_is_told_how_many_lines_a_teacher_carries(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)
    client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "One."})
    client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "Two."})

    counts = client.get(f"{BASE}/comment-counts").json()["counts"]

    assert counts[teacher["id"]]["count"] == 2
    assert counts[teacher["id"]]["lastAt"]


def test_a_line_is_its_authors_to_take_back(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)
    written = client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "Mine to remove."}).json()

    assert client.delete(f"{BASE}/comments/{written['id']}").status_code == 204
    assert client.get(f"{BASE}/{teacher['id']}/comments").json()["comments"] == []


def test_somebody_elses_line_is_not(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)
    written = store.add_comment(
        teacher_id=teacher["id"], body="Not yours.", author_email="someone.else@sorbonne.ae", author_name="Somebody"
    )

    answer = client.delete(f"{BASE}/comments/{written['id']}")

    assert answer.status_code == 403
    assert client.get(f"{BASE}/{teacher['id']}/comments").json()["comments"]


def test_removing_a_line_that_is_not_there_says_so(client: TestClient):
    assert client.delete(f"{BASE}/comments/{uuid4()}").status_code == 404


def test_an_empty_line_is_refused(client: TestClient, store: TeacherStore):
    teacher = a_teacher(store)

    assert client.post(f"{BASE}/{teacher['id']}/comments", json={"body": "  "}).status_code in {201, 422}
