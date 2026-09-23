"""Copy prod: every table travels, nothing is translated, and it only ever writes here.

The copy used to be a step per feature, and the survey that replaced it found half the
schema missing — each absence looking, on a developer's screen, like a bug in a page. What
is pinned now is the three things that matter: it cannot write anywhere but a developer's
own database, a table nobody has decided about fails the build, and what arrives is what
left, row for row.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from sorbonne.api import export as export_api
from sorbonne.main import app
from sorbonne.services import auth_gate
from sorbonne.services.engine import engine_for
from sorbonne.services.staff_auth import StaffUser
from sorbonne.services.table_copy import (
    EXCLUDED,
    SchemaMismatch,
    copied_tables,
    export_table,
    load_tables,
    revision,
)
from tests.conftest import TEST_DATABASE_URL

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "copy_prod_to_dev.py"
spec = importlib.util.spec_from_file_location("copy_prod_to_dev", SCRIPT)
copy = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(copy)


# ---------------------------------------------------------------- where it writes


@pytest.mark.parametrize("url", ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"])
def test_it_writes_to_this_machine(url: str):
    assert copy.local_only(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://sorbonne-coordinator-tools.fastapicloud.dev",
        # Starts with the right letters and is not this machine. A prefix check passes it.
        "http://localhost.example.com/api",
        "http://10.0.0.4:8000",
        "postgresql+psycopg://user@db.neon.tech/sorbonne",
        "",
    ],
)
def test_it_refuses_to_write_to_anything_but_a_local_database(url: str):
    with pytest.raises(copy.Refused):
        copy.local_only(url)


def test_it_refuses_the_database_the_tests_empty():
    # One pytest run would destroy the copy, and the copy would destroy the tests' data.
    with pytest.raises(copy.Refused, match="sorbonne_test"):
        copy.local_database("postgresql+psycopg://localhost:5432/sorbonne_test")
    assert copy.local_database("postgresql+psycopg://localhost:5432/sorbonne")


def test_it_never_names_the_token_in_what_it_raises():
    # The token is read from a file and must not reach a traceback or a log.
    copy.TOKEN_FILE = Path("/nonexistent/sorbonne-token.env")
    with pytest.raises(copy.Refused) as refusal:
        copy.token()
    assert "SORBONNE_TOKEN=" not in str(refusal.value)


# ------------------------------------------------------------- what travels


def test_every_table_is_copied_or_left_behind_on_purpose():
    """The test that stops Copy prod quietly falling behind the schema again.

    A table added by a migration travels automatically. The only way one can fail to is to
    be named in EXCLUDED — with a reason — so a table nobody has thought about cannot be
    missing from a developer's copy without somebody having decided it should be.
    """
    engine = engine_for(TEST_DATABASE_URL)
    schema = set(inspect(engine).get_table_names())

    assert set(copied_tables(engine)) | set(EXCLUDED) == schema
    # And nothing is excluded that no longer exists, which would be a reason about nothing.
    assert set(EXCLUDED) <= schema
    assert all(reason.strip() for reason in EXCLUDED.values())


def test_the_things_the_survey_found_missing_now_travel():
    engine = engine_for(TEST_DATABASE_URL)
    travelling = set(copied_tables(engine))

    for name in (
        "warning_dismissals",
        "session_changes",
        "facility_meeting_changes",
        "student_comments",
        "teacher_comments",
        "student_history",
        "course_approvals",
        "portal_courses",
        "portal_teachers",
        "student_registrations",
        "tasks",
        "syllabi",
        "coordinator_accounts",
        "account_apps",
        "part_time_teachers",
        "pushed_time_sheets",
        "term_pay_cycles",
    ):
        assert name in travelling, name


def test_credentials_stay_behind():
    engine = engine_for(TEST_DATABASE_URL)

    assert "api_tokens" not in copied_tables(engine)
    with pytest.raises(KeyError):
        export_table(engine, "api_tokens")


# ------------------------------------------------------------ what arrives


@pytest.fixture
def seeded():
    """A few rows of every awkward kind: JSON, a timestamp, a self-numbering column, and a
    folder tree whose child sorts before its parent."""
    engine = engine_for(TEST_DATABASE_URL)
    with engine.begin() as connection:
        for name in ("warning_dismissals", "student_history", "portal_filters", "term_pay_cycles"):
            connection.execute(text(f'DELETE FROM "{name}"'))  # noqa: S608
        connection.execute(text("UPDATE syllabi SET folder_id = NULL"))
        connection.execute(text("DELETE FROM syllabus_folders"))
        connection.execute(
            text("""INSERT INTO warning_dismissals (key, dismissed_by_email, dismissed_by_name, dismissed_at)
                    VALUES ('group|A00025138|g1', 'c@sorbonne.ae', 'Christian', '2026-09-17T06:48:58+00:00')""")
        )
        connection.execute(
            text("""INSERT INTO student_history (id, seq, student_id, kind, detail, author, happened_at)
                    VALUES ('h1', 41, 'A1', 'placed', '{"group": "G.1"}', 'c', '2026-09-01'),
                           ('h2', 42, 'A1', 'removed', '{}', 'c', '2026-09-02')""")
        )
        connection.execute(
            text("""INSERT INTO portal_filters (id, kind, name, filter, created_at)
                    VALUES ('f1', 'courses', 'SCEN', '{"DEPT_CODE": ["SCEN"], "n": 2}', '2026-09-01')""")
        )
        connection.execute(
            text("""INSERT INTO term_pay_cycles (term_id, opens_on, updated_at, updated_by)
                    VALUES ('t1', 15, '2026-09-22T10:41:18+04:00', 'c')""")
        )
        connection.execute(
            text("""INSERT INTO syllabus_folders (id, name, created_at, updated_at, parent_id)
                    VALUES ('b-parent', 'Parent', 'x', 'x', NULL), ('a-child', 'Child', 'x', 'x', 'b-parent')""")
        )
    return engine


def snapshot(engine) -> dict:
    return {name: export_table(engine, name) for name in copied_tables(engine)}


def test_what_arrives_is_what_left_row_for_row(seeded):
    before = snapshot(seeded)
    # Somebody's local changes, which the copy exists to replace.
    with seeded.begin() as connection:
        connection.execute(text("DELETE FROM warning_dismissals"))
        connection.execute(
            text("""INSERT INTO warning_dismissals (key, dismissed_by_email, dismissed_by_name, dismissed_at)
                    VALUES ('local-only', '', '', 'now')""")
        )

    load_tables(seeded, before, source_revision=revision(seeded))

    assert snapshot(seeded) == before


def test_json_and_timestamps_arrive_as_themselves(seeded):
    load_tables(seeded, snapshot(seeded), source_revision=revision(seeded))

    with seeded.connect() as connection:
        found = connection.execute(text("SELECT filter FROM portal_filters WHERE id = 'f1'")).scalar()
        stamped = connection.execute(text("SELECT updated_at FROM term_pay_cycles WHERE term_id = 't1'")).scalar()
    # A dictionary, not a string holding one — JSON stored as text reads back quoted.
    assert found == {"DEPT_CODE": ["SCEN"], "n": 2}
    assert stamped.isoformat().startswith("2026-09-22T06:41:18")


def test_a_row_written_after_the_copy_does_not_collide_with_one_that_arrived(seeded):
    """The history numbers its own rows; its counter has to move past production's."""
    load_tables(seeded, snapshot(seeded), source_revision=revision(seeded))

    with seeded.begin() as connection:
        connection.execute(
            text("""INSERT INTO student_history (id, student_id, kind, happened_at)
                    VALUES ('h3', 'A1', 'placed', '2026-09-03')""")
        )
        seq = connection.execute(text("SELECT seq FROM student_history WHERE id = 'h3'")).scalar()
    assert seq > 42


def test_two_schemas_that_do_not_line_up_are_refused_and_nothing_changes(seeded):
    before = snapshot(seeded)

    with pytest.raises(SchemaMismatch, match="same revision"):
        load_tables(seeded, before, source_revision="0000_somewhere_else")

    assert snapshot(seeded) == before


def test_a_copy_missing_a_table_is_refused_whole(seeded):
    before = snapshot(seeded)
    partial = {name: rows for name, rows in before.items() if name != "warning_dismissals"}

    with pytest.raises(SchemaMismatch, match="warning_dismissals"):
        load_tables(seeded, partial, source_revision=revision(seeded))

    assert snapshot(seeded) == before


# ------------------------------------------------------ production's side


@pytest.fixture
def client():
    app.dependency_overrides[export_api.get_engine] = lambda: engine_for(TEST_DATABASE_URL)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_production_lists_every_table_with_its_revision(client: TestClient, seeded):
    listed = client.get("/api/v1/export").json()

    assert listed["revision"] == revision(seeded)
    assert {"name": "warning_dismissals", "rows": 1} in listed["tables"]
    assert "api_tokens" in listed["excluded"]


def test_production_hands_over_a_table_and_refuses_the_excluded_ones(client: TestClient, seeded):
    read = client.get("/api/v1/export/warning_dismissals").json()

    assert read["rows"][0][0] == "group|A00025138|g1"
    assert client.get("/api/v1/export/api_tokens").status_code == status.HTTP_404_NOT_FOUND
    assert client.get("/api/v1/export/no_such_table").status_code == status.HTTP_404_NOT_FOUND


def test_only_an_administrator_can_read_the_whole_database_out(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        auth_gate,
        "user_for_request",
        lambda *_args, **_kwargs: StaffUser(email="coordinator@sorbonne.ae", name="Coordinator", is_admin=False),
    )

    assert client.get("/api/v1/export").status_code == status.HTTP_403_FORBIDDEN
    assert client.get("/api/v1/export/warning_dismissals").status_code == status.HTTP_403_FORBIDDEN
