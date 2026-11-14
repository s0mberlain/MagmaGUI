"""Database migrations and first-run setup."""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine

from app.config import Settings
from app.db import exclusive, wait_for_db
from app.seed import ensure_admin, seed_catalogue

log = logging.getLogger("magma.startup")
MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def alembic_config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def migrate(engine: Engine) -> None:
    cfg = alembic_config(str(engine.url.render_as_string(hide_password=False)))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


def ensure_sqlite_dir(url: str) -> None:
    prefix = "sqlite:///"
    if url.startswith(prefix) and ":memory:" not in url:
        Path(url[len(prefix) :]).parent.mkdir(parents=True, exist_ok=True)


def initialize(engine: Engine, session_factory, settings: Settings) -> None:
    ensure_sqlite_dir(settings.database_url)
    wait_for_db(engine, settings.db_wait_seconds)
    # With several replicas on one PostgreSQL, only one migrates and seeds at a time.
    with exclusive(engine, "startup"):
        migrate(engine)
        with session_factory() as db:
            fresh = seed_catalogue(db)
            ensure_admin(db, settings)
            if fresh and settings.demo_data:
                from app.demo import apply_demo_data

                apply_demo_data(
                    db, settings.demo_seed, default_interval=settings.default_verification_days
                )
