import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app import __version__, gitsync
from app import snapshots as snapshot_jobs
from app.api import (
    admin,
    attack_api,
    audit_log,
    auth,
    business,
    configs,
    gitsync_api,
    growth,
    lifecycle,
    oidc,
    output,
    scores,
    snapshots,
    transfer,
    usecases,
    users,
)
from app.config import Settings, get_settings
from app.db import make_engine
from app.startup import initialize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

system = APIRouter(tags=["system"])


@system.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@system.get("/ready")
def ready(request: Request) -> dict[str, str]:
    """Readiness: the database answers. For load balancers and orchestrators."""
    engine = request.app.state.engine
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError as e:
        raise HTTPException(503, "Database not reachable") from e
    return {"status": "ok", "database": engine.dialect.name}


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
    engine = make_engine(settings.database_url, settings)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    @event.listens_for(session_factory, "after_commit")
    def _git_after_commit(session) -> None:
        if session.info.pop("git_dirty", False) and settings.git_enabled and settings.git_auto_sync:
            gitsync.request(session_factory, settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.auto_migrate:
            initialize(engine, session_factory, settings)
        scheduler = snapshot_jobs.Scheduler(
            session_factory, settings.snapshot_schedule, settings.default_verification_days
        )
        if settings.auto_migrate:
            scheduler.start()
        if settings.git_enabled:
            gitsync.request(session_factory, settings)
        poller = gitsync.Poller(session_factory, settings)
        poller.start()
        yield
        poller.stop()
        scheduler.stop()
        engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.exception_handler(IntegrityError)
    async def _conflict(_: Request, exc: IntegrityError) -> JSONResponse:
        # e.g. two users saving the same thing at the same moment: a clean 409, not a 500
        logging.getLogger("magma.db").info("Integrity error: %s", str(exc.orig)[:300])
        return JSONResponse(
            {"detail": "This was changed by someone else at the same time. Reload and retry."},
            status_code=409,
        )

    app.state.engine = engine
    app.state.sessionmaker = session_factory
    app.dependency_overrides[get_settings] = lambda: settings

    api = APIRouter(prefix="/api")
    for r in (
        system,
        auth.router,
        oidc.router,
        users.router,
        usecases.router,
        business.router,
        audit_log.router,
        scores.router,
        admin.router,
        configs.router,
        transfer.router,
        lifecycle.router,
        snapshots.router,
        gitsync_api.router,
        gitsync_api.hook,
        growth.router,
        attack_api.router,
        output.router,
    ):
        api.include_router(r)
    app.include_router(api)
    _mount_frontend(app, settings.static_dir)
    return app


app = create_app()
