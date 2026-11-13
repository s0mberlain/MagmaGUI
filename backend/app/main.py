import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from app import __version__
from app.api import admin, audit_log, auth, business, scores, usecases, users
from app.config import Settings, get_settings
from app.db import make_engine
from app.startup import initialize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

system = APIRouter(tags=["system"])


@system.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@system.get("/version")
def version() -> dict[str, str]:
    return {"name": get_settings().app_name, "version": __version__}


def _mount_frontend(app: FastAPI, static_dir: Path) -> None:
    """Serve the built single-page app; unknown non-API paths fall back to index.html."""
    index = static_dir / "index.html"
    if not index.is_file():
        return

    assets = static_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    root = static_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (static_dir / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.auto_migrate:
            initialize(engine, session_factory, settings)
        yield
        engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.engine = engine
    app.state.sessionmaker = session_factory
    app.dependency_overrides[get_settings] = lambda: settings

    api = APIRouter(prefix="/api")
    for r in (
        system,
        auth.router,
        users.router,
        usecases.router,
        business.router,
        audit_log.router,
        scores.router,
        admin.router,
    ):
        api.include_router(r)
    app.include_router(api)
    _mount_frontend(app, settings.static_dir)
    return app


app = create_app()
