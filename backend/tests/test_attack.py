from app import attack


def test_status_and_remap():
    assert attack.status("T1078") == ("current", "T1078")
    assert attack.status("T1086") == ("revoked", "T1059.001")
    assert attack.status("T1064")[0] == "deprecated"
    assert attack.status("T9999")[0] == "unknown"
    assert attack.remap(["T1086", "T1059.001", "T1064", "T1078"]) == ["T1059.001", "T1064", "T1078"]
    assert attack.parent("T1059.001") == "T1059"
    assert attack.name("T1059.001")


def _operational(admin, code, techniques=None):
    body = {
        "effectiveness": 0.8,
        "implementation": 1,
        "coverage": 1,
        "lifecycle_status": "operational",
    }
    if techniques is not None:
        body["attack_techniques"] = techniques
    r = admin.patch(f"/api/l3/{code}", json=body)
    assert r.status_code == 200, r.text


def test_coverage_counts_sub_techniques_for_parent(admin):
    _operational(admin, "PV-PRC-01", ["T1059.001"])
    c = admin.get("/api/attack/coverage").json()
    assert c["version"] and c["techniques_total"] > 150
    execution = next(t for t in c["tactics"] if t["short"] == "execution")
    t1059 = next(t for t in execution["techniques"] if t["id"] == "T1059")
    assert abs(t1059["best"] - 0.8) < 1e-9
    hit = next(h for h in t1059["rules"] if h["code"] == "PV-PRC-01")
    assert hit["weight"] == 0.8 and hit["direct"] is False
    sub = next(s for s in t1059["subs"] if s["id"] == "T1059.001")
    assert [h["direct"] for h in sub["rules"] if h["code"] == "PV-PRC-01"] == [True]
    assert any(o["code"] == "AO-CRE-02" and o["replacement"] == "T1552.001" for o in c["outdated"])


def test_navigator_layer(admin, make_user):
    _operational(admin, "AO-ACC-01")
    auditor = make_user("auditor")
    r = auditor.get("/api/attack/navigator.json")
    assert r.status_code == 200
    layer = r.json()
    assert layer["domain"] == "enterprise-attack" and layer["versions"]["layer"] == "4.5"
    t = next(x for x in layer["techniques"] if x["techniqueID"] == "T1078")
    assert t["score"] == 80 and "AO-ACC-01" in t["comment"]
    ids = {x["techniqueID"] for x in layer["techniques"]}
    assert "T1081" not in ids  # outdated IDs are shown under their replacement


def test_remap_is_admin_only_and_audited(admin, make_user):
    analyst = make_user("analyst")
    assert analyst.get("/api/attack/remap").status_code == 403
    assert analyst.post("/api/attack/remap").status_code == 403
    preview = admin.get("/api/attack/remap").json()
    assert preview["applied"] is False and preview["ids_replaced"] > 50
    ch = next(c for c in preview["changes"] if c["code"] == "PV-PRC-01")
    assert ch["before"] == ["T1086"] and ch["after"] == ["T1059.001"]
    assert admin.get("/api/l3/PV-PRC-01").json()["attack_techniques"] == ["T1086"]

    done = admin.post("/api/attack/remap").json()
    assert done["applied"] is True and done["ids_replaced"] == preview["ids_replaced"]
    assert admin.get("/api/l3/PV-PRC-01").json()["attack_techniques"] == ["T1059.001"]
    assert admin.get("/api/attack/remap").json()["ids_replaced"] == 0
    left = admin.get("/api/attack/coverage").json()["outdated"]
    assert left and all(o["status"] == "deprecated" for o in left)
    log = admin.get("/api/audit", params={"entity": "l3"}).json()
    assert any(e["action"] == "attack_remap" for e in log)
