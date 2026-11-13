from datetime import date, timedelta


def test_scores_empty_catalogue(admin):
    s = admin.get("/api/scores").json()
    assert s["kpis"]["soc_detection_score"] is None
    assert s["kpis"]["applicable_l2"] == 62
    assert len(s["l1"]) == 13 and len(s["l2"]) == 62


def test_scores_follow_rule_changes(admin):
    admin.patch(
        "/api/l3/AO-CRE-01",
        json={
            "effectiveness": 0.9,
            "implementation": 0.8,
            "coverage": 0.5,
            "lifecycle_status": "operational",
        },
    )
    rule = admin.get("/api/l3/AO-CRE-01").json()
    assert rule["scored"] and abs(rule["weight"] - 0.36) < 1e-9
    assert rule["verification_overdue"]  # never verified
    s = admin.get("/api/scores").json()
    assert abs(s["kpis"]["soc_detection_score"] - 0.36) < 1e-9
    assert s["kpis"]["l2_with_scored_rules"] == 1
    ao = next(x for x in s["l1"] if x["code"] == "AO")
    assert ao["scored_l2"] == 1 and abs(ao["potential"] - 0.54) < 1e-9


def test_verify_now_and_history(admin, make_user):
    auditor = make_user("auditor")
    assert auditor.post("/api/l3/AO-CRE-01/verify", json={}).status_code == 403
    admin.patch("/api/l3/AO-CRE-01", json={"lifecycle_status": "operational"})
    old = (date.today() - timedelta(days=200)).isoformat()
    r = admin.post("/api/l3/AO-CRE-01/verify", json={"verified_at": old, "result": "issues"})
    assert r.status_code == 201
    assert admin.get("/api/l3/AO-CRE-01").json()["verification_overdue"]
    due = admin.get("/api/verification/due").json()
    assert [d["code"] for d in due] == ["AO-CRE-01"]
    admin.post("/api/l3/AO-CRE-01/verify", json={"note": "ok now"})
    rule = admin.get("/api/l3/AO-CRE-01").json()
    assert rule["last_verified_at"] == date.today().isoformat()
    assert rule["last_verified_by"] == "admin"
    assert not rule["verification_overdue"]
    hist = auditor.get("/api/l3/AO-CRE-01/verifications").json()
    assert [h["result"] for h in hist] == ["ok", "issues"]
    future = (date.today() + timedelta(days=1)).isoformat()
    assert admin.post("/api/l3/AO-CRE-01/verify", json={"verified_at": future}).status_code == 422


def test_demo_data_is_reproducible(admin, make_user):
    analyst = make_user("analyst")
    assert analyst.post("/api/admin/demo-data", json={}).status_code == 403
    r = admin.post("/api/admin/demo-data", json={"seed": 7})
    assert r.status_code == 200 and r.json()["rules"] > 169
    first = admin.get("/api/scores").json()["kpis"]
    admin.post("/api/admin/demo-data", json={"seed": 7})
    again = admin.get("/api/scores").json()["kpis"]
    assert first == again
    k = first
    assert 0 < k["soc_detection_score"] < 1
    assert 0 < k["verification_health"] < 1
    assert 0 < k["assessment_coverage"] < 1
    rules = admin.get("/api/l3", params={"l2": "AO-CRE"}).json()
    assert all(r["log_sources"] for r in rules)
    assert any(len(r["log_sources"]) > 1 for r in admin.get("/api/l3").json())
