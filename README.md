# Sorbonne Coordinator Tools

The SCEN academic-coordination workspace for Sorbonne University Abu Dhabi. It contains a syllabus builder with Word export, a part-time teacher database with teacher-linked requisitions, a coordinator handbook, and a retained course-roster converter. The roster converter is currently hidden from the welcome page but its API and route remain in the codebase.

Production: <https://sorbonne-coordinator-tools.fastapicloud.dev/>

## What is deployed

| Route | Purpose |
| --- | --- |
| `/` | Tool launcher (Syllabus Builder, Part-time Teacher Database, and Coordinator Handbook) |
| `/#/syllabus` | Create, organise, edit, compare, and export SCEN syllabi |
| `/#/teachers` | Manage part-time teacher profiles, folders, teacher-linked requisitions, the course catalogue, and (when configured) Google Form document intake |
| `/#/requisition` | Legacy route that redirects to `/#/teachers` |
| `/handbook/` | Static SCEN Coordinator Handbook |
| `/api/v1/syllabi` | Syllabus API |
| `/api/v1/teachers` | Teacher, folder, course-catalogue, and teacher-requisition API |
| `/api/v1/teacher-requisitions` | Individual teacher-requisition API |
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

The [UI/UX handoff](docs/handoffs/ui-ux-decisions.md) captures the product decisions that should guide future interface work.

For new development sessions, start with the durable [project memory and working agreement](AGENTS.md).

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

Optional FastAPI Cloud encrypted secret:

- `GOOGLE_BOOKS_API_KEY` — enables Google Books as the server-side fallback when Open Library has no book result. Keep this key server-side; it is never exposed to the browser.

### Optional teacher-document workflow

The Google Form workflow is deliberately disabled until all of the following encrypted FastAPI Cloud settings are provided:

- `GOOGLE_DOCUMENTS_OAUTH_CLIENT_ID`
- `GOOGLE_DOCUMENTS_SERVICE_ACCOUNT_JSON`
- `GOOGLE_DOCUMENTS_RESPONSE_SHEET_ID`, `GOOGLE_DOCUMENTS_RESPONSE_SHEET_RANGE`, `GOOGLE_DOCUMENTS_RESPONSE_EMAIL_HEADER`, and `GOOGLE_DOCUMENTS_RESPONSE_TIMESTAMP_HEADER`
- `GOOGLE_DOCUMENTS_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_DOCUMENTS_ACCESS_EMAILS` — a comma-separated allowlist of named staff accounts

The frontend build additionally needs the same non-secret OAuth client ID as `VITE_GOOGLE_DOCUMENTS_CLIENT_ID`. At sync time, the allowlisted coordinator grants a short-lived Drive and Sheets token; the backend verifies that it belongs to the same Google account as their ID token, and never persists it. Never put the service-account JSON or any access token in frontend configuration.

Before enabling the workflow, create a dedicated managed Drive root in the coordinator account that will authorize syncs; it should contain only app-managed teacher folders. Share that root with the service account as a reader so the server can produce ZIP downloads. Staff sync manually from the teacher library; the latest timestamped submission for each exact email replaces the current managed folder contents. See [the teacher database specification](docs/specs/part-time-teacher-database.md#google-form-document-intake) for the operational behaviour.

For a manual release, your shell needs `FASTAPI_CLOUD_TOKEN` and `FASTAPI_CLOUD_APP_ID`. Build the same static bundles as the workflow, then deploy from `backend/`:

```bash
cd frontend
VITE_API_BASE_URL="" VITE_BASE_PATH=/ VITE_OUT_DIR=../backend/frontend-dist npm run build

cd ../backend
uv run --with mkdocs-material mkdocs build \
  --config-file ../handbook/mkdocs.yml \
  --site-dir ../backend/handbook-dist
uv run fastapi deploy . --no-wait
```

Prefer the GitHub workflow so the release uses the configured secrets and is recorded in Actions.

After deployment, verify:

```bash
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/healthcheck
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/handbook/ > /dev/null
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/api/v1/syllabi > /dev/null
curl -fsS https://sorbonne-coordinator-tools.fastapicloud.dev/api/v1/teachers > /dev/null
```

## Important product constraints

- Syllabi are grouped in nested folders and can be deleted. A deleted syllabus or folder cannot be recovered through the app.
- Field history coalesces rapid adjacent changes. It is not an audit trail or collaboration system.
- New syllabus templates require: a registered template definition, supported frontend renderer, DOCX-export mapping, an Alembic-safe rollout, and an approved cross-template field mapping before comparisons can work.
- The existing roster converter is intentionally retained but hidden from the launcher. Do not remove it unless the product owner asks.

## Workspace hygiene

The working tree may contain user-owned exports, temporary reports, or local automation files (for example `exports/`, `outputs/`, `tmp/`, and `transfer_suad_grades.py`). They are outside the deployed application scope. Do not stage, modify, or delete them unless the task explicitly targets them.
