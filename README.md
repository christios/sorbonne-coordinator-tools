# Sorbonne Coordinator Tools

The SCEN academic-coordination workspace for Sorbonne University Abu Dhabi. It contains a syllabus builder with Word export, a coordinator handbook, and a retained course-roster converter. The roster converter is currently hidden from the welcome page but its API and route remain in the codebase.

Production: <https://sorbonne-coordinator-tools.fastapicloud.dev/>

## What is deployed

| Route | Purpose |
| --- | --- |
| `/` | Tool launcher (currently Syllabus Builder and Coordinator Handbook) |
| `/#/syllabus` | Create, organise, edit, compare, and export SCEN syllabi |
| `/handbook/` | Static SCEN Coordinator Handbook |
| `/api/v1/syllabi` | Syllabus API |
| `/api/v1/rosters` | Retained roster-converter API |
| `/healthcheck` | Deployment health check |

There is currently no authentication or role-based access control. Treat the deployed site and handbook content as accessible to anyone with the URL.

## Architecture

```text
frontend/     React + Vite + TypeScript user interface
backend/      FastAPI API, Alembic migrations, PostgreSQL repository, DOCX export
handbook/     MkDocs source for the Coordinator Handbook
docs/         Architecture decision records
```

- **Database:** PostgreSQL in every environment. Local development uses Docker; production uses Neon.
- **Deployment:** GitHub Actions builds the React and MkDocs bundles, then deploys one FastAPI Cloud application from `main`.
- **Syllabus templates:** approved template definitions live in `backend/sorbonne/services/syllabus_templates.py`; the current English SCEN DOCX source is in `backend/sorbonne/assets/`. Template IDs determine the editor structure and DOCX export. See [ADR-001](docs/decisions/ADR-001-template-aware-syllabi.md) before adding another template or enabling cross-template comparisons.
- **Handbook ownership:** `handbook/` is the version-controlled source of the deployed handbook. It was imported from a non-versioned local MkDocs project; do not treat that old external folder as the maintained source. The original email archive was deliberately excluded and must not be added to this repository or deployment.

## Prerequisites

- Python 3.11 or later and [uv](https://docs.astral.sh/uv/)
- Node.js 22 and npm
- Docker Desktop (for the local PostgreSQL database)

## Local development

Use four terminals when working on all parts of the application. The ports are intentional: FastAPI uses `8000`, MkDocs uses `8001`, and Vite uses `3000`.

### 1. Configure and start PostgreSQL

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up -d postgres

cd backend
uv sync --all-groups
uv run alembic upgrade head
```

The default local database URL is `postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne`.

Only when migrating a pre-PostgreSQL prototype that contains syllabus data, run this one-time command after the schema migration:

```bash
uv run python scripts/migrate_sqlite_syllabi.py
```

Do not run that legacy migration against a new or production database without first confirming the source SQLite file and taking a database backup.

### 2. Start the API

```bash
cd backend
uv run uvicorn sorbonne.main:app --reload --port 8000
```

The application also applies Alembic migrations at startup. Keep the explicit `alembic upgrade head` step above for predictable local setup and release work.

### 3. Start the frontend

```bash
cd frontend
npm ci
npm run start
```

Open <http://127.0.0.1:3000/>. The frontend calls FastAPI at `http://localhost:8000` by default.

### 4. Preview the handbook

```bash
cd handbook
uv run --with mkdocs-material mkdocs serve --dev-addr 127.0.0.1:8001
```

The launcher opens `http://127.0.0.1:8001/` in local development. Set `VITE_HANDBOOK_URL` in `frontend/.env` only if you intentionally serve the handbook elsewhere, then restart Vite.

## Verification commands

Run these before committing a functional change:

```bash
# Backend
cd backend
uv run pytest tests -q
uv run ruff check .

# Frontend
cd ../frontend
npm test
npm run lint
npm run build

# Handbook
cd ../handbook
uv run --with mkdocs-material mkdocs build --config-file mkdocs.yml --site-dir ../backend/handbook-dist
```

`backend/frontend-dist/` and `backend/handbook-dist/` are generated deployment artifacts and are intentionally ignored by Git.

## Deploying

Pushing to `main` triggers [the GitHub Actions deployment workflow](.github/workflows/deploy-fastapi-cloud.yml). It:

1. builds the frontend into `backend/frontend-dist/`;
2. builds the handbook into `backend/handbook-dist/`;
3. uploads the FastAPI app and both static bundles to FastAPI Cloud.

Required GitHub Actions secrets:

- `FASTAPI_CLOUD_TOKEN`
- `FASTAPI_CLOUD_APP_ID`

Required FastAPI Cloud encrypted secret:

- `DATABASE_URL` — the Neon PostgreSQL connection URL.

For a manual release, build both static bundles in the same order before running `uv run fastapi deploy .` from `backend/`. Prefer the GitHub workflow so the release uses the configured secrets and is recorded in Actions.

After deployment, verify:

```bash
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/healthcheck
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/handbook/ > /dev/null
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/api/v1/syllabi > /dev/null
```

## Important product constraints

- Syllabi are grouped in nested folders and can be deleted. A deleted syllabus or folder cannot be recovered through the app.
- Field history coalesces rapid adjacent changes. It is not an audit trail or collaboration system.
- New syllabus templates require: a registered template definition, supported frontend renderer, DOCX-export mapping, an Alembic-safe rollout, and an approved cross-template field mapping before comparisons can work.
- The existing roster converter is intentionally retained but hidden from the launcher. Do not remove it unless the product owner asks.

## Workspace hygiene

The working tree may contain user-owned exports, temporary reports, or local automation files (for example `exports/`, `outputs/`, `tmp/`, and `transfer_suad_grades.py`). They are outside the deployed application scope. Do not stage, modify, or delete them unless the task explicitly targets them.
