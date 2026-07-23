# Sorbonne Coordinator Tools

Internal tooling for Sorbonne University academic coordinators. The first service converts generated Course Class Roster PDFs into Excel workbooks.

## Stack

- Frontend: Vite, React, TypeScript, TanStack Query, Tailwind CSS, lucide-react
- Backend: FastAPI, Python 3.11, uv

## Local Development

Backend:

```bash
cd backend
uv run uvicorn sorbonne.main:app --reload --port 8000
```

If port 8000 is occupied, use another port such as 8001 and set `VITE_API_BASE_URL` in `frontend/.env`.

Frontend:

```bash
cd frontend
npm install
npm run start
```

The frontend expects the API at `http://localhost:8000` unless `VITE_API_BASE_URL` is set.
## Local development database

The syllabus builder uses PostgreSQL in every environment. Start the isolated local database, apply its Alembic schema, and copy any existing prototype data once:

```bash
docker compose up -d postgres
cd backend
uv sync --all-groups
uv run alembic upgrade head
uv run python scripts/migrate_sqlite_syllabi.py
```

The local `DATABASE_URL` is `postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne` by default. It is defined in [backend/.env.example](backend/.env.example); real credentials belong only in `backend/.env` or FastAPI Cloud encrypted secrets.

## FastAPI Cloud + Neon

FastAPI Cloud serves both the React frontend and the API from one deployment; Neon provides the PostgreSQL database. Store `DATABASE_URL` as an encrypted FastAPI Cloud secret. Before switching production traffic, run the Alembic migration against that Neon URL:

```bash
DATABASE_URL='postgresql+psycopg://…' uv run alembic upgrade head
DATABASE_URL='postgresql+psycopg://…' uv run python scripts/migrate_sqlite_syllabi.py
```

Before each FastAPI Cloud deployment, build the frontend into the backend's deployable static directory, then deploy the backend:

```bash
cd frontend
VITE_API_BASE_URL='' VITE_BASE_PATH=/ VITE_OUT_DIR=../backend/frontend-dist npm run build
cd ../backend
uv run fastapi deploy
```

`backend/.fastapicloudignore` explicitly includes the generated `frontend-dist/` files in the FastAPI Cloud upload. The static frontend and `/api/v1` routes are then served from the same application URL.
