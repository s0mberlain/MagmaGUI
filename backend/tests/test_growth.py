from app import growth


def test_parse_risk_targets():
    t = growth.parse_risk_targets("5=0.95, 3=bad, 9=0.1")
    assert t[5] == 0.95 and t[3] == 0.6 and 9 not in t


def test_rule_inherits_risk_and_target(admin):
    admin.patch("/api/l2/AO-CRE", json={"risk_level": 4})
    admin.patch(
        "/api/l3/AO-CRE-01",
        json={
            "effectiveness": 0.9,
            "implementation": 0.5,
            "coverage": 1,
            "lifecycle_status": "operational",
        },
    )
    r = admin.get("/api/l3/AO-CRE-01").json()
    assert r["effective_risk"] == 4 and r["risk_source"] == "l2"
    assert r["effective_target"] == 0.75 and r["target_source"] == "risk"
    assert abs(r["implementation_gap"] - 0.25) < 1e-9
    assert abs(r["priority"] - 0.45 * 4 / 5) < 1e-9

    admin.patch("/api/l2/AO-CRE", json={"target_implementation": 0.6})
    admin.patch("/api/l3/AO-CRE-01", json={"risk_level": 5, "target_implementation": 0.4})
    r = admin.get("/api/l3/AO-CRE-01").json()
    assert (r["effective_risk"], r["risk_source"]) == (5, "rule")
    assert (r["effective_target"], r["target_source"]) == (0.4, "rule")
    assert r["implementation_gap"] == 0


def test_gap_view(admin, make_user):
    auditor = make_user("auditor")
    admin.patch("/api/l2/AO-CRE", json={"risk_level": 5})
    admin.patch(
        "/api/l3/AO-CRE-01",
        json={
            "effectiveness": 0.9,
            "implementation": 0.2,
            "coverage": 0.5,
            "lifecycle_status": "operational",
        },
    )
    admin.patch(
        "/api/l3/AO-CRE-02",
        json={
            "effectiveness": 0.5,
            "implementation": 0.95,
            "coverage": 0.9,
            "lifecycle_status": "operational",
        },
    )
    g = auditor.get("/api/growth/gaps?l1=AO&below_target=true").json()
    codes = [x["code"] for x in g["rows"]]
    assert codes[0] == "AO-CRE-01" and "AO-CRE-02" not in codes
    assert g["summary"]["by_risk"]["5"]["below_target"] >= 1
    assert g["summary"]["risk_targets"]["5"] == 0.9
    only_high = auditor.get("/api/growth/gaps?min_risk=5").json()["rows"]
    assert all(x["risk"] == 5 for x in only_high)


def test_maturity(admin, make_user):
    analyst = make_user("analyst")
    auditor = make_user("auditor")
    m = auditor.get("/api/maturity").json()
    assert m["current"] is None and len(m["levels"]) == 5
    assert auditor.post("/api/maturity", json={"level": 2}).status_code == 403
    assert analyst.post("/api/maturity", json={"level": 6}).status_code == 422
    assert analyst.post("/api/maturity", json={"level": 2, "aspects": {"x": 1}}).status_code == 422
    r = analyst.post(
        "/api/maturity",
        json={
            "level": 2,
            "target_level": 3,
            "aspects": {"people": 2, "process": 2},
            "notes": "first",
            "assessed_at": "2026-01-15",
        },
    )
    assert r.status_code == 201
    analyst.post("/api/maturity", json={"level": 3})
    m = auditor.get("/api/maturity").json()
    assert m["current"]["level"] == 3 and len(m["history"]) == 2
    assert admin.post("/api/snapshots", json={}).json()["kpis"]["maturity_level"] == 3
    assert analyst.delete(f"/api/maturity/{m['current']['id']}").status_code == 403
    assert admin.delete(f"/api/maturity/{m['current']['id']}").status_code == 204
    assert auditor.get("/api/maturity").json()["current"]["level"] == 2
