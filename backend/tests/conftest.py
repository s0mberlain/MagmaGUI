import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ADMIN_PW = "admin-password-123"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path}/test.db",
        static_dir=tmp_path / "static",
        admin_user="admin",
        admin_password=ADMIN_PW,
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
