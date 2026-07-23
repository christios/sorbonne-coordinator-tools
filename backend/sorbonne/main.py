from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sorbonne.api.rosters import router as rosters_router
from sorbonne.api.syllabi import router as syllabi_router
from sorbonne.config import config

app = FastAPI(title="Sorbonne Coordinator Tools API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rosters_router, prefix="/api/v1")
app.include_router(syllabi_router, prefix="/api/v1")
app.frontend("/", directory="frontend-dist", check_dir=False)


@app.get("/healthcheck")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
