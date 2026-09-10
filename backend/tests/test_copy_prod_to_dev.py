"""The one hazard in the copy script is a mis-set target, so that is what is pinned."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "copy_prod_to_dev.py"
spec = importlib.util.spec_from_file_location("copy_prod_to_dev", SCRIPT)
copy = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(copy)


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
        "",
    ],
)
def test_it_refuses_to_write_to_anything_but_a_local_database(url: str):
    with pytest.raises(copy.Refused):
        copy.local_only(url)


def test_it_never_names_the_token_in_what_it_raises():
    # The token is read from a file and must not reach a traceback or a log.
    copy.TOKEN_FILE = Path("/nonexistent/sorbonne-token.env")
    with pytest.raises(copy.Refused) as refusal:
        copy.token()
    assert "SORBONNE_TOKEN=" not in str(refusal.value)


class Recorder:
    """A local API that hands back ids and remembers what it was asked to write."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, str]] = []
        self.next = 0

    def __call__(self, path: str, body: dict, method: str = "POST") -> dict:
        self.calls.append((path, body, method))
        self.next += 1
        return {"id": f"local-{self.next}"}

    def one(self, method: str, contains: str) -> dict:
        found = [body for path, body, sent in self.calls if sent == method and contains in path]
        assert len(found) == 1, f"{len(found)} {method}s matching {contains}"
        return found[0]


def catalogue() -> list[dict]:
    """One set with a section that carries a request, and a nested set inside it."""
    return [
        {
            "id": "p-scope", "code": "TD", "kind": "shared", "termId": "p-term", "courses": [
                {"id": "p-course", "code": "MATH-100", "name": "Analysis", "component": "TD"},
            ],
            "groups": [
                {
                    "id": "p-group", "label": "TD 1", "capacity": 24,
                    "crns": {
                        "p-course": {
                            "crn": "23634", "teacher": "Amira Haddad", "teacherId": "t-7",
                            "hours": "24", "duration": "2h", "anticipated": 30,
                            "constraints": "not before 10", "retired": False,
                            # Said about nothing, and so not worth a field in the request.
                            "comments": "", "roomPref": "", "weeks": "", "sessionsPerWeek": "",
                            "dayPref": "", "timePref": "",
                        }
                    },
                }
            ],
        },
        {
            "id": "p-nested", "code": "TP", "kind": "nested", "parentScopeId": "p-scope",
            "termId": "p-term", "courses": [],
            "groups": [{"id": "p-sub", "label": "TP a", "parentGroupId": "p-group", "crns": {}}],
        },
    ]


def test_a_section_arrives_with_the_request_on_it_and_not_only_its_crn():
    """The CRN is the cell; the request is everything the timetabler asked for.

    Copying the CRN alone left production's confirmed teachers, hours, anticipated sizes
    and constraints behind, so a copy read "Not confirmed" for every teacher on it.
    """
    write = Recorder()

    requests = copy._copy_catalogue(write, catalogue(), "here", {"p-term": "local-term"}, {})

    assert requests == 1
    cell = write.one("PUT", "/courses/")
    assert cell == {"crn": "23634", "teacher": "Amira Haddad"}
    assert write.one("PATCH", "/courses/") == {
        "teacherId": "t-7", "hours": "24", "duration": "2h",
        "anticipated": 30, "constraints": "not before 10",
    }


def test_a_set_and_a_group_inside_another_still_name_it_after_the_copy():
    # The ids change on the way over, so a parent named by its production id is a parent
    # that does not exist here — the nesting is quietly flattened.
    write = Recorder()
    group_id: dict[str, str] = {}

    copy._copy_catalogue(write, catalogue(), "here", {}, group_id)

    scopes = [body for path, body, _ in write.calls if path.endswith("/scopes")]
    assert scopes[0]["parentScopeId"] == ""
    assert scopes[1]["parentScopeId"] == "local-1", "the nested set must name the local parent"
    groups = [body for path, body, _ in write.calls if path.endswith("/groups")]
    assert groups[1]["parentGroupId"] == group_id["p-group"]


def test_a_course_carries_which_part_of_it_this_set_is():
    # Every course in production names a component. Without it a card cannot say whether
    # the set it is looking at is the lecture or the tutorial.
    write = Recorder()

    copy._copy_catalogue(write, catalogue(), "here", {}, {})

    assert write.one("POST", "/courses")["component"] == "TD"


class Wire:
    """Stands in for `call`, answering reads from a script and remembering the writes."""

    def __init__(self, answers: dict):
        self.answers = answers
        self.writes: list[tuple[str, str, dict]] = []

    def __call__(self, url, *, headers, method="GET", body=None):
        if method == "GET":
            for path, answer in self.answers.items():
                if url.endswith(path):
                    return answer
            raise AssertionError(f"nothing scripted for {url}")
        self.writes.append((method, url, body or {}))
        return {"id": "made"}

    def sent(self, contains: str) -> list[dict]:
        return [body for _, url, body in self.writes if contains in url]


def test_the_register_carries_what_the_department_said_about_it(monkeypatch):
    """The list was always copied; what we had SAID about it was not.

    Measured on production the day this was fixed: 25 courses with a UE, 31 with a
    mutualized answer, 129 CRNs hanging from a parent — every one typed by hand, and every
    one lost by a copy that took the codes and nothing else.
    """
    wire = Wire(
        {
            "/active-courses": {"courses": [{"id": "p1", "courseCode": "MATH-351", "title": "Algebra", "ue": "LU3MA276", "mutualized": "yes"}]},
            "/active-crns": {"crns": [{"id": "p2", "termCode": "262710", "crn": "24311", "courseCode": "MATH-351", "parentCrn": "24264"}]},
            "/term-links": {"links": {}},
        }
    )
    monkeypatch.setattr(copy, "call", wire)

    copy._copy_register(
        {"source": "https://prod", "into": "http://localhost:8000", "read": {}, "write": {}},
        {},
        say=lambda *_: None,
        dry_run=False,
    )

    [course] = [body for method, url, body in wire.writes if method == "PATCH" and "/active-courses/" in url]
    assert (course["ue"], course["mutualized"]) == ("LU3MA276", "yes")
    [crn] = [body for method, url, body in wire.writes if method == "PATCH" and "/active-crns/" in url]
    assert crn == {"parentCrn": "24264"}


def test_an_exemption_travels_under_the_id_the_course_has_here(monkeypatch):
    """The ids change on the way over, and an exemption names a course by id.

    A shared set is filed under whichever cohort holds its row, so every cohort's listing
    carries the languages — hence one write, not four.
    """
    listed = {"exemptions": [{"studentId": "A001", "courseId": "p-lang", "courseCode": "SCEN-101", "reason": "Native speaker"}]}
    wire = Wire({"/cohorts/c1/exemptions": listed, "/cohorts/c2/exemptions": listed})
    monkeypatch.setattr(copy, "call", wire)

    written = copy._copy_exemptions(
        "https://prod", "http://localhost:8000", {}, {},
        [{"id": "c1"}, {"id": "c2"}], {"p-lang": "here-lang"}, say=lambda *_: None,
    )

    assert written == 1
    [body] = wire.sent("/students/A001/exemptions/here-lang")
    assert body == {"reason": "Native speaker"}


def test_a_check_answered_the_same_as_the_default_is_not_written(monkeypatch):
    # A row that agrees with the code's default says nothing and would only have to be
    # kept in step with it.
    wire = Wire(
        {
            "/checks": {
                "checks": [
                    {"name": "collision", "enabled": True, "threshold": 30, "defaultEnabled": True, "defaultThreshold": 30},
                    {"name": "other", "enabled": False, "threshold": 0, "defaultEnabled": True, "defaultThreshold": 0},
                ]
            }
        }
    )
    monkeypatch.setattr(copy, "call", wire)

    copy._copy_checks("https://prod", "http://localhost:8000", {}, {}, {}, say=lambda *_: None)

    assert [body["enabled"] for body in wire.sent("/checks/")] == [False]
    assert not wire.sent("/checks/collision")
