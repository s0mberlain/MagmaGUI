import io

from openpyxl import Workbook, load_workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def upload(client, data: bytes, mode="merge", dry_run=True):
    return client.post(
        "/api/import/excel",
        files={"file": ("ucf.xlsx", data, XLSX)},
        data={"mode": mode, "dry_run": str(dry_run).lower()},
    )


def test_export_has_classic_layout(admin):
    admin.post("/api/admin/demo-data", json={"seed": 1})
    r = admin.get("/api/export/excel")
    assert r.status_code == 200 and r.headers["content-type"] == XLSX
    wb = load_workbook(io.BytesIO(r.content))
    assert {"L1 UC", "L2 UC", "L3 UC", "Drivers", "References"} <= set(wb.sheetnames)
    ws = wb["L3 UC"]
    assert ws["F1"].value == "Rule Identifier" and ws["I1"].value == "Effectiveness %"
    assert ws["L2"].value.startswith("=IF(COUNT(I2:K2)=3")


def test_round_trip_keeps_rule_data(admin):
    admin.post("/api/admin/demo-data", json={"seed": 3})
    before = {x["code"]: x for x in admin.get("/api/l3").json()}
    data = admin.get("/api/export/excel").content

    # wipe some values, then restore them from the export
    admin.patch("/api/l3/AO-CRE-01", json={"effectiveness": 0.01, "log_sources": []})
    preview = upload(admin, data).json()
    assert preview["dry_run"] and not preview["errors"]
    assert preview["counts"]["l3"]["updated"] == 1
    # everything else round-trips unchanged (incl. actor names that contain commas)
    assert preview["counts"]["l2"]["updated"] == 0 and not preview["warnings"]
    assert preview["counts"]["references"]["created"] == 0
    assert admin.get("/api/l3/AO-CRE-01").json()["effectiveness"] == 0.01  # preview saved nothing

    applied = upload(admin, data, dry_run=False).json()
    assert applied["counts"]["l3"]["updated"] == 1
    after = {x["code"]: x for x in admin.get("/api/l3").json()}
    assert after.keys() == before.keys()
    for code, b in before.items():
        a = after[code]
        for f in (
            "name",
            "effectiveness",
            "implementation",
            "coverage",
            "lifecycle_status",
            "log_sources",
            "detection_technologies",
            "scopes",
            "onboarded_at",
            "last_verified_at",
            "verification_interval_days",
            "attack_techniques",
        ):
            assert a[f] == b[f], (code, f)
    l2 = admin.get("/api/l2/AO-CRE").json()
    assert l2["actors"]


def classic_workbook() -> bytes:
    """A small workbook in the original tool's layout (no app columns)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "L1 UC"
    ws.append([None, None, "Strategic Overview"])
    ws.append(["Threat category", None, "L1 Use Case Identifier", "Use Case Name", "Purpose"])
    ws.append(["Cyber killchain", None, "ZZ", "Test threat", "testing"])
    ws.append([None, None, "N/A", "Weaponization"])
    ws2 = wb.create_sheet("L2 UC")
    ws2.append(
        [
            "L1 Use Case Name",
            "L1 Use Case Identifier",
            "L2 Use Case Identifier",
            "Use Case Name",
            "Use Case Description",
            "Actors",
            "#L3 UC related",
        ]
    )
    ws2.append(["=x", "=LEFT(C2,2)", "ZZ-ABC", "Alpha", "desc", "Internal Actors; New Actor"])
    ws2.append([None, None, "QQ-ABC", "Orphan"])
    ws3 = wb.create_sheet("L3 UC")
    ws3.append(
        [
            "#",
            "",
            "",
            "",
            "",
            "Rule Identifier",
            "Technical Use Case Name",
            "Use Case Description",
            "Effectiveness %",
            "Implementation %",
            "Coverage %",
            "Weight",
            "Potential",
            "Log source type",
            "Detection Technology",
            "Scope",
            "comments",
        ]
    )
    ws3.append(
        [None] * 5
        + [
            "ZZ-ABC-01",
            "Rule one",
            "https://attack.mitre.org/wiki/Technique/T1003",
            "80",
            0.5,
            None,
            "=I2*J2*K2",
            None,
            "Firewall, Proxy log",
            "SIEM",
            "All users",
            "hi",
        ]
    )
    ws3.append([None] * 5 + ["bad-id", "x"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_import_classic_workbook(admin, make_user):
    analyst = make_user("analyst")
    assert upload(analyst, classic_workbook(), mode="replace").status_code == 403
    r = upload(analyst, classic_workbook(), dry_run=False)
    assert r.status_code == 200, r.text
    rep = r.json()
    msgs = " | ".join(e["message"] for e in rep["errors"])
    assert "QQ-ABC" in msgs and "bad-id" in msgs
    assert any("New Actor" in w["message"] for w in rep["warnings"])
    assert any("80" in w["message"] for w in rep["warnings"])  # 0-100 scale
    rule = admin.get("/api/l3/ZZ-ABC-01").json()
    assert rule["effectiveness"] == 0.8 and rule["coverage"] is None
    assert rule["attack_techniques"] == ["T1003"]
    assert sorted(rule["log_sources"]) == ["Firewall", "Proxy log"]
    assert not admin.get("/api/l1/WE").json()["applicable"]


def test_import_rejects_other_files(admin):
    assert upload(admin, b"not a workbook").status_code == 422
    wb = Workbook()
    buf = io.BytesIO()
    wb.save(buf)
    assert upload(admin, buf.getvalue()).status_code == 422


def test_json_backup(admin):
    admin.post("/api/admin/demo-data", json={"seed": 2})
    b = admin.get("/api/export/json").json()
    assert b["format"] == "magma-ucf-backup" and len(b["l3"]) > 169
    assert b["config_commits"] and b["verifications"]
