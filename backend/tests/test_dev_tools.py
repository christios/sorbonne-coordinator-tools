"""The developer-only router, and the one thing that must be true about it."""

from __future__ import annotations

import importlib

import pytest

from sorbonne import config as config_module

from sorbonne.api.dev_tools import is_local


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne",
        "postgresql://a:b@127.0.0.1/db",
    ],
)
def test_a_database_on_this_machine_is_local(url: str):
    assert is_local(url)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://user:pass@ep-cool-name-123456.eu-central-1.aws.neon.tech/sorbonne",
        # Starts with the right letters and is somebody else's machine entirely. This is
        # why the check is on the hostname and not on a prefix.
        "postgresql://a:b@localhost.example.com/db",
        "postgresql://a:b@10.0.0.4/db",
        "",
    ],
)
def test_a_database_anywhere_else_is_not(url: str):
    assert not is_local(url)


def test_the_router_is_absent_from_a_deployment_that_is_not_local(monkeypatch):
    """Not a 403 — absent. A guard inside a mounted route is one bad condition away from
    replaying production into production; a route never added cannot be reached."""
    monkeypatch.setattr(config_module.config, "database_url", "postgresql://a:b@db.example.com/x")
    main = importlib.reload(importlib.import_module("sorbonne.main"))
    assert not [path for path in main.app.openapi()["paths"] if "/dev/" in path]
