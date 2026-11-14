def test_seeded_catalogue(admin):
    s = admin.get("/api/catalogue/summary").json()
    assert (s["l1"], s["l2"], s["l3"]) == (13, 62, 169)
    assert s["business_drivers"] == 6
    assert s["references"] == {
        "threat_actor": 7,
        "detection_technology": 7,
        "log_source": 7,
        "scope": 18,
    }
    l1 = {x["code"]: x for x in admin.get("/api/l1").json()}
    assert l1["AO"]["l2_count"] == 16 and l1["AO"]["l3_count"] == 126
    assert l1["WE"]["applicable"] is False
    rule = admin.get("/api/l3/AO-CRE-01").json()
    assert rule["attack_techniques"] == ["T1003"]
    assert rule["effectiveness"] is None
    assert rule["l2_code"] == "AO-CRE"


def test_id_validation(admin):
    assert admin.post("/api/l1", json={"code": "abc", "name": "x"}).status_code == 422
    assert admin.post("/api/l2", json={"code": "ZZ-ABC", "name": "x"}).status_code == 422
    assert admin.post("/api/l2", json={"code": "DE-WEB", "name": "dup"}).status_code == 409
    assert admin.post("/api/l3", json={"code": "DE-XYZ-01", "name": "x"}).status_code == 422
    assert admin.post("/api/l3", json={"code": "DE-WEB-1", "name": "x"}).status_code == 422


def test_create_hierarchy_and_next_code(admin):
    assert admin.post("/api/l1", json={"code": "FI", "name": "Financial fraud"}).status_code == 201
    r = admin.post(
        "/api/l2",
        json={
            "code": "FI-PAY",
            "name": "Payment fraud",
            "actors": ["Professional Criminals"],
            "business_drivers": ["BD-01"],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["l1_code"] == "FI"
    assert admin.get("/api/l3/next-code/FI-PAY").json() == {"code": "FI-PAY-01"}
    r = admin.post(
        "/api/l3",
        json={
            "code": "FI-PAY-01",
            "name": "Detect mule account payments",
            "effectiveness": 0.8,
            "implementation": 0.5,
            "coverage": 0.6,
            "log_sources": ["Application log", "Database log"],
            "detection_technologies": ["SIEM"],
            "scopes": ["Business critical applications"],
            "onboarded_at": "2026-11-01",
            "lifecycle_status": "operational",
        },
    )
    assert r.status_code == 201, r.text
    rule = r.json()
    assert rule["log_sources"] == ["Application log", "Database log"]
    assert rule["lifecycle_status"] == "operational"
    assert admin.get("/api/l3/next-code/FI-PAY").json() == {"code": "FI-PAY-02"}
    # parent cannot be deleted while it has children
    assert admin.delete("/api/l2/FI-PAY").status_code == 409


def test_metric_and_reference_validation(admin):
    assert admin.patch("/api/l3/AO-CRE-01", json={"effectiveness": 1.5}).status_code == 422
    r = admin.patch("/api/l3/AO-CRE-01", json={"log_sources": ["Nope"]})
    assert r.status_code == 422 and "Nope" in r.json()["detail"]


def test_multiple_data_sources_and_verification(admin):
    r = admin.patch(
        "/api/l3/AO-CRE-01",
        json={
            "log_sources": ["OS logging", "Network traffic", "OS logging"],
            "scopes": ["All assets"],
            "last_verified_at": "2026-11-13",
        },
    )
    assert r.status_code == 200, r.text
    rule = r.json()
    assert rule["log_sources"] == ["Network traffic", "OS logging"]
    assert rule["scopes"] == ["All assets"]
    assert rule["last_verified_by"] == "admin"
    # updating one kind keeps the others
    rule = admin.patch("/api/l3/AO-CRE-01", json={"detection_technologies": ["SIEM"]}).json()
    assert rule["log_sources"] == ["Network traffic", "OS logging"]
    assert rule["detection_technologies"] == ["SIEM"]


def test_audit_trail(admin):
    admin.patch("/api/l3/AO-CRE-01", json={"comments": "tuned", "effectiveness": 0.9})
    entries = admin.get("/api/audit", params={"entity": "l3", "key": "AO-CRE-01"}).json()
    assert entries[0]["action"] == "update"
    assert entries[0]["username"] == "admin"
    assert entries[0]["changes"]["effectiveness"] == [None, 0.9]


def test_references_and_drivers_crud(admin):
    r = admin.post("/api/references/log_source", json={"name": "EDR telemetry"})
    assert r.status_code == 201
    assert (
        admin.post("/api/references/log_source", json={"name": "EDR telemetry"}).status_code == 409
    )
    src = admin.get("/api/compliance").json()[0]
    r = admin.post(f"/api/compliance/{src['id']}/drivers", json={"ref": "ISP-7.2"})
    assert r.status_code == 201
    cd = r.json()["id"]
    r = admin.patch("/api/l2/AO-CRE", json={"compliance_driver_ids": [cd]})
    assert r.json()["compliance_driver_ids"] == [cd]


def test_reference_usage(admin, make_user):
    """Each reference entry lists what uses it: L3 rules, or L2 use cases for threat actors."""
    before = {i["name"]: i["used_by"] for i in admin.get("/api/references/log_source").json()}
    admin.patch("/api/l3/AO-CRE-01", json={"log_sources": ["OS logging", "Network traffic"]})
    auditor = make_user("auditor")
    items = {i["name"]: i for i in auditor.get("/api/references/log_source").json()}
    assert "AO-CRE-01" in items["OS logging"]["used_by"]
    assert "AO-CRE-01" in items["Network traffic"]["used_by"]
    assert items["OS logging"]["used_by"] == sorted(items["OS logging"]["used_by"])
    # removing the entry from the rule lowers the count again
    admin.patch("/api/l3/AO-CRE-01", json={"log_sources": ["Network traffic"]})
    items = {i["name"]: i for i in admin.get("/api/references/log_source").json()}
    assert "AO-CRE-01" not in items["OS logging"]["used_by"]
    assert len(items["OS logging"]["used_by"]) == len(
        [c for c in before["OS logging"] if c != "AO-CRE-01"]
    )
    # a new entry is unused
    admin.post("/api/references/scope", json={"name": "Lab"})
    lab = [i for i in admin.get("/api/references/scope").json() if i["name"] == "Lab"][0]
    assert lab["used_by"] == []
    # threat actors count L2 use cases, not rules
    admin.patch("/api/l2/AO-CRE", json={"actors": ["Professional Criminals"]})
    actors = {i["name"]: i for i in admin.get("/api/references/threat_actor").json()}
    assert "AO-CRE" in actors["Professional Criminals"]["used_by"]
    assert all(c.count("-") == 1 for c in actors["Professional Criminals"]["used_by"])
