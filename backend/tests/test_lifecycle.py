ALL_DOD = {k: True for k in ("log_sources", "scope", "incident_response", "roles", "rules")}


def test_meta(admin):
    m = admin.get("/api/lifecycle/meta").json()
    assert [d["key"] for d in m["dod_items"]][0] == "log_sources"
    assert {"environmental", "operational", "other"} <= set(m["drivers"])


def test_operational_needs_definition_of_done(admin, make_user):
    analyst = make_user("analyst")
    body = {"to_status": "operational", "driver_type": "operational", "driver": "red_teaming"}
    r = analyst.post("/api/l3/AO-CRE-01/lifecycle", json=body)
    assert r.status_code == 422 and "Definition of done" in r.json()["detail"]
    # analysts cannot skip it, admins can (and it is logged)
    assert (
        analyst.post("/api/l3/AO-CRE-01/lifecycle", json=body | {"override": True}).status_code
        == 403
    )
    # plain edits keep the same gate
    assert (
        analyst.patch("/api/l3/AO-CRE-01", json={"lifecycle_status": "operational"}).status_code
        == 422
    )

    r = analyst.put("/api/l3/AO-CRE-01/dod", json={"items": ALL_DOD})
    assert r.status_code == 200 and r.json()["dod_complete"]
    assert r.json()["dod"][0]["by"] == "analyst1"
    r = analyst.post("/api/l3/AO-CRE-01/lifecycle", json=body | {"note": "purple team"})
    assert r.status_code == 201, r.text
    st = r.json()
    assert st["status"] == "operational"
    ev = st["events"][0]
    assert ev["from_status"] == "onboarding" and ev["driver"] == "red_teaming"
    assert ev["username"] == "analyst1" and not ev["dod_override"]
    assert admin.get("/api/l3/AO-CRE-01").json()["onboarded_at"] is not None


def test_admin_override_and_change_log(admin, make_user):
    auditor = make_user("auditor")
    body = {"to_status": "operational", "driver_type": "other", "driver": "other", "override": True}
    assert auditor.post("/api/l2/AO-CRE/lifecycle", json=body).status_code == 403
    r = admin.post("/api/l2/AO-CRE/lifecycle", json=body)
    assert r.status_code == 201 and r.json()["events"][0]["dod_override"]
    # wrong driver, same status
    bad = {"to_status": "maintenance", "driver_type": "environmental", "driver": "red_teaming"}
    assert admin.post("/api/l2/AO-CRE/lifecycle", json=bad).status_code == 422
    same = {"to_status": "operational"}
    assert admin.post("/api/l2/AO-CRE/lifecycle", json=same).status_code == 422
    # PATCH status change is logged as "unspecified"
    admin.patch("/api/l3/AO-CRE-02", json={"lifecycle_status": "retired"})
    log = auditor.get("/api/changes").json()
    assert [(e["code"], e["driver_type"]) for e in log[:2]] == [
        ("AO-CRE-02", "unspecified"),
        ("AO-CRE", "other"),
    ]
    assert auditor.get("/api/changes?driver_type=other").json()[0]["level"] == "l2"
    assert auditor.put("/api/l2/AO-CRE/dod", json={"items": {"scope": True}}).status_code == 403
    assert admin.put("/api/l2/AO-CRE/dod", json={"items": {"nope": True}}).status_code == 422
