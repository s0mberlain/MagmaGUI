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


# ---------------------------------------------------------------- two-way sync (M7)


@pytest.fixture
def pull_admin(settings, remote, tmp_path):
    settings.git_remote_url = str(remote)
    settings.git_workdir = tmp_path / "work"
    settings.git_auto_sync = False
    settings.git_pull = True
    settings.git_pull_interval_minutes = 0
    settings.git_webhook_secret = "hook-secret"
    with TestClient(create_app(settings)) as c:
        yield login(c, "admin", ADMIN_PW)


def human_push(clone, files: dict[str, str | None], message: str, name="Grace Hopper") -> str:
    git(clone, "pull", "-q", "--rebase")
    for rel, text in files.items():
        p = clone / rel
        if text is None:
            git(clone, "rm", "-q", rel)
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        git(clone, "add", rel)
    git(clone, "-c", f"user.name={name}", "-c", "user.email=g@x", "commit", "-q", "-m", message)
    git(clone, "push", "-q", "origin", "main")
    return git(clone, "rev-parse", "HEAD")


RULE = "usecases/AO/AO-CRE/AO-CRE-01.yaml"


def test_two_way_imports_changes_made_in_git(pull_admin, remote, tmp_path):
    a = pull_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "threshold: 5\n", "message": "First"})
    assert a.post("/api/admin/git/sync").json()["last_error"] is None
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)

    sha = human_push(clone, {RULE: "threshold: 3\n# tuned\n"}, "Lower threshold")
    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None, s["last_error"]
    assert s["commits_from_git"] == 1 and s["last_imported_sha"] == sha and s["import_notes"] == []

    head = a.get("/api/l3/AO-CRE-01/config").json()
    assert head["content"] == "threshold: 3\n# tuned\n"
    h = head["head"]
    assert (h["rev"], h["author"], h["message"]) == (2, "git:Grace Hopper", "Lower threshold")
    assert (h["source"], h["git_sha"]) == ("git", sha)
    audit = a.get("/api/audit").json()
    assert any(e["action"] == "config_import" and e["entity_key"] == "AO-CRE-01" for e in audit)

    # nothing is exported back and a second sync changes nothing
    n = len(git(clone, "log", "--format=%H").splitlines())
    s = a.post("/api/admin/git/sync").json()
    assert s["commits_unsynced"] == 0 and s["commits_from_git"] == 1
    git(clone, "pull", "-q")
    assert len(git(clone, "log", "--format=%H").splitlines()) == n

    # the app builds on the imported version as usual
    r = a.put(
        "/api/l3/AO-CRE-01/config",
        json={"content": "threshold: 4\n", "message": "Back up", "base_sha": h["sha"]},
    )
    assert r.status_code == 201
    a.post("/api/admin/git/sync")
    git(clone, "pull", "-q")
    assert (clone / RULE).read_text() == "threshold: 4\n"
    assert a.get("/api/admin/git").json()["commits_from_git"] == 1


def test_two_way_notes_conflicts_invalid_and_unknown(pull_admin, remote, tmp_path):
    a = pull_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "a: 1\n", "message": "One"})
    a.put("/api/l2/AO-CRE/config", json={"content": "owner: soc\n", "message": "L2"})
    a.post("/api/admin/git/sync")
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)

    # changed in git and (not yet synced) in the app: the app wins
    human_push(clone, {RULE: "a: 2\n"}, "git edit")
    head = a.get("/api/l3/AO-CRE-01/config").json()["head"]
    a.put(
        "/api/l3/AO-CRE-01/config",
        json={"content": "a: 3\n", "message": "app edit", "base_sha": head["sha"]},
    )
    # invalid YAML, an unknown use case, and a deleted L2 config
    human_push(
        clone,
        {
            "usecases/AO/AO-CRE/AO-CRE-02.yaml": "key: [unclosed\n",
            "usecases/XX/XX-YYY/XX-YYY-01.yaml": "x: 1\n",
            "usecases/AO/AO-CRE/AO-CRE.yaml": None,
            "notes/readme.txt": "ignored\n",
        },
        "misc",
    )
    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None, s["last_error"]
    notes = "\n".join(s["import_notes"])
    assert "AO-CRE-01: changed in the app and in git" in notes
    assert "AO-CRE-02: git commit" in notes and "not valid YAML (line" in notes
    assert "usecases/XX/XX-YYY/XX-YYY-01.yaml: no such use case" in notes

    assert a.get("/api/l3/AO-CRE-01/config").json()["content"] == "a: 3\n"
    assert a.get("/api/l3/AO-CRE-02/config").json()["head"] is None
    l2 = a.get("/api/l2/AO-CRE/config").json()
    assert l2["content"] == "" and l2["head"]["source"] == "git"
    git(clone, "pull", "-q")
    assert (clone / RULE).read_text() == "a: 3\n"  # app version pushed on top


def test_one_way_ignores_changes_in_git(git_admin, remote, tmp_path):
    a = git_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "a: 1\n", "message": "One"})
    a.post("/api/admin/git/sync")
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)
    human_push(clone, {RULE: "a: 2\n"}, "git edit")
    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None and not s["pull"] and s["commits_from_git"] == 0
    assert a.get("/api/l3/AO-CRE-01/config").json()["content"] == "a: 1\n"


def test_webhook(pull_admin, monkeypatch):
    import hashlib
    import hmac

    calls = []
    monkeypatch.setattr(gitsync, "request", lambda *args: calls.append(args))
    a = pull_admin
    body = b'{"ref": "refs/heads/main"}'
    assert a.post("/api/git/webhook", content=body).status_code == 401
    bad = {"X-Hub-Signature-256": "sha256=" + "0" * 64}
    assert a.post("/api/git/webhook", content=body, headers=bad).status_code == 401
    sig = hmac.new(b"hook-secret", body, hashlib.sha256).hexdigest()
    ok = {"X-Hub-Signature-256": f"sha256={sig}"}
    assert a.post("/api/git/webhook", content=body, headers=ok).status_code == 202
    assert (
        a.post("/api/git/webhook", headers={"X-Gitea-Signature": sig}, content=body).status_code
        == 202
    )
    assert a.post("/api/git/webhook", headers={"X-Gitlab-Token": "hook-secret"}).status_code == 202
    assert len(calls) == 3


def test_webhook_off_by_default(anon):
    assert anon.post("/api/git/webhook", headers={"X-Magma-Token": "x"}).status_code == 404


def test_forged_trailer_and_people_tags(pull_admin, remote, tmp_path):
    """Anyone with push access can write a Magma-Commit trailer or a <code>/<tag> tag: a forged
    trailer must not stop an app commit from being exported, and people's tags are kept."""
    a = pull_admin
    a.put("/api/l3/AO-CRE-01/config", json={"content": "threshold: 5\n", "message": "First"})
    assert a.post("/api/admin/git/sync").json()["last_error"] is None
    first = a.get("/api/l3/AO-CRE-01/config").json()["head"]
    second = a.put(
        "/api/l3/AO-CRE-01/config",
        json={"content": "threshold: 7\n", "message": "Second", "base_sha": first["sha"]},
    ).json()
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(remote), str(clone)], check=True)
    # a commit that claims to be the (not yet exported) app commit, with other content
    human_push(
        clone,
        {"notes.txt": "x\n"},
        f"Sneaky\n\nMagma-Commit: {second['sha']}",
        name="Mallory",
    )
    git(clone, "tag", "AO-CRE-01/mine")
    git(clone, "push", "-q", "origin", "AO-CRE-01/mine")

    s = a.post("/api/admin/git/sync").json()
    assert s["last_error"] is None, s["last_error"]
    assert s["commits_unsynced"] == 0
    git(clone, "pull", "-q")
    assert (clone / RULE).read_text() == "threshold: 7\n"
    assert "AO-CRE-01/mine" in git(remote, "tag", "--list").splitlines()
