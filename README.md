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

Deploy `backend/` to FastAPI Cloud and connect a standalone Neon project through FastAPI Cloud's Neon integration. It provisions `DATABASE_URL` as an encrypted secret. Before switching production traffic, run the Alembic migration against that Neon URL:

```bash
DATABASE_URL='postgresql+psycopg://…' uv run alembic upgrade head
DATABASE_URL='postgresql+psycopg://…' uv run python scripts/migrate_sqlite_syllabi.py
```

Use a separate frontend host or configure the frontend's `VITE_API_BASE_URL` to the FastAPI Cloud URL.
