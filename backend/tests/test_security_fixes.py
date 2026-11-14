"""Fixes from the logic and security review (2026-11-14)."""

import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.config import Settings, WeakSecretKey, check_secret_key
from app.main import create_app
from tests.conftest import ADMIN_PW, login
from tests.test_excel import upload

DOD = ["log_sources", "scope", "incident_response", "roles", "rules"]


def _workbook(admin, code: str, **cells) -> bytes:
    """The current export with some L3 cells of one rule changed (header -> value)."""
    wb = load_workbook(io.BytesIO(admin.get("/api/export/excel").content))
    ws = wb["L3 UC"]
    hdr = {str(c.value).strip().lower(): c.column for c in ws[1] if c.value}
    row = next(r for r in range(2, ws.max_row + 1) if ws.cell(r, 6).value == code)
    for name, value in cells.items():
        col = next(v for k, v in hdr.items() if k.startswith(name))
        ws.cell(row, col, value)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- Excel import and export


def test_import_keeps_the_definition_of_done(admin, make_user):
    analyst = make_user("analyst")
    admin.post("/api/l3/AO-CRE-01/lifecycle", json={"to_status": "onboarding"})
    admin.put("/api/l3/AO-CRE-01/dod", json={"items": {k: False for k in DOD}})
    data = _workbook(admin, "AO-CRE-01", **{"lifecycle status": "operational"})

    r = upload(analyst, data, dry_run=False).json()
    assert any("definition of done" in e["message"] for e in r["errors"])
    assert admin.get("/api/l3/AO-CRE-01").json()["lifecycle_status"] == "onboarding"

    # an admin may skip it; the change is logged as an override, like in the app
    upload(admin, data, dry_run=False)
    assert admin.get("/api/l3/AO-CRE-01").json()["lifecycle_status"] == "operational"
    ev = admin.get("/api/l3/AO-CRE-01/lifecycle").json()["events"][0]
    assert (ev["from_status"], ev["to_status"], ev["dod_override"]) == (
        "onboarding",
        "operational",
        True,
    )
    assert ev["username"] == "admin" and ev["note"] == "Excel import"


def test_import_logs_status_changes_and_records_the_verifier(admin, make_user):
    analyst = make_user("analyst")
    admin.post("/api/l3/AO-CRE-01/lifecycle", json={"to_status": "operational", "override": True})
    data = _workbook(
        admin,
        "AO-CRE-01",
        **{
            "lifecycle status": "maintenance",
            "last verified by": "somebody else",
            "last verified": "2026-01-15",
        },
    )
    assert upload(analyst, data, dry_run=False).json()["errors"] == []
    rule = admin.get("/api/l3/AO-CRE-01").json()
    assert rule["lifecycle_status"] == "maintenance"
    assert rule["last_verified_at"] == "2026-01-15" and rule["last_verified_by"] == "analyst1"
    ev = admin.get("/api/l3/AO-CRE-01/lifecycle").json()["events"][0]
    assert (ev["to_status"], ev["username"]) == ("maintenance", "analyst1")

    future = _workbook(admin, "AO-CRE-01", **{"last verified": "2099-01-01"})
    r = upload(analyst, future).json()
    assert any("future" in e["message"] for e in r["errors"])


def test_export_writes_user_formulas_as_text(admin):
    evil = '=HYPERLINK("http://evil.example","click")'
    admin.patch("/api/l3/AO-CRE-01", json={"name": evil, "comments": "=1+1"})
    wb = load_workbook(io.BytesIO(admin.get("/api/export/excel").content))
    ws = wb["L3 UC"]
    row = next(r for r in range(2, ws.max_row + 1) if ws.cell(r, 6).value == "AO-CRE-01")
    assert ws.cell(row, 7).data_type == "s" and ws.cell(row, 7).value == evil
    assert ws.cell(row, 17).data_type == "s"
    # the export's own formulas stay formulas
    assert ws.cell(row, 12).data_type == "f" and ws.cell(row, 1).data_type == "f"
    assert wb["L2 UC"]["H2"].data_type == "f"


def test_import_refuses_zip_bombs(admin, monkeypatch):
    from app import excel

    monkeypatch.setattr(excel, "MAX_UNPACKED_BYTES", 1000)
    r = upload(admin, admin.get("/api/export/excel").content)
    assert r.status_code == 422 and "unpacks to" in r.json()["detail"]
    assert upload(admin, b"not a zip").status_code == 422


def test_output_csv_rejects_infinite_numbers(admin):
    csv = b"rule,period,alerts\nAO-CRE-01,2026-01,inf\n"
    r = admin.post(
        "/api/import/output-metrics",
        files={"file": ("m.csv", csv, "text/csv")},
        data={"dry_run": "true"},
    )
    assert r.status_code == 200 and "not a number" in r.json()["errors"][0]


# ---------------------------------------------------------------- API input


def test_patch_rejects_empty_required_fields_and_future_dates(admin):
    r = admin.patch("/api/l3/AO-CRE-01", json={"name": None})
    assert r.status_code == 422 and "cannot be empty: name" in r.text
    assert admin.patch("/api/l3/AO-CRE-01", json={"lifecycle_status": None}).status_code == 422
    assert admin.patch("/api/l2/AO-CRE", json={"description": None}).status_code == 422
    assert admin.patch("/api/l3/AO-CRE-01", json={"effectiveness": None}).status_code == 200
    r = admin.patch("/api/l3/AO-CRE-01", json={"last_verified_at": "2099-01-01"})
    assert r.status_code == 422 and "future" in r.text
    assert admin.patch("/api/users/1", json={"role": None}).status_code == 422


# ---------------------------------------------------------------- SECRET_KEY


@pytest.mark.parametrize("key", ["", "change-me", "short-key"])
def test_weak_secret_key_is_refused(key):
    with pytest.raises(WeakSecretKey):
        check_secret_key(Settings(secret_key=key))
    check_secret_key(Settings(secret_key=key, allow_weak_secret_key=True))  # warns only


def test_app_does_not_start_with_weak_key(settings):
    settings.secret_key = "change-me"
    with pytest.raises(WeakSecretKey), TestClient(create_app(settings)):
        pass


def test_rotate_secret_reencrypts_totp_seeds(app, admin):
    from app import totp
    from app.models import User

    old, new = "o" * 40, "n" * 40
    with app.state.sessionmaker() as db:
        u = db.query(User).filter_by(username="admin").one()
        u.totp_secret = totp.encrypt("JBSWY3DPEHPK3PXP", old)
        db.commit()
        assert totp.reencrypt_all(db, old, new) == (1, [])
        assert totp.decrypt(u.totp_secret, new) == "JBSWY3DPEHPK3PXP"
        assert totp.reencrypt_all(db, "wrong", new) == (0, [])  # already done: idempotent


# ---------------------------------------------------------------- sessions and lockout


def test_password_change_signs_out_other_sessions(app, admin):
    other = login(TestClient(app), "admin", ADMIN_PW)
    assert other.get("/api/auth/me").status_code == 200
    r = admin.post(
        "/api/auth/me/password",
        json={"current_password": ADMIN_PW, "new_password": "a-new-password-456"},
    )
    assert r.status_code == 204
    assert admin.get("/api/auth/me").status_code == 200  # this browser stays signed in
    assert other.get("/api/auth/me").status_code == 401


def test_admin_password_reset_signs_the_user_out(admin, make_user):
    analyst = make_user("analyst")
    uid = analyst.get("/api/auth/me").json()["id"]
    assert admin.patch(f"/api/users/{uid}", json={"password": "reset-password-789"}).status_code
    assert analyst.get("/api/auth/me").status_code == 401


def test_password_checks_on_account_page_count_toward_lockout(admin, make_user):
    analyst = make_user("analyst")
    for _ in range(5):
        r = analyst.post(
            "/api/auth/me/password", json={"current_password": "x" * 12, "new_password": "y" * 12}
        )
        assert r.status_code == 400
    r = analyst.post("/api/auth/me/totp/setup", json={"password": "analyst-password-123"})
    assert r.status_code == 429  # locked, even with the right password


def test_failed_logins_per_address_are_limited(settings):
    settings.login_ip_max_failures = 3
    with TestClient(create_app(settings)) as c:
        for name in ("nobody1", "nobody2", "nobody3"):
            r = c.post("/api/auth/login", json={"username": name, "password": "x" * 12})
            assert r.status_code == 401
        r = c.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
        assert r.status_code == 429


# ---------------------------------------------------------------- headers, docs, audit


def test_security_headers_and_docs_need_login(anon, admin):
    r = anon.get("/api/health")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "strict-transport-security" not in r.headers  # http BASE_URL
    assert anon.get("/api/openapi.json").status_code == 401
    assert anon.get("/api/docs").status_code == 401
    assert admin.get("/api/openapi.json").json()["info"]["title"]
    assert "swagger" in admin.get("/api/docs").text.lower()


def test_audit_log_records_the_client_address(admin):
    admin.patch("/api/l3/AO-CRE-01", json={"comments": "x"})
    entry = admin.get("/api/audit?entity=l3").json()[0]
    assert entry["ip"] == "testclient"
