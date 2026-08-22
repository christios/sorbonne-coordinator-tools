from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from sorbonne.api.auth import router as auth_router
from sorbonne.api.bibliography_lookup import router as bibliography_lookup_router
from sorbonne.api.rosters import router as rosters_router
from sorbonne.api.student_database import router as student_database_router
from sorbonne.api.syllabus_catalogues import router as syllabus_catalogues_router
from sorbonne.api.syllabi import router as syllabi_router
from sorbonne.api.teachers import requisition_router as teacher_requisitions_router
from sorbonne.api.teachers import router as teachers_router
from sorbonne.api.teacher_documents import router as teacher_documents_router
from sorbonne.api.timetables import router as timetables_router
from sorbonne.api.users import router as users_router
from sorbonne.config import config
from sorbonne.services.auth_gate import StaffAuthGate
from sorbonne.services.migrations import apply_schema_migrations


# Public pages the Google consent screen links to. They sit outside the sign-in
# gate on purpose: somebody deciding whether to sign in cannot be asked to sign in
# first.
LEGAL_PAGES = Path(__file__).resolve().parent / "assets" / "legal"


@asynccontextmanager
async def lifespan(_: FastAPI):
    apply_schema_migrations(config.database_url)
    yield


app = FastAPI(title="Sorbonne Coordinator Tools API", lifespan=lifespan)

app.add_middleware(StaffAuthGate)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(rosters_router, prefix="/api/v1")
app.include_router(teachers_router, prefix="/api/v1")
app.include_router(teacher_requisitions_router, prefix="/api/v1")
app.include_router(teacher_documents_router, prefix="/api/v1")
app.include_router(syllabi_router, prefix="/api/v1")
app.include_router(syllabus_catalogues_router, prefix="/api/v1")
app.include_router(bibliography_lookup_router, prefix="/api/v1")
app.include_router(timetables_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(student_database_router, prefix="/api/v1")
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


@app.get("/requisition", include_in_schema=False)
async def requisition_frontend() -> FileResponse:
    return frontend_entrypoint()


@app.get("/timetables", include_in_schema=False)
async def timetables_frontend() -> FileResponse:
    return frontend_entrypoint()


@app.get("/privacy", include_in_schema=False)
async def privacy_policy() -> FileResponse:
    return FileResponse(LEGAL_PAGES / "privacy.html")


@app.get("/terms", include_in_schema=False)
async def terms_of_use() -> FileResponse:
    return FileResponse(LEGAL_PAGES / "terms.html")


@app.get("/healthcheck")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
