from tests.conftest import ADMIN_PW


def test_requires_login(anon):
    assert anon.get("/api/l1").status_code == 401
    assert anon.get("/api/auth/me").status_code == 401
    assert anon.get("/api/health").status_code == 200


def test_login_me_logout(anon):
    r = anon.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert anon.get("/api/auth/me").json()["role"] == "admin"
    assert anon.post("/api/auth/logout").status_code == 204
    assert anon.get("/api/auth/me").status_code == 401


def test_wrong_password_and_unknown_user(anon):
    for user in ("admin", "nobody"):
        r = anon.post("/api/auth/login", json={"username": user, "password": "wrong-password"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Invalid username or password"


def test_lockout_after_failed_logins(anon):
    for _ in range(5):
        anon.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})
    r = anon.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert r.status_code == 429


def test_password_policy_and_change(admin):
    r = admin.post("/api/users", json={"username": "x", "role": "analyst", "password": "short"})
    assert r.status_code == 422
    r = admin.post(
        "/api/auth/me/password",
        json={"current_password": ADMIN_PW, "new_password": "a-new-long-password"},
    )
    assert r.status_code == 204
    admin.post("/api/auth/logout")
    r = admin.post("/api/auth/login", json={"username": "admin", "password": "a-new-long-password"})
    assert r.status_code == 200


def test_roles(make_user):
    analyst = make_user("analyst")
    auditor = make_user("auditor")

    # everyone reads
    for c in (analyst, auditor):
        assert c.get("/api/l1").status_code == 200
        assert c.get("/api/l3/AO-CRE-01").status_code == 200

    # analyst edits, auditor does not
    body = {"comments": "tuned"}
    assert analyst.patch("/api/l3/AO-CRE-01", json=body).status_code == 200
    assert auditor.patch("/api/l3/AO-CRE-01", json=body).status_code == 403
    assert auditor.post("/api/references/log_source", json={"name": "EDR"}).status_code == 403

    # deletes and user admin are admin-only
    assert analyst.delete("/api/l3/AO-CRE-01").status_code == 403
    assert analyst.get("/api/users").status_code == 403
    assert auditor.get("/api/users").status_code == 403

    # audit log: admin and auditor
    assert auditor.get("/api/audit").status_code == 200
    assert analyst.get("/api/audit").status_code == 403


def test_disabling_user_ends_sessions(admin, make_user):
    analyst = make_user("analyst", "jana")
    uid = analyst.get("/api/auth/me").json()["id"]
    assert admin.patch(f"/api/users/{uid}", json={"active": False}).status_code == 200
    assert analyst.get("/api/l1").status_code == 401


def test_last_admin_is_protected(admin):
    me = admin.get("/api/auth/me").json()
    r = admin.patch(f"/api/users/{me['id']}", json={"role": "analyst"})
    assert r.status_code == 409
    assert admin.delete(f"/api/users/{me['id']}").status_code == 409


def test_user_locale(admin, make_user):
    assert admin.get("/api/auth/me").json()["locale"] is None
    r = admin.put("/api/auth/me/locale", json={"locale": "de"})
    assert r.status_code == 200 and r.json()["locale"] == "de"
    assert admin.get("/api/auth/me").json()["locale"] == "de"
    assert admin.put("/api/auth/me/locale", json={"locale": "fr"}).status_code == 422
    auditor = make_user("auditor")
    assert auditor.put("/api/auth/me/locale", json={"locale": "nl"}).json()["locale"] == "nl"
    assert admin.put("/api/auth/me/locale", json={"locale": None}).json()["locale"] is None


def test_cli_reset_password(app, settings, admin, monkeypatch, capsys):
    """ADMIN_PASSWORD only seeds the first admin; `magma reset-password` is the way back in."""
    from fastapi.testclient import TestClient

    from app import cli, config
    from tests.conftest import ADMIN_PW, login

    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    other = login(TestClient(app), "admin", ADMIN_PW)
    for _ in range(5):  # lock the account
        TestClient(app).post("/api/auth/login", json={"username": "admin", "password": "x" * 12})

    settings.admin_password = "short"
    assert cli.main(["reset-password", "--from-env"]) == 1
    assert "at least 12" in capsys.readouterr().err

    settings.admin_password = "the-new-admin-password"
    assert cli.main(["reset-password", "--from-env"]) == 0
    assert "unlocked" in capsys.readouterr().out
    assert other.get("/api/auth/me").status_code == 401  # signed out everywhere
    login(TestClient(app), "admin", "the-new-admin-password")

    pw = iter(["typed-password-123", "typed-password-123"])
    monkeypatch.setattr("getpass.getpass", lambda _: next(pw))
    assert cli.main(["reset-password", "admin", "--disable-totp"]) == 0
    fresh = login(TestClient(app), "admin", "typed-password-123")
    assert cli.main(["reset-password", "nobody", "--from-env"]) == 1
    assert "Local users: admin" in capsys.readouterr().err
    entries = fresh.get("/api/audit?entity=user").json()
    assert any(e["action"] == "password_reset_cli" for e in entries)
