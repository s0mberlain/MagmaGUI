"""Fixes from the second logic, security and UX review."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from tests.conftest import ADMIN_PW

RULE = "AO-CRE-01"


def test_check_with_issues_does_not_count_as_verified(admin):
    admin.patch(f"/api/l3/{RULE}", json={"lifecycle_status": "operational"})
    admin.put(f"/api/l3/{RULE}/config", json={"content": "a: 1\n", "message": "first"})
    r = admin.post(f"/api/l3/{RULE}/verify", json={"result": "issues", "note": "does not fire"})
    assert r.status_code == 201 and r.json()["config_tag"] is None
    rule = admin.get(f"/api/l3/{RULE}").json()
    assert rule["last_verified_at"] is None and rule["verification_overdue"]
    assert rule["issues_at"] == date.today().isoformat()
    due = admin.get("/api/verification/due").json()
    assert due[0]["code"] == RULE and due[0]["issues_at"] == date.today().isoformat()

    r = admin.post(f"/api/l3/{RULE}/verify", json={"result": "ok"})
    assert r.json()["config_tag"].startswith("verified-")
    rule = admin.get(f"/api/l3/{RULE}").json()
    assert rule["last_verified_at"] == date.today().isoformat() and rule["issues_at"] is None

    # a later failed check keeps the last good date and shows up as an open issue again
    admin.post(f"/api/l3/{RULE}/verify", json={"result": "issues"})
    rule = admin.get(f"/api/l3/{RULE}").json()
    assert rule["last_verified_at"] == date.today().isoformat() and rule["issues_at"]
    assert RULE in [d["code"] for d in admin.get("/api/verification/due").json()]


def test_stale_edit_is_refused(admin, make_user):
    analyst = make_user("analyst")
    opened = admin.get(f"/api/l3/{RULE}").json()["updated_at"]
    r = analyst.patch(
        f"/api/l3/{RULE}", json={"comments": "analyst", "expected_updated_at": opened}
    )
    assert r.status_code == 200
    r = admin.patch(f"/api/l3/{RULE}", json={"comments": "admin", "expected_updated_at": opened})
    assert r.status_code == 409 and "changed by someone else" in r.json()["detail"]
    assert admin.get(f"/api/l3/{RULE}").json()["comments"] == "analyst"
    # a change of links only (no column of the rule) is noticed as well
    opened = admin.get(f"/api/l3/{RULE}").json()["updated_at"]
    name = admin.get("/api/references/log_source").json()[0]["name"]
    assert analyst.patch(f"/api/l3/{RULE}", json={"log_sources": [name]}).status_code == 200
    r = admin.patch(f"/api/l3/{RULE}", json={"comments": "x", "expected_updated_at": opened})
    assert r.status_code == 409
    # without the field nothing is checked (API clients, scripts)
    assert admin.patch(f"/api/l3/{RULE}", json={"comments": "x"}).status_code == 200

    l2 = admin.get("/api/l2/AO-CRE").json()
    assert (
        admin.patch(
            "/api/l2/AO-CRE", json={"description": "a", "expected_updated_at": l2["updated_at"]}
        ).status_code
        == 200
    )
    r = admin.patch(
        "/api/l2/AO-CRE", json={"description": "b", "expected_updated_at": l2["updated_at"]}
    )
    assert r.status_code == 409


def test_demo_data_needs_the_setting(app, settings, admin):
    assert admin.get("/api/admin/demo-data").json() == {"allowed": True}
    settings.allow_demo_data = False
    assert admin.get("/api/admin/demo-data").json() == {"allowed": False}
    admin.put(f"/api/l3/{RULE}/config", json={"content": "a: 1\n", "message": "keep me"})
    r = admin.post("/api/admin/demo-data", json={})
    assert r.status_code == 409 and "ALLOW_DEMO_DATA" in r.json()["detail"]
    assert admin.get(f"/api/l3/{RULE}/config").json()["commits"] == 1


def test_siem_rules_of_one_use_case_rule_add_up(admin):
    admin.patch(f"/api/l3/{RULE}", json={"siem_rule_ids": ["rule-A", "rule-B"]})
    period = date.today().replace(day=1).strftime("%Y-%m")
    items = [
        {"rule": "rule-A", "period": period, "alerts": 10, "false_positives": 2},
        {"rule": "rule-B", "period": period, "alerts": 5, "false_negatives": 1},
    ]
    r = admin.post("/api/integrations/siem/splunk/alerts", json={"mode": "replace", "items": items})
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    m = admin.get(f"/api/l3/{RULE}/output-metrics").json()[0]
    assert (m["alerts"], m["false_positives"], m["false_negatives"]) == (15, 2, 1)
    # replace again gives the same totals, add doubles them
    admin.post("/api/integrations/siem/splunk/alerts", json={"mode": "replace", "items": items})
    assert admin.get(f"/api/l3/{RULE}/output-metrics").json()[0]["alerts"] == 15
    admin.post("/api/integrations/siem/splunk/alerts", json={"mode": "add", "items": items})
    assert admin.get(f"/api/l3/{RULE}/output-metrics").json()[0]["alerts"] == 30


def test_csv_export_neutralises_formulas(admin):
    period = date.today().replace(day=1).strftime("%Y-%m")
    note = '=HYPERLINK("http://evil.example","x")'
    admin.put(f"/api/l3/{RULE}/output-metrics/{period}", json={"alerts": 1, "note": note})
    csv = admin.get("/api/export/output-metrics.csv").text
    assert "\"'=HYPERLINK" in csv and ",=HYPERLINK" not in csv and ',"=HYPERLINK' not in csv
    # and the exported file imports back to the same note
    r = admin.post(
        "/api/import/output-metrics",
        files={"file": ("m.csv", csv.encode(), "text/csv")},
        data={"dry_run": "false"},
    )
    assert r.status_code == 200 and not r.json()["errors"], r.text
    assert admin.get(f"/api/l3/{RULE}/output-metrics").json()[0]["note"] == note


def test_json_export_has_the_history(admin):
    admin.patch(f"/api/l3/{RULE}", json={"risk_level": 4, "siem_rule_ids": ["r1"]})
    admin.put(f"/api/l3/{RULE}/dod", json={"items": {"rules": True}})
    admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "offloading"})
    period = date.today().replace(day=1).strftime("%Y-%m")
    admin.put(f"/api/l3/{RULE}/output-metrics/{period}", json={"alerts": 3})
    data = admin.get("/api/export/json").json()
    assert data["format"] == "magma-ucf-export"
    rule = next(x for x in data["l3"] if x["code"] == RULE)
    assert rule["risk_level"] == 4 and rule["siem_rule_ids"] == ["r1"] and "rules" in rule["dod"]
    assert [e["to_status"] for e in data["lifecycle_events"] if e["use_case"] == RULE] == [
        "offloading"
    ]
    assert data["output_metrics"][0]["rule"] == RULE and data["output_metrics"][0]["alerts"] == 3


def test_text_and_body_limits(admin):
    r = admin.patch(f"/api/l3/{RULE}", json={"comments": "x" * 20_001})
    assert r.status_code == 422
    assert admin.patch(f"/api/l3/{RULE}", json={"comments": "x" * 20_000}).status_code == 200
    me = admin.get("/api/auth/me").json()
    r = admin.patch(f"/api/users/{me['id']}", json={"display_name": "n" * 129})
    assert r.status_code == 422
    r = admin.post("/api/config/validate", json={"content": "x" * (26 * 1024 * 1024)})
    assert r.status_code == 413
    # a body without Content-Length is counted while it arrives
    r = admin.post(
        "/api/config/validate",
        content=(b"x" * 1024 * 1024 for _ in range(27)),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413


def test_untrusted_proxy_is_reported_once(admin, caplog):
    with caplog.at_level("WARNING", logger="magma.proxy"):
        admin.get("/api/health", headers={"X-Forwarded-For": "203.0.113.7"})
        admin.get("/api/health", headers={"X-Forwarded-For": "203.0.113.7"})
    assert [r.message for r in caplog.records].count(caplog.records[0].message) == 1
    assert "FORWARDED_ALLOW_IPS" in caplog.records[0].message


def test_cli_reset_keeps_a_disabled_account_disabled(app, settings, admin, monkeypatch, capsys):
    from app import cli, config

    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    r = admin.post(
        "/api/users", json={"username": "bob", "role": "analyst", "password": "bob-password-123"}
    )
    admin.patch(f"/api/users/{r.json()['id']}", json={"active": False})
    settings.admin_password = "new-password-for-bob"
    assert cli.main(["reset-password", "bob", "--from-env"]) == 0
    assert "still disabled" in capsys.readouterr().out
    body = {"username": "bob", "password": "new-password-for-bob"}
    assert TestClient(app).post("/api/auth/login", json=body).status_code == 401
    assert cli.main(["reset-password", "bob", "--from-env", "--enable"]) == 0
    assert "still disabled" not in capsys.readouterr().out
    assert TestClient(app).post("/api/auth/login", json=body).status_code == 200


def test_locked_account_looks_like_a_wrong_password(app, admin):
    wrong = {"username": "admin", "password": "wrong-password-1"}
    for _ in range(5):
        assert TestClient(app).post("/api/auth/login", json=wrong).status_code == 401
    r = TestClient(app).post("/api/auth/login", json=wrong)
    assert r.status_code == 401 and r.json()["detail"] == "Invalid username or password"
    r = TestClient(app).post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert r.status_code == 429  # the owner is told why


def test_recovery_code_works_once(app, admin):
    from app import totp

    secret = admin.post("/api/auth/me/totp/setup", json={"password": ADMIN_PW}).json()["secret"]
    step = int(__import__("time").time() // totp.STEP)
    codes = admin.post(
        "/api/auth/me/totp/enable", json={"code": totp.code_at(secret, step)}
    ).json()["recovery_codes"]
    body = {"username": "admin", "password": ADMIN_PW, "otp": codes[0]}
    assert TestClient(app).post("/api/auth/login", json=body).status_code == 200
    assert TestClient(app).post("/api/auth/login", json=body).status_code == 401


def test_dates_one_day_ahead_are_accepted(admin):
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    later = (date.today() + timedelta(days=2)).isoformat()
    assert admin.patch(f"/api/l3/{RULE}", json={"onboarded_at": tomorrow}).status_code == 200
    assert admin.patch(f"/api/l3/{RULE}", json={"onboarded_at": later}).status_code == 422


def test_lifecycle_order_and_fresh_checklist(admin):
    items = {k: True for k in ("log_sources", "scope", "incident_response", "roles", "rules")}
    admin.put(f"/api/l3/{RULE}/dod", json={"items": items})
    assert (
        admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "operational"}).status_code
        == 201
    )
    state = admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "retired"}).json()
    assert state["allowed"] == ["onboarding"]
    r = admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "operational"})
    assert r.status_code == 422 and "onboarding first" in r.json()["detail"]
    r = admin.patch(f"/api/l3/{RULE}", json={"lifecycle_status": "maintenance"})
    assert r.status_code == 422
    state = admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "onboarding"}).json()
    assert not state["dod_complete"] and not any(d["done"] for d in state["dod"])
    r = admin.post(f"/api/l3/{RULE}/lifecycle", json={"to_status": "operational"})
    assert r.status_code == 422 and "Definition of done" in r.json()["detail"]


def test_reference_entry_in_use_needs_confirmation(admin, make_user):
    analyst = make_user("analyst")
    item = admin.get("/api/references/log_source").json()[0]
    admin.patch(f"/api/l3/{RULE}", json={"log_sources": [item["name"]]})
    r = analyst.delete(f"/api/references/log_source/{item['id']}")
    assert r.status_code == 409 and r.json()["used_by"] == [RULE]
    assert admin.get(f"/api/l3/{RULE}").json()["log_sources"] == [item["name"]]
    r = analyst.delete(f"/api/references/log_source/{item['id']}?confirm=true")
    assert r.status_code == 204
    assert admin.get(f"/api/l3/{RULE}").json()["log_sources"] == []
    unused = admin.get("/api/references/log_source").json()[0]
    assert analyst.delete(f"/api/references/log_source/{unused['id']}").status_code == 204


def test_api_docs_are_served_locally(admin, anon):
    html = admin.get("/api/docs").text
    assert "cdn.jsdelivr.net" not in html and "/api/docs-assets/swagger-ui-bundle.js" in html
    assert admin.get("/api/docs-assets/swagger-ui-bundle.js").status_code == 200
    assert admin.get("/api/docs-assets/index.html").status_code == 404
    assert anon.get("/api/docs-assets/swagger-ui.css").status_code == 401
    assert "jsdelivr" not in admin.get("/api/docs").headers["content-security-policy"]
