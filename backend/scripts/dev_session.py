"""Mint a local staff session cookie, for testing without a Google client ID.

    uv run python scripts/dev_session.py            # prints the cookie
    uv run python scripts/dev_session.py --browser  # prints a one-line snippet to
                                                    # paste into the browser console

It signs the cookie with this deployment's SESSION_SECRET and the e-mail must be on
COORDINATOR_ACCESS_EMAILS, so it exercises the real gate rather than bypassing it.
Never run it against a deployed environment.
"""

from __future__ import annotations

import argparse

from sorbonne.config import config
from sorbonne.services.staff_auth import SESSION_COOKIE, StaffUser, issue_session, owner_emails


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default=None, help="defaults to the first allowlisted address")
    parser.add_argument("--browser", action="store_true", help="print a document.cookie snippet")
    arguments = parser.parse_args()

    if not config.session_secret:
        print("SESSION_SECRET is not set in backend/.env")
        return 1
    email = arguments.email or next(iter(sorted(owner_emails())), "")
    if not email:
        print("COORDINATOR_ACCESS_EMAILS is empty, so nobody may sign in")
        return 1

    token = issue_session(StaffUser(email=email, name=email.split("@")[0]))
    if arguments.browser:
        print(f'document.cookie = "{SESSION_COOKIE}={token}; path=/"; location.reload()')
    else:
        print(f"{SESSION_COOKIE}={token}")
    print(f"\n# signed in as {email}, valid for {config.session_hours} hours", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
