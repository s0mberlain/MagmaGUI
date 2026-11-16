"""Issues #19 (rename drivers and compliance sources) and #23 (extra identifiers in L3 IDs)."""


def _l2(admin, l1: str = "ZZ", l2: str = "ZZ-AAA") -> None:
    assert admin.post("/api/l1", json={"code": l1, "name": "Test threat"}).status_code == 201
    assert admin.post("/api/l2", json={"code": l2, "name": "UC"}).status_code == 201


def test_l3_code_with_extra_identifiers(admin):
    _l2(admin)
    for code in ("ZZ-AAA-01", "ZZ-AAA-WIN-01", "ZZ-AAA-WIN-AD-002", "ZZ-AAA-X1-99"):
        r = admin.post("/api/l3", json={"code": code, "name": "x"})
        assert r.status_code == 201, (code, r.text)
        assert r.json()["l2_code"] == "ZZ-AAA"
    for bad in (
        "ZZ-AAA-WIN",
        "ZZ-AAA-win-01",
        "ZZ-AAA-WIN-1",
        "ZZ-AAA--01",
        "ZZ-AAA-WIN--01",
        "ZZ-AAA-" + "A" * 60 + "-01",
    ):
        assert admin.post("/api/l3", json={"code": bad, "name": "x"}).status_code == 422, bad
    # parent comes from the XX-YYY prefix, not from the last dash
    assert admin.post("/api/l3", json={"code": "ZZ-BBB-WIN-01", "name": "x"}).status_code == 422
    assert admin.get("/api/l3/ZZ-AAA-WIN-AD-002").json()["l2_code"] == "ZZ-AAA"
    # the next suggested number counts rules with extra identifiers too
    assert admin.get("/api/l3/next-code/ZZ-AAA").json()["code"] == "ZZ-AAA-100"


def test_rename_compliance_source(admin, make_user):
    src = admin.post("/api/compliance", json={"name": "ISO 27001"}).json()
    admin.post("/api/compliance", json={"name": "DORA"})
    auditor = make_user("auditor")
    assert auditor.patch(f"/api/compliance/{src['id']}", json={"name": "x"}).status_code == 403
    r = make_user("analyst").patch(f"/api/compliance/{src['id']}", json={"name": "ISO 27001:2022"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "ISO 27001:2022"
    names = [s["name"] for s in admin.get("/api/compliance").json()]
    assert "ISO 27001:2022" in names and "ISO 27001" not in names
    assert admin.patch(f"/api/compliance/{src['id']}", json={"name": "DORA"}).status_code == 409
    assert admin.patch("/api/compliance/99999", json={"name": "x"}).status_code == 404


def test_rename_business_driver_keeps_links(admin):
    _l2(admin)
    bd = admin.post("/api/business-drivers", json={"code": "BD-1", "name": "Old"}).json()
    admin.patch("/api/l2/ZZ-AAA", json={"business_drivers": ["BD-1"]})
    r = admin.patch(f"/api/business-drivers/{bd['id']}", json={"code": "BD-1", "name": "New name"})
    assert r.status_code == 200 and r.json()["name"] == "New name"
    assert admin.get("/api/l2/ZZ-AAA").json()["business_drivers"] == ["BD-1"]
