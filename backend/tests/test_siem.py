"""API tokens and the SIEM push API (M7)."""

from fastapi.testclient import TestClient


def make_token(admin, name="Splunk prod", role="analyst", **kw) -> dict:
    r = admin.post("/api/integrations/tokens", json={"name": name, "role": role, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def bearer(app, token: str) -> TestClient:
    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {token}"
    return c


def test_tokens(app, admin, make_user):
    tok = make_token(admin)
    assert tok["token"].startswith("mgm_") and tok["username"] == "svc-splunk-prod"
    assert tok["prefix"] == tok["token"][:10]
    listed = admin.get("/api/integrations/tokens").json()
    assert [t["name"] for t in listed] == ["Splunk prod"] and "token" not in listed[0]

    svc = bearer(app, tok["token"])
    me = svc.get("/api/auth/me").json()
    assert me["username"] == "svc-splunk-prod" and me["auth_source"] == "service"
    assert me["role"] == "analyst"
    assert tok["scopes"] == ["siem"]
    # a SIEM token can push to the SIEM API but nothing else, although its account is an analyst
    assert svc.put("/api/integrations/siem/splunk/rules", json={"rules": []}).status_code == 200
    assert svc.get("/api/integrations/siem").status_code == 200
    r = svc.patch("/api/l3/AO-CRE-01", json={"comments": "via token"})
    assert r.status_code == 403 and "scope" in r.json()["detail"]
    assert svc.get("/api/scores").status_code == 403  # no read scope
    assert svc.post("/api/import/excel").status_code == 403
    rw = bearer(app, make_token(admin, "Both", scopes=["siem", "read"])["token"])
    assert rw.get("/api/scores").status_code == 200
    assert rw.patch("/api/l3/AO-CRE-01", json={"comments": "x"}).status_code == 403
    assert rw.get("/api/users").status_code == 403  # not an admin
    assert admin.get("/api/integrations/tokens").json()[0]["last_used_at"]

    # a service account cannot sign in with a password
    r = TestClient(app).post(
        "/api/auth/login", json={"username": "svc-splunk-prod", "password": "x" * 12}
    )
    assert r.status_code == 401

    # read-only token, wrong token, revoked token
    ro = bearer(app, make_token(admin, "Reader", role="auditor", scopes=["read"])["token"])
    assert ro.get("/api/scores").status_code == 200
    assert ro.patch("/api/l3/AO-CRE-01", json={"comments": "x"}).status_code == 403
    assert bearer(app, "mgm_wrong").get("/api/scores").status_code == 401
    assert admin.delete(f"/api/integrations/tokens/{tok['id']}").status_code == 204
    assert svc.get("/api/scores").status_code == 401
    assert make_user("analyst").get("/api/integrations/tokens").status_code == 403
    assert (
        admin.post("/api/integrations/tokens", json={"name": "x1", "role": "admin"}).status_code
        == 422
    )
    bad = {"name": "x2", "scopes": ["write"]}
    assert admin.post("/api/integrations/tokens", json=bad).status_code == 422
    # a token account cannot be made an admin on the Users page either
    svc_id = next(u["id"] for u in admin.get("/api/users").json() if u["username"] == "svc-both")
    assert admin.patch(f"/api/users/{svc_id}", json={"role": "admin"}).status_code == 409


def test_expired_token(app, admin):
    from datetime import UTC, datetime, timedelta

    from app.models import ApiToken

    tok = make_token(admin, "Old", expires_days=1)
    with app.state.sessionmaker() as db:
        t = db.get(ApiToken, tok["id"])
        t.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()
    assert bearer(app, tok["token"]).get("/api/scores").status_code == 401


INVENTORY = {
    "rules": [
        {"id": "Credential Dumping - LSASS", "name": "LSASS access", "techniques": ["T1003.001"]},
        {"id": "sentinel-0001", "name": "Brute force", "enabled": False, "techniques": ["T1110"]},
        {"id": "Unmapped thing", "name": "No use case yet", "techniques": ["T1003"]},
        {"id": "AO-CRE-02", "name": "Named after the L3 code"},
    ]
}


def test_inventory_and_reconciliation(admin):
    a = admin
    # link two L3 rules to SIEM rules; one id does not exist in the SIEM
    r = a.patch(
        "/api/l3/AO-CRE-01",
        json={"siem_rule_ids": ["Credential Dumping - LSASS", " gone-rule ", "gone-rule"]},
    )
    assert r.json()["siem_rule_ids"] == ["Credential Dumping - LSASS", "gone-rule"]
    a.patch("/api/l3/AO-ACC-01", json={"siem_rule_ids": ["sentinel-0001"]})
    r = a.post("/api/l3/AO-ACC-01/lifecycle", json={"to_status": "operational", "override": True})
    assert r.status_code == 201, r.text

    assert a.get("/api/integrations/siem").json()["missing_in_siem"] == []  # nothing reported yet
    r = a.put("/api/integrations/siem/splunk/rules", json=INVENTORY)
    assert r.status_code == 200, r.text
    s = r.json()
    assert (s["rules_total"], s["enabled"], s["linked"]) == (4, 3, 3)
    assert [u["rule_id"] for u in s["unlinked"]] == ["Unmapped thing"]
    assert "AO-CRE-01" in s["unlinked"][0]["suggestions"]  # same ATT&CK technique family
    assert s["disabled_but_operational"] == [
        {"rule_id": "sentinel-0001", "name": "Brute force", "code": "AO-ACC-01"}
    ]
    ov = a.get("/api/integrations/siem").json()
    assert [m["rule_id"] for m in ov["missing_in_siem"]] == ["gone-rule"]
    assert ov["linked_rules"] == 2

    # a new snapshot replaces the old one
    s = a.put("/api/integrations/siem/splunk/rules", json={"rules": INVENTORY["rules"][:1]}).json()
    assert s["rules_total"] == 1 and s["unlinked"] == []
    assert a.put("/api/integrations/siem/Bad Name/rules", json=INVENTORY).status_code == 422
    assert a.delete("/api/integrations/siem/splunk").status_code == 204
    assert a.get("/api/integrations/siem").json()["sources"] == []


def test_alert_counts(app, admin):
    a = admin
    a.patch("/api/l3/AO-CRE-01", json={"siem_rule_ids": ["lsass"]})
    svc = bearer(app, make_token(admin)["token"])
    body = {
        "items": [
            {"rule": "LSASS", "period": "2026-10", "alerts": 10, "false_positives": 4},
            {"rule": "lsass", "period": "2026-10-15", "alerts": 5, "incidents": 1},
            {"rule": "AO-CRE-02", "period": "2026-10", "alerts": 2},
            {"rule": "nobody-knows-me", "period": "2026-10", "alerts": 99},
        ]
    }
    r = svc.post("/api/integrations/siem/splunk/alerts?dry_run=true", json=body)
    assert r.status_code == 200 and r.json()["created"] == 2 and r.json()["dry_run"]
    assert all(m["period"] != "2026-10" for m in a.get("/api/l3/AO-CRE-01/output-metrics").json())

    r = svc.post("/api/integrations/siem/splunk/alerts", json=body).json()
    assert (r["created"], r["updated"]) == (2, 0)
    assert set(r["matched"]) == {"AO-CRE-02", "LSASS"}
    assert r["unmatched"] == ["nobody-knows-me"]
    oct_ = next(
        m for m in a.get("/api/l3/AO-CRE-01/output-metrics").json() if m["period"] == "2026-10"
    )
    assert (oct_["alerts"], oct_["incidents"], oct_["false_positives"]) == (15, 1, 4)
    assert oct_["source"] == "siem" and oct_["updated_by"] == "svc-splunk-prod"

    # add mode for daily pushes
    add = {"mode": "add", "items": [{"rule": "lsass", "period": "2026-10", "alerts": 3}]}
    assert svc.post("/api/integrations/siem/splunk/alerts", json=add).json()["updated"] == 1
    oct_ = next(
        m for m in a.get("/api/l3/AO-CRE-01/output-metrics").json() if m["period"] == "2026-10"
    )
    assert oct_["alerts"] == 18

    # a retried add push with the same batch id is not counted twice
    batch = add | {"batch_id": "2026-10-31"}
    assert svc.post("/api/integrations/siem/splunk/alerts", json=batch).json()["updated"] == 1
    again = svc.post("/api/integrations/siem/splunk/alerts", json=batch).json()
    assert again["duplicate"] and again["updated"] == 0
    oct_ = next(
        m for m in a.get("/api/l3/AO-CRE-01/output-metrics").json() if m["period"] == "2026-10"
    )
    assert oct_["alerts"] == 21
    # months in the future are refused, as in manual and CSV entry
    future = {"items": [{"rule": "lsass", "period": "2099-01", "alerts": 1}]}
    assert svc.post("/api/integrations/siem/splunk/alerts", json=future).status_code == 422

    # replace again; an impossible row rejects the whole push
    bad = {"items": [{"rule": "lsass", "period": "2026-11", "alerts": 1, "false_positives": 2}]}
    r = svc.post("/api/integrations/siem/splunk/alerts", json=bad)
    assert r.status_code == 422 and r.json()["errors"]
    assert (
        svc.post(
            "/api/integrations/siem/splunk/alerts",
            json={"items": [{"rule": "x", "period": "26-1"}]},
        ).status_code
        == 422
    )

    src = a.get("/api/integrations/siem").json()["sources"][0]
    assert src["name"] == "splunk" and src["alerts_report"]["unmatched"] == []
    assert src["alerts_by"] == "svc-splunk-prod"


def test_auditor_cannot_push(make_user):
    au = make_user("auditor")
    assert au.get("/api/integrations/siem").status_code == 200
    r = au.post("/api/integrations/siem/splunk/alerts", json={"items": []})
    assert r.status_code == 403
