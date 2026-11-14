"""Business and compliance drivers linked to L2 use cases (app/drivers.py)."""

import io

from openpyxl import load_workbook

from tests.test_excel import upload


def _rule(client, code: str, eff: float, impl: float, cov: float) -> None:
    r = client.post(
        "/api/l3",
        json={
            "code": code,
            "name": f"Rule {code}",
            "effectiveness": eff,
            "implementation": impl,
            "coverage": cov,
            "lifecycle_status": "operational",
        },
    )
    assert r.status_code == 201, r.text


def _setup(admin, l2s: list[str]) -> dict:
    """L1 ZZ with the given L2s, three business drivers and one compliance source."""
    assert admin.post("/api/l1", json={"code": "ZZ", "name": "Test threat"}).status_code == 201
    for code in l2s:
        assert admin.post("/api/l2", json={"code": code, "name": f"UC {code}"}).status_code == 201
    for code in ("T-1", "T-2", "T-3"):
        r = admin.post("/api/business-drivers", json={"code": code, "name": f"Driver {code}"})
        assert r.status_code == 201, r.text
    src = admin.post("/api/compliance", json={"name": "Test Reg"}).json()
    r1 = admin.post(f"/api/compliance/{src['id']}/drivers", json={"ref": "R1"}).json()
    r2 = admin.post(f"/api/compliance/{src['id']}/drivers", json={"ref": "R2"}).json()
    bds = {d["code"]: d["id"] for d in admin.get("/api/business-drivers").json()}
    return {"source": src["id"], "R1": r1["id"], "R2": r2["id"], "bd": bds}


def _cov(client) -> dict:
    c = client.get("/api/drivers/coverage").json()
    return {
        "bd": {d["code"]: d for d in c["business"]},
        "cd": {d["code"]: d for d in c["compliance"] if d["source"] == "Test Reg"},
        "src": {s["name"]: s for s in c["sources"]},
        "raw": c,
    }


def test_link_drivers_permissions_and_audit(admin, make_user):
    ids = _setup(admin, ["ZZ-AAA"])
    _rule(admin, "ZZ-AAA-01", 1, 1, 0.5)
    analyst, auditor = make_user("analyst"), make_user("auditor")

    body = {"business_drivers": ["T-1", "T-2"], "compliance_driver_ids": [ids["R1"]]}
    assert auditor.patch("/api/l2/ZZ-AAA", json=body).status_code == 403
    r = analyst.patch("/api/l2/ZZ-AAA", json=body)
    assert r.status_code == 200, r.text
    l2 = r.json()
    assert l2["business_drivers"] == ["T-1", "T-2"]
    assert [(c["source"], c["ref"]) for c in l2["compliance_drivers"]] == [("Test Reg", "R1")]

    # unknown codes are refused, nothing changes
    bad = analyst.patch("/api/l2/ZZ-AAA", json={"business_drivers": ["NOPE"]})
    assert bad.status_code == 422
    bad = analyst.patch("/api/l2/ZZ-AAA", json={"compliance_driver_ids": [999999]})
    assert bad.status_code == 422

    # L3 and L1 inherit read-only; the auditor can read them
    l3 = auditor.get("/api/l3/ZZ-AAA-01").json()
    assert l3["business_drivers"] == ["T-1", "T-2"]
    assert [c["ref"] for c in l3["compliance_drivers"]] == ["R1"]
    l1 = auditor.get("/api/l1/ZZ").json()
    assert l1["business_drivers"] == ["T-1", "T-2"]
    assert [c["ref"] for c in l1["compliance_drivers"]] == ["R1"]

    # the audit log has who, when and old -> new links (readable, not ids)
    analyst.patch("/api/l2/ZZ-AAA", json={"business_drivers": ["T-3"], "compliance_driver_ids": []})
    entry = next(
        e
        for e in admin.get("/api/audit?limit=20").json()
        if e["entity"] == "l2" and e["entity_key"] == "ZZ-AAA" and e["action"] == "update"
    )
    assert entry["username"] == "analyst1" and entry["at"]
    assert entry["changes"]["business_drivers"] == [["T-1", "T-2"], ["T-3"]]
    assert entry["changes"]["compliance_drivers"] == [["Test Reg R1"], []]


def test_filter_use_cases_by_driver(admin, make_user):
    ids = _setup(admin, ["ZZ-AAA", "ZZ-BBB", "ZZ-CCC"])
    admin.patch("/api/l2/ZZ-AAA", json={"business_drivers": ["T-1"]})
    admin.patch("/api/l2/ZZ-BBB", json={"compliance_driver_ids": [ids["R2"]]})
    auditor = make_user("auditor")

    def codes(q: str) -> list[str]:
        return [x["code"] for x in auditor.get(f"/api/l2?{q}").json()]

    assert codes("business_driver=T-1") == ["ZZ-AAA"]
    assert codes(f"compliance_driver={ids['R2']}") == ["ZZ-BBB"]
    assert codes(f"compliance_source={ids['source']}") == ["ZZ-BBB"]
    assert codes("business_driver=T-2") == []


def test_coverage_numbers_and_gaps(admin, make_user):
    ids = _setup(admin, ["ZZ-AAA", "ZZ-BBB", "ZZ-CCC"])
    _rule(admin, "ZZ-AAA-01", 1, 1, 0.8)  # weight 0.8
    _rule(admin, "ZZ-BBB-01", 0.5, 0.4, 1)  # weight 0.2
    # ZZ-CCC has no rules: a detection gap that counts as 0
    admin.patch(
        "/api/l2/ZZ-AAA", json={"business_drivers": ["T-1"], "compliance_driver_ids": [ids["R1"]]}
    )
    admin.patch("/api/l2/ZZ-BBB", json={"business_drivers": ["T-1"]})
    admin.patch("/api/l2/ZZ-CCC", json={"business_drivers": ["T-2"]})

    c = _cov(make_user("auditor"))
    t1, t2, t3 = c["bd"]["T-1"], c["bd"]["T-2"], c["bd"]["T-3"]
    assert (t1["l2_count"], t1["l3_count"], t1["scored_l2"]) == (2, 2, 2)
    assert abs(t1["coverage"] - 0.5) < 1e-9 and not t1["gap"] and not t1["low"]
    assert t1["l2_codes"] == ["ZZ-AAA", "ZZ-BBB"]
    assert (t2["l2_count"], t2["l3_count"], t2["coverage"]) == (1, 0, 0)
    assert t2["low"] and not t2["gap"]
    assert t3["gap"] and t3["coverage"] is None and t3["l2_count"] == 0

    r1, r2 = c["cd"]["R1"], c["cd"]["R2"]
    assert abs(r1["coverage"] - 0.8) < 1e-9 and r1["l3_count"] == 1
    assert r2["gap"]
    src = c["src"]["Test Reg"]
    assert (src["drivers"], src["linked_drivers"], src["gap_drivers"]) == (2, 1, 1)
    assert (src["l2_count"], src["l3_count"]) == (1, 1)
    assert abs(src["coverage"] - 0.8) < 1e-9
    assert c["raw"]["low_threshold"] == 0.3


def test_gaps_on_driver_linked_use_cases_rank_higher(admin, make_user):
    ids = _setup(admin, ["ZZ-DDD", "ZZ-EEE"])
    for code in ("ZZ-DDD", "ZZ-EEE"):
        admin.patch(f"/api/l2/{code}", json={"risk_level": 3})
        _rule(admin, f"{code}-01", 0.8, 0.5, 1)  # potential 0.4
    admin.patch(
        "/api/l2/ZZ-DDD", json={"business_drivers": ["T-1"], "compliance_driver_ids": [ids["R1"]]}
    )

    g = make_user("auditor").get("/api/growth/gaps?l1=ZZ").json()
    rows = {x["code"]: x for x in g["rows"]}
    assert [x["code"] for x in g["rows"]][:2] == ["ZZ-DDD-01", "ZZ-EEE-01"]
    # gap to the risk-3 target 0.6 is 0.1
    assert abs(rows["ZZ-EEE-01"]["priority"] - 0.1 * 3 / 5) < 1e-9
    assert abs(rows["ZZ-DDD-01"]["priority"] - 0.1 * 3 / 5 * 1.2) < 1e-9
    assert rows["ZZ-DDD-01"]["driver_boost"] == 1.2
    assert rows["ZZ-DDD-01"]["business_drivers"] == ["T-1"]
    assert rows["ZZ-DDD-01"]["compliance_drivers"] == ["Test Reg R1"]
    # the rule detail shows the same priority
    assert admin.get("/api/l3/ZZ-DDD-01").json()["priority"] == rows["ZZ-DDD-01"]["priority"]

    # uncovered drivers come first in the gap items, then low coverage
    gaps = g["driver_gaps"]
    names = [(d["source"], d["code"]) for d in gaps]
    assert {(None, "T-2"), (None, "T-3"), ("Test Reg", "R2")} <= set(names)
    assert (None, "T-1") not in names  # linked to ZZ-DDD, weight 0.4 is above the 0.3 threshold
    assert all(d["gap"] for d in gaps)

    # once ZZ-DDD drops below the threshold, T-1 is listed as low coverage after the gaps
    admin.patch("/api/l3/ZZ-DDD-01", json={"implementation": 0.2})
    gaps = admin.get("/api/growth/gaps?l1=ZZ").json()["driver_gaps"]
    low = [d for d in gaps if not d["gap"]]
    assert [(d["code"], d["low"]) for d in low if d["source"] is None] == [("T-1", True)]
    assert gaps.index(low[0]) == len(gaps) - len(low)


def test_delete_linked_driver_needs_confirmation(admin, make_user):
    ids = _setup(admin, ["ZZ-AAA", "ZZ-BBB"])
    admin.patch(
        "/api/l2/ZZ-AAA", json={"business_drivers": ["T-1"], "compliance_driver_ids": [ids["R1"]]}
    )
    admin.patch("/api/l2/ZZ-BBB", json={"business_drivers": ["T-1"]})
    analyst, auditor = make_user("analyst"), make_user("auditor")
    t1 = ids["bd"]["T-1"]

    linked = auditor.get(f"/api/business-drivers/{t1}/use-cases").json()
    assert [x["code"] for x in linked] == ["ZZ-AAA", "ZZ-BBB"]
    assert auditor.delete(f"/api/business-drivers/{t1}?confirm=true").status_code == 403

    r = analyst.delete(f"/api/business-drivers/{t1}")
    assert r.status_code == 409
    assert [x["code"] for x in r.json()["use_cases"]] == ["ZZ-AAA", "ZZ-BBB"]
    assert admin.get("/api/l2/ZZ-AAA").json()["business_drivers"] == ["T-1"]

    assert analyst.delete(f"/api/business-drivers/{t1}?confirm=true").status_code == 204
    assert admin.get("/api/l2/ZZ-AAA").json()["business_drivers"] == []
    entry = next(
        e for e in admin.get("/api/audit?limit=5").json() if e["entity"] == "business_driver"
    )
    assert entry["action"] == "delete" and entry["changes"]["unlinked"] == ["ZZ-AAA", "ZZ-BBB"]

    # unlinked drivers go without a question
    assert analyst.delete(f"/api/business-drivers/{ids['bd']['T-3']}").status_code == 204
    assert analyst.delete(f"/api/compliance/drivers/{ids['R2']}").status_code == 204

    # compliance driver and whole source
    r = analyst.delete(f"/api/compliance/drivers/{ids['R1']}")
    assert r.status_code == 409 and r.json()["use_cases"][0]["code"] == "ZZ-AAA"
    r = analyst.delete(f"/api/compliance/{ids['source']}")
    assert r.status_code == 409
    assert analyst.delete(f"/api/compliance/{ids['source']}?confirm=true").status_code == 204
    assert admin.get("/api/l2/ZZ-AAA").json()["compliance_drivers"] == []


def test_excel_reads_and_writes_driver_columns(admin):
    ids = _setup(admin, ["ZZ-AAA", "ZZ-BBB"])
    admin.patch(
        "/api/l2/ZZ-AAA",
        json={"business_drivers": ["T-2", "T-1"], "compliance_driver_ids": [ids["R1"], ids["R2"]]},
    )
    wb = load_workbook(io.BytesIO(admin.get("/api/export/excel").content))
    ws = wb["L2 UC"]
    head = {c.value: c.column for c in ws[1]}
    row = next(r for r in range(2, ws.max_row + 1) if ws.cell(r, 3).value == "ZZ-AAA")
    # first link per classic column, every link in the app columns
    assert ws.cell(row, head["Business Drivers"]).value == "T-1"
    assert ws.cell(row, head["Test Reg"]).value == "R1"
    assert ws.cell(row, head["All business drivers"]).value == "T-1; T-2"
    assert ws.cell(row, head["All compliance drivers"]).value == "Test Reg: R1; Test Reg: R2"

    # round trip keeps both links
    admin.patch("/api/l2/ZZ-AAA", json={"business_drivers": [], "compliance_driver_ids": []})
    buf = io.BytesIO()
    wb.save(buf)
    assert not upload(admin, buf.getvalue(), dry_run=False).json()["errors"]
    l2 = admin.get("/api/l2/ZZ-AAA").json()
    assert l2["business_drivers"] == ["T-1", "T-2"]
    assert [c["ref"] for c in l2["compliance_drivers"]] == ["R1", "R2"]

    # classic layout only: 'Business Driver', 'Test Reg reference'; unknown codes warn
    other = next(r for r in range(2, ws.max_row + 1) if ws.cell(r, 3).value == "ZZ-BBB")
    ws.cell(1, head["Business Drivers"], "Business Driver")
    ws.cell(1, head["Test Reg"], "Test Reg reference")
    ws.delete_cols(head["All business drivers"], 2)
    ws.cell(other, head["Business Drivers"], "T-3; BD-99")
    ws.cell(other, head["Test Reg"], "R2; X9")
    buf = io.BytesIO()
    wb.save(buf)
    preview = upload(admin, buf.getvalue()).json()
    msgs = [w["message"] for w in preview["warnings"]]
    assert "ZZ-BBB: unknown business driver 'BD-99' not linked" in msgs
    assert "ZZ-BBB: unknown compliance driver Test Reg X9 not linked" in msgs
    assert admin.get("/api/l2/ZZ-BBB").json()["business_drivers"] == []  # preview saves nothing
    upload(admin, buf.getvalue(), dry_run=False)
    l2 = admin.get("/api/l2/ZZ-BBB").json()
    assert l2["business_drivers"] == ["T-3"]
    assert [c["ref"] for c in l2["compliance_drivers"]] == ["R2"]


def test_demo_data_links_drivers(admin):
    assert admin.post("/api/admin/demo-data", json={"seed": 5}).status_code in (200, 201)
    l2s = admin.get("/api/l2").json()
    assert all(1 <= len(x["business_drivers"]) <= 3 for x in l2s)
    assert all(1 <= len(x["compliance_driver_ids"]) <= 2 for x in l2s)
    c = admin.get("/api/drivers/coverage").json()
    assert any(d["gap"] for d in c["business"])
    assert any(d["gap"] for d in c["compliance"])
    assert admin.get("/api/report.pdf").status_code == 200
