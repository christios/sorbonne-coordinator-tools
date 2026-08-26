# Sorbonne Coordinator Tools

The SCEN academic-coordination workspace for Sorbonne University Abu Dhabi. It contains a syllabus builder with Word export, a part-time teacher database with teacher-linked requisitions, a coordinator handbook, and a retained course-roster converter. The roster converter is currently hidden from the welcome page but its API and route remain in the codebase.

Production: <https://sorbonne-coordinator-tools.fastapicloud.dev/>

## What is deployed

| Route | Purpose |
| --- | --- |
| `/` | Tool launcher (Syllabus Builder, Part-time Teacher Database, Student timetables, and Coordinator Handbook) |
| `/#/syllabus` | Create, organise, edit, compare, and export SCEN syllabi |
| `/#/timetables` | Upload SCEN semester timetables and student group lists to the Student Platform, and edit its announcement strip |
| `/#/teachers` | Manage part-time teacher profiles, folders, teacher-linked requisitions, the course catalogue, and (when configured) Google Form document intake |
| `/#/requisition` | Legacy route that redirects to `/#/teachers` |
| `/handbook/` | Static SCEN Coordinator Handbook |
| `/api/v1/syllabi` | Syllabus API |
| `/api/v1/teachers` | Teacher, folder, course-catalogue, and teacher-requisition API |
| `/api/v1/teacher-requisitions` | Individual teacher-requisition API |
| `/api/v1/rosters` | Retained roster-converter API |
| `/api/v1/auth/*` | Google sign-in: configuration, session, current user |
| `/api/v1/timetables` | Proxy to the SCEN Student Platform's coordinator API |
| `/healthcheck` | Deployment health check |

Every request is authenticated. A coordinator signs in with Google, the ID token is checked
against a staff allowlist, and the resulting signed session cookie is required by the whole
application — the API and the handbook alike. Only the health check, the sign-in endpoints,
and the static app shell answer an anonymous caller, and a deployment with no sign-in
settings closes rather than opening.

There is still no role-based access control: everyone on the allowlist can use every tool.

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

Open <http://localhost:3000/>. The frontend calls FastAPI at `http://localhost:8000` by default.
Use `localhost` rather than `127.0.0.1`: the session cookie belongs to whichever hostname you
open, and the two are different hosts as far as the browser is concerned, so a cookie set on
one is never sent to the other.

### Signing in locally

You do not. The dev server mints a session for you, so `npm run start` opens the tools already
signed in — no Google account, no client ID, nothing to click.

It is not a bypass: `frontend/vite-plugins/dev-session.js` runs `backend/scripts/dev_session.py`,
which signs a real cookie with your local `SESSION_SECRET` for the first address in
`COORDINATOR_ACCESS_EMAILS`, and the API checks it exactly as it checks one that came from
Google. The plugin only exists while Vite is serving, so no deployment can inherit it.

| Setting | Effect |
| --- | --- |
| `DEV_SESSION=off` | leaves the sign-in screen up — for testing the Google flow or the gate itself |
| `DEV_SESSION_EMAIL=someone@sorbonne.ae` | browse as that member of staff, e.g. to see what a non-administrator sees |

Both are read from the environment, so `DEV_SESSION=off npm run start` is enough for one run.
If the script cannot mint a session — no `SESSION_SECRET`, empty `COORDINATOR_ACCESS_EMAILS` —
Vite says so and leaves the sign-in screen in place.

To sign in from the command line instead, `cd backend && uv run python scripts/dev_session.py`
prints the cookie for `curl -b`.

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

Required FastAPI Cloud encrypted secrets:

- `DATABASE_URL` — the Neon PostgreSQL connection URL
- `GOOGLE_AUTH_CLIENT_ID` — the Google OAuth client ID for staff sign-in
- `COORDINATOR_ACCESS_EMAILS` — comma-separated staff e-mail addresses
- `SESSION_SECRET` — a long random string; changing it signs everyone out

**Set all three sign-in settings before deploying this branch.** Without them the
application answers 503 to every request rather than serving data unauthenticated. The
Google client ID must list the deployment's origin under *Authorised JavaScript origins*..

Optional FastAPI Cloud settings for the **Student timetables** tool (the tool shows how to
configure itself until both are set):

- `SCEN_STUDENT_PLATFORM_URL` — e.g. `https://scen-student-platform.fastapicloud.dev`
- `SCEN_STUDENT_PLATFORM_TOKEN` — that platform's coordinator access code

Timetables and announcements are stored by the student platform, never in this database.
The backend proxies every call so the access code stays server-side. Note that this
application has no login, so anyone who reaches this deployment can replace or delete a
published timetable.

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

After deployment, verify. Only the health check and the static app shell answer an
anonymous caller, so **401 is the pass** for everything else — these commands check that
each route refuses correctly rather than that it returns data:

```bash
BASE=https://sorbonne-coordinator-tools.fastapicloud.dev

curl -fsS "$BASE/healthcheck"
curl -fsS -o /dev/null "$BASE/"

for path in /handbook/ /api/v1/syllabi /api/v1/teachers /api/v1/student-database/cohorts; do
  curl -s -o /dev/null -w "$path -> %{http_code}\n" "$BASE$path"
done
```

Reading the result:

| What you see | What it means |
| --- | --- |
| `401` on the guarded routes | Healthy. The session cookie is required and missing. |
| `503` | The sign-in settings are not all set, so the deployment closed rather than opening unauthenticated. |
| `200` on a guarded route | The gate is not doing its job. Stop and investigate. |
| No answer, or a `5xx` health check | Startup failed. Migrations run in the lifespan, so a bad Alembic state stops the application before it serves anything — check the deployment log for `MultipleHeads` or a failed revision. |

The first request after a release may time out while the instance starts; retry before
concluding anything.

## Important product constraints

- Syllabi are grouped in nested folders and can be deleted. A deleted syllabus or folder cannot be recovered through the app.
- Field history coalesces rapid adjacent changes. It is not an audit trail or collaboration system.
- New syllabus templates require: a registered template definition, supported frontend renderer, DOCX-export mapping, an Alembic-safe rollout, and an approved cross-template field mapping before comparisons can work.
- The existing roster converter is intentionally retained but hidden from the launcher. Do not remove it unless the product owner asks.

## Workspace hygiene

The working tree may contain user-owned exports, temporary reports, or local automation files (for example `exports/`, `outputs/`, `tmp/`, and `transfer_suad_grades.py`). They are outside the deployed application scope. Do not stage, modify, or delete them unless the task explicitly targets them.
