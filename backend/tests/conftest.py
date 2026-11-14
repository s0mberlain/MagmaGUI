import os

# Startup refuses a missing or weak SECRET_KEY (app/config.py); tests use a fixed strong one.
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789-abcdefghijklmnop")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app

ADMIN_PW = "admin-password-123"


# Run the suite against PostgreSQL with TEST_DATABASE_URL=postgresql+psycopg://user:pw@host/db.
# The database is emptied before each test.
PG_URL = os.environ.get("TEST_DATABASE_URL", "")


def _reset_postgres(url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


@pytest.fixture
def db_url(tmp_path) -> str:
    if PG_URL:
        _reset_postgres(PG_URL)
        return PG_URL
    return f"sqlite:///{tmp_path}/test.db"


@pytest.fixture
def settings(tmp_path, db_url) -> Settings:
    return Settings(
        database_url=db_url,
        static_dir=tmp_path / "static",
        admin_user="admin",
        admin_password=ADMIN_PW,
        snapshot_schedule="off",
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


def login(client: TestClient, username: str, password: str) -> TestClient:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def admin(app):
    with TestClient(app) as c:
        yield login(c, "admin", ADMIN_PW)


@pytest.fixture
def make_user(app, admin):
    clients = []

    def _make(role: str, username: str | None = None) -> TestClient:
        username = username or f"{role}1"
        pw = f"{role}-password-123"
        r = admin.post("/api/users", json={"username": username, "role": role, "password": pw})
        assert r.status_code == 201, r.text
        c = TestClient(app)
        clients.append(c)
        return login(c, username, pw)

    yield _make
    for c in clients:
        c.close()
