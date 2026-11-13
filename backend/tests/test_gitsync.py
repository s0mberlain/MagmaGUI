import subprocess

import pytest
from fastapi.testclient import TestClient

from app import gitsync
from app.main import create_app
from tests.conftest import ADMIN_PW, login


def git(cwd, *args) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def remote(tmp_path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    return bare


@pytest.fixture
def git_admin(settings, remote, tmp_path):
    settings.git_remote_url = str(remote)
    settings.git_workdir = tmp_path / "work"
    settings.git_auto_sync = False  # sync explicitly so the test is deterministic
    with TestClient(create_app(settings)) as c:
        yield login(c, "admin", ADMIN_PW)


def test_disabled_by_default(admin):
    s = admin.get("/api/admin/git").json()
    assert not s["enabled"] and s["auth"] == "none"
    assert admin.post("/api/admin/git/sync").status_code == 409


def test_sync_commits_and_tags(git_admin, remote, tmp_path):
    a = git_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "rule: one\n", "message": "First"})
    head = a.get("/api/l3/AO-CRE-01/config").json()["head"]
    a.put(
        "/api/l3/AO-CRE-01/config",
        json={"content": "rule: two\n", "message": "Second", "base_sha": head["sha"]},
    )
    a.put("/api/l2/AO-CRE/config", json={"content": "owner: soc\n", "message": "L2 conf"})
    a.post("/api/l3/AO-CRE-01/config/tags", json={"name": "prod", "ref": "r1"})

    s = a.get("/api/admin/git").json()
    assert s["enabled"] and s["commits_unsynced"] == 3
    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None, s["last_error"]
    assert s["commits_unsynced"] == 0 and s["head_sha"]

    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)
    assert (clone / "usecases/AO/AO-CRE/AO-CRE-01.yaml").read_text() == "rule: two\n"
    assert (clone / "usecases/AO/AO-CRE/AO-CRE.yaml").read_text() == "owner: soc\n"
    log = git(clone, "log", "--format=%an|%s").splitlines()
    assert log[:3] == ["admin|AO-CRE: L2 conf", "admin|AO-CRE-01: Second", "admin|AO-CRE-01: First"]
    assert git(clone, "show", "AO-CRE-01/prod:usecases/AO/AO-CRE/AO-CRE-01.yaml") == "rule: one"
    hist = a.get("/api/l3/AO-CRE-01/config/history").json()
    assert hist  # history still served from the database

    # a second sync exports nothing twice; a removed tag disappears from the remote
    a.delete("/api/l3/AO-CRE-01/config/tags/prod")
    a.put(
        "/api/l3/AO-CRE-01/config",
        json={"content": "", "message": "Remove", "base_sha": hist[0]["sha"]},
    )
    assert a.post("/api/admin/git/sync").json()["last_error"] is None
    git(clone, "fetch", "-q", "--prune", "--prune-tags", "origin")
    git(clone, "reset", "-q", "--hard", "origin/main")
    assert len(git(clone, "log", "--format=%s").splitlines()) == 5  # README + 4
    assert not (clone / "usecases/AO/AO-CRE/AO-CRE-01.yaml").exists()
    assert git(clone, "tag", "--list") == ""


def test_sync_rebases_on_remote_changes(git_admin, remote, tmp_path):
    a = git_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "x: 1\n", "message": "One"})
    a.post("/api/admin/git/sync")
    clone = tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)
    (clone / "NOTES.md").write_text("hello\n")
    git(clone, "add", "NOTES.md")
    git(clone, "-c", "user.name=x", "-c", "user.email=x@y", "commit", "-q", "-m", "notes")
    git(clone, "push", "-q", "origin", "main")
    a.put("/api/l2/AO-CRE/config", json={"content": "y: 2\n", "message": "Two"})
    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None, s["last_error"]
    git(clone, "pull", "-q")
    assert git(clone, "log", "-1", "--format=%s") == "AO-CRE: Two"


def test_bad_remote_reports_error(settings, tmp_path):
    settings.git_remote_url = str(tmp_path / "missing.git")
    settings.git_workdir = tmp_path / "w"
    settings.git_auto_sync = False
    with TestClient(create_app(settings)) as c:
        login(c, "admin", ADMIN_PW)
        s = c.post("/api/admin/git/sync").json()
        assert s["last_error"] and s["commits_unsynced"] == 0


def test_redact():
    assert gitsync.redact("https://u:secret@host/r.git") == "https://***@host/r.git"
