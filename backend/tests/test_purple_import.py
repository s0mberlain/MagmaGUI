"""Purple team library: test procedures, campaign templates, the bundled Atomic Red Team index
and imports (Atomic Red Team YAML, SRA/VECTR Threat Simulation Index YAML, CSV)."""

from app import purple_import as pimp

ART = b"""
attack_technique: T1003.001
display_name: "OS Credential Dumping: LSASS Memory"
atomic_tests:
- name: Dump LSASS.exe Memory using ProcDump
  auto_generated_guid: 0be2230c-9ab3-4ac2-8826-3199b9a0ebf8
  description: The memory of lsass.exe is often dumped for offline credential theft attacks.
  supported_platforms:
  - windows
  input_arguments:
    output_file:
      description: Path where resulting dump should be placed
      type: path
      default: C:\\Windows\\Temp\\lsass_dump.dmp
  executor:
    command: 'procdump.exe -accepteula -ma lsass.exe #{output_file}'
    cleanup_command: 'del "#{output_file}"'
    name: command_prompt
    elevation_required: true
- name: Second test
  auto_generated_guid: 11111111-2222-3333-4444-555555555555
  supported_platforms: [windows]
  executor:
    name: powershell
    command: Get-Process lsass
"""

TSI = b"""
metadata:
  prefix: TSI
  bundle: Threat Simulation Index 2026 v1.0.0
Credential Access:
- name: Extract browser cookies
  description: Extract cookie information from the user's browser
  platforms:
  - windows
  prerequisites:
  guidance:
  - cmd> chrome_elevator.exe {{ browser }}
  block:
  - Suspicious process execution/behavior blocked by endpoint security tool
  detect:
  - Suspicious process execution/behavior detected by endpoint security tool
  controls:
  - Endpoint Protection
  - SIEM
  metadata:
    id: c7dec88c-4c95-4b72-8e18-b31a8fe4c6e2
    tid: T1539
    tactic: TA0006
    x_tools:
    - https://github.com/xaitax/Chrome-App-Bound-Encryption-Decryption
    x_vectr_id: c7dec88c-4c95-4b72-8e18-b31a8fe4c6e2
    isv: 1
Discovery:
- name: Domain trust discovery
  description: Enumerate domain trusts
  platforms: [windows]
  prerequisites: [domain_user]
  guidance:
  - cmd> nltest /domain_trusts
  block: []
  detect: ['']
  controls: [SIEM]
  metadata:
    id: 0d2b4b16-0000-0000-0000-000000000001
    tid: T1482
    tactic: TA0007
"""

CSV = (
    "Campaign,Test case,Techniques,Tactic,Command,Tags\n"
    "Discovery,Whoami,T1033,discovery,whoami /all,quick\n"
    "Discovery,Bad one,T9999,,x,\n"
)


def imp(client, fmt, data, name="f", dry_run=True, update=False, expect=200):
    r = client.post(
        f"/api/purple/import?format={fmt}&dry_run={str(dry_run).lower()}&update={str(update).lower()}",
        files={"file": (name, data, "application/octet-stream")},
    )
    assert r.status_code == expect, r.text
    return r.json()


def test_parse_atomic_fills_input_defaults():
    p = pimp.parse("atomic", ART)
    assert len(p.templates) == 2
    t = p.templates[0]
    assert t["techniques"] == ["T1003.001"]
    assert t["tactic"] == "credential-access"
    assert "lsass_dump.dmp" in t["command"] and "#{" not in t["command"]
    assert t["source"] == "atomic" and t["source_ref"] == "0be2230c-9ab3-4ac2-8826-3199b9a0ebf8"
    assert "administrator" in t["operator_guidance"]


def test_parse_tsi_campaigns_and_expected_defenses():
    p = pimp.parse("vectr_tsi", TSI)
    assert p.bundle == "Threat Simulation Index 2026 v1.0.0"
    assert [c["name"] for c in p.campaigns] == [
        "Threat Simulation Index 2026 v1.0.0: Credential Access",
        "Threat Simulation Index 2026 v1.0.0: Discovery",
    ]
    t = p.templates[0]
    assert t["techniques"] == ["T1539"] and t["tactic"] == "credential-access"
    assert t["expected_defenses"] == ["Endpoint Protection", "SIEM"]
    assert t["prevention_steps"].startswith("- Suspicious")
    assert p.templates[1]["detection_steps"] == ""
    assert p.templates[1]["operator_guidance"] == "Prerequisites: domain_user"


def test_bad_files():
    for fmt, data in (("atomic", b"just: text"), ("vectr_tsi", b"- a\n- b"), ("csv", b"a,b\n1,2")):
        try:
            pimp.parse(fmt, data)
        except pimp.ImportFormatError:
            continue
        raise AssertionError(fmt)


def test_import_preview_apply_and_skip(admin):
    preview = imp(admin, "vectr_tsi", TSI)
    assert preview["dry_run"] and preview["counts"] == {"create": 2, "update": 0, "skip": 0}
    assert admin.get("/api/purple/templates").json() == []
    done = imp(admin, "vectr_tsi", TSI, dry_run=False)
    assert done["counts"]["create"] == 2
    templates = admin.get("/api/purple/templates").json()
    assert {t["name"] for t in templates} == {"Extract browser cookies", "Domain trust discovery"}
    cts = admin.get("/api/purple/campaign-templates").json()
    assert len(cts) == 2 and cts[0]["templates"][0]["name"] == "Extract browser cookies"
    # importing again skips, or updates when asked
    assert imp(admin, "vectr_tsi", TSI, dry_run=False)["counts"]["skip"] == 2
    assert imp(admin, "vectr_tsi", TSI, dry_run=False, update=True)["counts"]["update"] == 2
    assert len(admin.get("/api/purple/templates").json()) == 2
    # the audit log has the import
    log = admin.get("/api/audit?limit=50").json()
    items = log["items"] if isinstance(log, dict) else log
    assert any(e["action"] == "import" and e["entity"] == "pt_library" for e in items)


def test_import_csv_reports_unknown_techniques(admin):
    r = imp(admin, "csv", CSV.encode(), dry_run=False)
    assert r["counts"]["create"] == 2
    assert any("T9999" in e for e in r["errors"])
    cts = admin.get("/api/purple/campaign-templates").json()
    assert cts[0]["name"] == "Discovery" and len(cts[0]["templates"]) == 2


def test_import_refuses_bad_file(admin):
    imp(admin, "atomic", b"\xff\xfe\x00", expect=422)
    imp(admin, "vectr_tsi", b"key: [unclosed", expect=422)


def test_assessment_from_campaign_templates(admin):
    imp(admin, "vectr_tsi", TSI, dry_run=False)
    ids = [c["id"] for c in admin.get("/api/purple/campaign-templates").json()]
    r = admin.post(
        "/api/purple/assessments", json={"name": "TSI run", "campaign_template_ids": ids}
    )
    assert r.status_code == 201, r.text
    a = r.json()
    assert [c["name"] for c in a["campaign_list"]] == [
        "Threat Simulation Index 2026 v1.0.0: Credential Access",
        "Threat Simulation Index 2026 v1.0.0: Discovery",
    ]
    tc = a["campaign_list"][0]["test_cases"][0]
    t = admin.get(f"/api/purple/test-cases/{tc['id']}").json()
    assert t["lineage_key"] == f"tpl:{t['template_id']}"
    # the controls of the procedure are the expected detections
    assert [(d["tool"], d["expected"]) for d in t["detection_list"]] == [
        ("Endpoint Protection", True),
        ("SIEM", True),
    ]
    assert t["prevention_steps"]


def test_template_crud_and_campaign_template(admin):
    body = {"name": "Kerberoasting", "techniques": ["t1558.003"], "expected_defenses": ["SIEM"]}
    r = admin.post("/api/purple/templates", json=body)
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["techniques"] == ["T1558.003"]
    assert (
        admin.post("/api/purple/templates", json=body | {"name": "kerberoasting"}).status_code
        == 409
    )
    r = admin.put(
        f"/api/purple/templates/{tpl['id']}", json=body | {"command": "Rubeus kerberoast"}
    )
    assert r.json()["command"] == "Rubeus kerberoast"
    r = admin.post(
        "/api/purple/campaign-templates", json={"name": "AD attacks", "template_ids": [tpl["id"]]}
    )
    assert r.status_code == 201
    ct = r.json()
    assert (
        admin.post(
            "/api/purple/campaign-templates", json={"name": "Bad", "template_ids": [9999]}
        ).status_code
        == 404
    )
    # filter by technique (parent matches sub-techniques)
    assert len(admin.get("/api/purple/templates?technique=T1558").json()) == 1
    assert admin.delete(f"/api/purple/templates/{tpl['id']}").status_code == 204
    assert admin.get("/api/purple/campaign-templates").json()[0]["template_ids"] == []
    assert ct["id"]


def test_bundled_atomics_browse_and_adopt(admin):
    r = admin.get("/api/purple/atomics?technique=T1003.001&platform=windows&limit=5")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] > 1000 and data["matches"] >= 1
    first = data["tests"][0]
    assert first["technique"] == "T1003.001" and not first["adopted"]
    r = admin.post(f"/api/purple/atomics/{first['guid']}/adopt")
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["source"] == "atomic" and tpl["techniques"] == ["T1003.001"]
    # adopting again gives the same template
    assert admin.post(f"/api/purple/atomics/{first['guid']}/adopt").json()["id"] == tpl["id"]
    again = admin.get("/api/purple/atomics?technique=T1003.001&platform=windows&limit=5").json()
    assert again["tests"][0]["adopted"]
    assert admin.post("/api/purple/atomics/nope/adopt").status_code == 404
