#!/usr/bin/env bash
# Isolated entry point for this worktree.
#
# alembic/env.py and tests/conftest.py both read DATABASE_URL / TEST_DATABASE_URL
# from the process environment and fall back to the SHARED databases — they do not
# read backend/.env. Exporting them here is what keeps this worktree from colliding
# with other sessions on the same machine.
set -euo pipefail

export DATABASE_URL="postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_syllabus"
export TEST_DATABASE_URL="postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne_syllabus_test"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  test)    cd "$root/backend" && exec ./.venv/bin/python -m pytest "${@:2}" ;;
  lint)    cd "$root/backend" && exec ./.venv/bin/python -m ruff check "${@:2}" ;;
  migrate) cd "$root/backend" && exec ./.venv/bin/python -m alembic "${@:2}" ;;
  api)     cd "$root/backend" && exec ./.venv/bin/python -m uvicorn sorbonne.main:app --port 8010 --reload ;;
  web)     cd "$root/frontend" && exec npx vite --port 3010 --configLoader runner ;;
  *) echo "usage: ./dev.sh {test|lint|migrate|api|web} [args...]" >&2; exit 2 ;;
esac
