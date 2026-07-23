from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from sorbonne.api.rosters import router as rosters_router
from sorbonne.api.syllabi import router as syllabi_router
from sorbonne.config import config
from sorbonne.services.migrations import apply_schema_migrations


@asynccontextmanager
async def lifespan(_: FastAPI):
    apply_schema_migrations(config.database_url)
    yield


app = FastAPI(title="Sorbonne Coordinator Tools API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rosters_router, prefix="/api/v1")
app.include_router(syllabi_router, prefix="/api/v1")
app.mount("/handbook", StaticFiles(directory="handbook-dist", html=True, check_dir=False), name="handbook")
app.frontend("/", directory="frontend-dist", fallback="index.html", check_dir=False)


def frontend_entrypoint() -> FileResponse:
    return FileResponse("frontend-dist/index.html")


@app.get("/roster", include_in_schema=False)
async def roster_frontend() -> FileResponse:
    return frontend_entrypoint()


@app.get("/syllabus", include_in_schema=False)
async def syllabus_frontend() -> FileResponse:
    return frontend_entrypoint()


@app.get("/healthcheck")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
