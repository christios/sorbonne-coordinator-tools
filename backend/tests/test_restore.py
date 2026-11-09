"""Putting back a deleted cohort from a backup, as on 9 Nov 2026 when FYS was deleted from
Semester 2 and took its Semester 1 sets and every student's French group with it."""

from __future__ import annotations

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text

from sorbonne.api import restore as restore_api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.table_copy import RESTORABLE, export_table
from tests.conftest import TEST_DATABASE_URL

NOW = "2026-11-09T08:00:00+00:00"


@pytest.fixture
def engine():
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for name in reversed(RESTORABLE):
            connection.execute(text(f'DELETE FROM "{name}"'))  # noqa: S608
        connection.execute(text("DELETE FROM students WHERE student_id IN ('A1', 'A2')"))
        connection.execute(
            text("""INSERT INTO students (student_id, status, first_seen_at, last_seen_at, updated_at)
                    VALUES ('A1', 'active', :t, :t, :t), ('A2', 'active', :t, :t, :t)"""),
            {"t": NOW},
        )
        connection.execute(
            text("""INSERT INTO student_cohorts (id, name, term, created_at, updated_at)
                    VALUES ('fys', 'FYS', '2026-27', :t, :t), ('l1', 'L1', '2026-27', :t, :t)"""),
            {"t": NOW},
        )
        connection.execute(
            text("""INSERT INTO cohort_members (cohort_id, term_id, student_id, since)
                    VALUES ('fys', 'plan:1', 'A1', :t), ('fys', 'plan:2', 'A1', :t), ('l1', 'plan:1', 'A2', :t)"""),
            {"t": NOW},
        )
        # LANG: FYS's set, open to every cohort, with L1's student placed in it under FYS.
        connection.execute(
            text("""INSERT INTO cohort_scopes (id, cohort_id, code, term_id, open_to_all)
                    VALUES ('lang', 'fys', 'LANG', 'plan:1', true)""")
        )
        connection.execute(text("INSERT INTO scope_courses (id, scope_id, code) VALUES ('c1', 'lang', 'SCEN-101')"))
        connection.execute(text("INSERT INTO scope_groups (id, scope_id, label) VALUES ('g1', 'lang', 'A0-F1')"))
        connection.execute(text("INSERT INTO group_crns (group_id, course_id, crn) VALUES ('g1', 'c1', '23444')"))
        connection.execute(
            text("""INSERT INTO group_assignments (cohort_id, student_id, scope_id, group_id, updated_at)
                    VALUES ('fys', 'A1', 'lang', 'g1', :t), ('fys', 'A2', 'lang', 'g1', :t)"""),
            {"t": NOW},
        )
        connection.execute(text("INSERT INTO course_exemptions (student_id, course_id) VALUES ('A1', 'c1')"))
    yield engine
    # Gone again after each test: an open-to-all set left behind shows up in every other
    # test's cohort, and their catalogues stop being theirs.
    with engine.begin() as connection:
        for name in reversed(RESTORABLE):
            connection.execute(text(f'DELETE FROM "{name}"'))  # noqa: S608
        connection.execute(text("DELETE FROM students WHERE student_id IN ('A1', 'A2')"))


@pytest.fixture
def client(engine):
    app.dependency_overrides[restore_api.get_engine] = lambda: engine
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def backup(engine) -> dict:
    return {name: export_table(engine, name) for name in RESTORABLE}


def counts(engine) -> dict[str, int]:
    with engine.connect() as connection:
        return {
            name: connection.execute(text(f'SELECT count(*) FROM "{name}"')).scalar()  # noqa: S608
            for name in RESTORABLE
        }


def test_a_deleted_cohort_comes_back_whole_and_nothing_else_moves(client: TestClient, engine):
    before = backup(engine)
    held = counts(engine)
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM student_cohorts WHERE id = 'fys'"))
        # What was made in its place: a new, empty FYS.
        connection.execute(
            text(
                "INSERT INTO student_cohorts (id, name, term, created_at, updated_at)"
                " VALUES ('new', 'FYS', '2026-27', :t, :t)"
            ),
            {"t": NOW},
        )
    assert counts(engine)["group_assignments"] == 0

    answer = client.post("/api/v1/restore", json={"tables": before, "removeIfEmpty": ["new"]})

    assert answer.status_code == status.HTTP_200_OK, answer.text
    assert answer.json()["removed"] == ["new"]
    assert answer.json()["restored"]["group_assignments"] == 2
    assert counts(engine) == held
    with engine.connect() as connection:
        names = connection.execute(text("SELECT name FROM student_cohorts ORDER BY id")).scalars().all()
        assert names == ["FYS", "L1"]
        # L1's student is back in their French group, under FYS as before.
        assert connection.execute(
            text("SELECT group_id FROM group_assignments WHERE student_id = 'A2'")
        ).scalar() == "g1"


def test_running_it_again_changes_nothing(client: TestClient, engine):
    before = backup(engine)

    answer = client.post("/api/v1/restore", json={"tables": before})

    assert answer.status_code == status.HTTP_200_OK
    assert set(answer.json()["restored"].values()) == {0}


def test_a_row_changed_since_the_backup_is_left_as_it_is_now(client: TestClient, engine):
    before = backup(engine)
    with engine.begin() as connection:
        connection.execute(text("UPDATE scope_groups SET label = 'A0-F1 (moved)' WHERE id = 'g1'"))

    client.post("/api/v1/restore", json={"tables": before})

    with engine.connect() as connection:
        assert connection.execute(text("SELECT label FROM scope_groups WHERE id = 'g1'")).scalar() == "A0-F1 (moved)"


def test_a_cohort_with_students_is_not_removed_and_nothing_is_restored(client: TestClient, engine):
    before = backup(engine)
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM group_assignments"))

    answer = client.post("/api/v1/restore", json={"tables": before, "removeIfEmpty": ["l1"]})

    assert answer.status_code == status.HTTP_400_BAD_REQUEST
    assert counts(engine)["group_assignments"] == 0
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM student_cohorts WHERE id = 'l1'")).scalar() == 1


def test_only_the_cohort_tables_can_be_restored(client: TestClient, engine):
    answer = client.post(
        "/api/v1/restore", json={"tables": {"api_tokens": {"columns": ["id"], "rows": [["x"]]}}}
    )

    assert answer.status_code == status.HTTP_400_BAD_REQUEST


def test_a_row_whose_parent_is_missing_fails_the_whole_restore(client: TestClient, engine):
    orphan = {
        "student_cohorts": {
            "columns": ["id", "name", "term", "created_at", "updated_at"],
            "rows": [["x", "X", "2026-27", NOW, NOW]],
        },
        "scope_groups": {"columns": ["id", "scope_id", "label"], "rows": [["gx", "no-such-set", "1"]]},
    }

    answer = client.post("/api/v1/restore", json={"tables": orphan})

    assert answer.status_code == status.HTTP_409_CONFLICT
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM student_cohorts WHERE id = 'x'")).scalar() == 0


def test_only_an_administrator_can_restore(client: TestClient, engine, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    assert client.post("/api/v1/restore", json={"tables": {}}).status_code == status.HTTP_403_FORBIDDEN
