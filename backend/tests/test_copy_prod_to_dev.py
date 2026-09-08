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
