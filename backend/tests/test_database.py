"""Database portability: schema matches the models, data copy SQLite -> SQLite/PostgreSQL.

Runs against PostgreSQL too when TEST_DATABASE_URL is set (see conftest.py).
"""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.cli import main as cli
from app.config import Settings
from app.db import Base, exclusive, make_engine, normalize_url, try_job_lock
from app.dbcopy import CopyError, copy_database
from app.demo import apply_demo_data
from app.models import ConfigCommit, L3UseCase, User
from app.startup import initialize, migrate


def test_normalize_url():
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgresql://u@h/db") == "postgresql+psycopg://u@h/db"
    assert normalize_url("postgresql+psycopg://u@h/db") == "postgresql+psycopg://u@h/db"
    assert normalize_url("sqlite:////data/x.db") == "sqlite:////data/x.db"


def test_migrations_match_models(db_url):
    engine = make_engine(db_url)
    migrate(engine)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    engine.dispose()
    assert diff == []


def test_ready_reports_database(anon, db_url):
    r = anon.get("/api/ready")
    assert r.status_code == 200
    assert r.json()["database"] == ("postgresql" if db_url.startswith("postgres") else "sqlite")


def test_locks_are_usable(db_url):
    engine = make_engine(db_url)
    with exclusive(engine, "test"):
        pass
    factory = sessionmaker(bind=engine)
    with factory() as db:
        assert try_job_lock(db, "test")
    engine.dispose()


def _filled_sqlite(tmp_path) -> str:
    url = f"sqlite:///{tmp_path}/source.db"
    s = Settings(database_url=url, admin_password="admin-password-123", snapshot_schedule="off")
    engine = make_engine(url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    initialize(engine, factory, s)
    with factory() as db:
        apply_demo_data(db, 7)
    engine.dispose()
    return url


def test_copy_database(tmp_path, db_url):
    source = _filled_sqlite(tmp_path)
    src = make_engine(source)
    with src.connect() as c:
        expected = {
            t.name: c.scalar(select(func.count()).select_from(t))
            for t in Base.metadata.sorted_tables
        }
    src.dispose()

    res = copy_database(source, db_url)
    assert res.rows == expected
    assert res.rows["l3_use_cases"] >= 169 and res.rows["config_commits"] > 0

    # a second copy into the now filled target is refused unless --replace
    try:
        copy_database(source, db_url)
        raise AssertionError("expected CopyError")
    except CopyError as e:
        assert "not empty" in str(e)
    assert copy_database(source, db_url, replace=True).rows == expected

    # the copied app works and new rows get fresh ids (sequences moved on PostgreSQL)
    engine = make_engine(db_url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        before = db.scalar(select(func.max(User.id)))
        db.add(User(username="new-user", role="analyst"))
        db.commit()
        assert db.scalar(select(User.id).where(User.username == "new-user")) > before
        rule = db.scalar(select(L3UseCase).limit(1))
        assert isinstance(rule.attack_techniques, list)
        assert db.scalar(select(ConfigCommit).limit(1)).created_at.tzinfo is not None or not (
            db_url.startswith("postgres")
        )
    engine.dispose()


def test_cli_db_copy(tmp_path, capsys):
    source = _filled_sqlite(tmp_path)
    target = f"sqlite:///{tmp_path}/target.db"
    assert cli(["db-copy", "--source", source, "--target", target]) == 0
    assert "l3_use_cases" in capsys.readouterr().out
    assert cli(["db-copy", "--source", source, "--target", target]) == 1
    assert "not empty" in capsys.readouterr().err


def test_config_revision_is_unique_per_use_case(db_url):
    import pytest
    from sqlalchemy.exc import IntegrityError

    s = Settings(database_url=db_url, admin_password="admin-password-123", snapshot_schedule="off")
    engine = make_engine(db_url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    initialize(engine, factory, s)
    with factory() as db:
        rule = db.scalar(select(L3UseCase).limit(1))
        for n in (1, 2):
            db.add(
                ConfigCommit(
                    l3_id=rule.id, rev=1, sha=f"{n:064d}", content="a: 1", message="m", author="x"
                )
            )
            if n == 2:
                with pytest.raises(IntegrityError):
                    db.flush()
            else:
                db.flush()
    engine.dispose()
