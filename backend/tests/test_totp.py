import time

from fastapi.testclient import TestClient

from app import totp
from tests.conftest import ADMIN_PW


def test_rfc6238_vector():
    # RFC 6238 appendix B, SHA-1 secret "12345678901234567890", T = 59 s -> 94287082 (8 digits)
    import base64

    secret = base64.b32encode(b"12345678901234567890").decode()
    assert totp.code_at(secret, 59 // 30) == "287082"
    assert totp.verify(secret, "287 082", None, now=59) == 1
    assert totp.verify(secret, "287082", 1, now=59) is None  # replay refused


def _current(secret: str) -> str:
    return totp.code_at(secret, int(time.time() // 30))


def test_enable_login_recovery_and_reset(app, admin, make_user):
    analyst = make_user("analyst")
    assert analyst.post("/api/auth/me/totp/setup", json={"password": "nope"}).status_code == 400
    s = analyst.post("/api/auth/me/totp/setup", json={"password": "analyst-password-123"}).json()
    assert s["uri"].startswith("otpauth://totp/") and "<svg" in s["qr_svg"]
    assert analyst.post("/api/auth/me/totp/enable", json={"code": "000000"}).status_code == 400
    first = _current(s["secret"])
    r = analyst.post("/api/auth/me/totp/enable", json={"code": first})
    assert r.status_code == 200
    codes = r.json()["recovery_codes"]
    assert len(codes) == 8
    assert analyst.get("/api/auth/me").json()["totp_enabled"]

    with TestClient(app) as c:
        creds = {"username": "analyst1", "password": "analyst-password-123"}
        r = c.post("/api/auth/login", json=creds)
        assert r.status_code == 401 and r.json()["detail"] == "totp_required"
        assert c.get("/api/auth/me").status_code == 401
        assert c.post("/api/auth/login", json=creds | {"otp": "123456"}).status_code == 401
        # the code used for enabling cannot be replayed
        assert (
            c.post("/api/auth/login", json=creds | {"otp": _current(s["secret"])}).status_code
            == 401
        )
        r = c.post("/api/auth/login", json=creds | {"otp": codes[0].upper()})
        assert r.status_code == 200
        assert c.post("/api/auth/logout").status_code == 204
        assert c.post("/api/auth/login", json=creds | {"otp": codes[0]}).status_code == 401  # used

    # admin resets it (lost phone)
    uid = analyst.get("/api/auth/me").json()["id"]
    assert analyst.delete(f"/api/users/{uid}/totp").status_code == 403
    assert not admin.delete(f"/api/users/{uid}/totp").json()["totp_enabled"]
    with TestClient(app) as c:
        r = c.post(
            "/api/auth/login", json={"username": "analyst1", "password": "analyst-password-123"}
        )
        assert r.status_code == 200


def test_disable_needs_password_and_code(admin):
    s = admin.post("/api/auth/me/totp/setup", json={"password": ADMIN_PW}).json()
    codes = admin.post("/api/auth/me/totp/enable", json={"code": _current(s["secret"])}).json()
    body = {"password": ADMIN_PW, "code": "000000"}
    assert admin.post("/api/auth/me/totp/disable", json=body).status_code == 400
    new = admin.post(
        "/api/auth/me/totp/recovery-codes",
        json={"password": ADMIN_PW, "code": codes["recovery_codes"][0]},
    )
    assert new.status_code == 200 and new.json()["recovery_codes"] != codes["recovery_codes"]
    body["code"] = new.json()["recovery_codes"][1]
    assert admin.post("/api/auth/me/totp/disable", json=body).status_code == 204
    assert not admin.get("/api/auth/me").json()["totp_enabled"]


def test_secret_is_encrypted_at_rest(app, admin):
    s = admin.post("/api/auth/me/totp/setup", json={"password": ADMIN_PW}).json()
    from sqlalchemy import select

    from app.models import User

    with app.state.sessionmaker() as db:
        stored = db.scalar(select(User.totp_secret).where(User.username == "admin"))
    assert s["secret"] not in stored
