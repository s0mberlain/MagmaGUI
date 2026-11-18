"""Purple teaming (VECTR-style): assessments, campaigns, test cases, red/blue sides, detections,
verification of linked rules, evidence, trends and exports."""

from datetime import date

import pytest

from app import purple as pt


def new_assessment(client, name="Q4 purple team", **extra) -> dict:
    r = client.post("/api/purple/assessments", json={"name": name} | extra)
    assert r.status_code == 201, r.text
    return r.json()


def new_campaign(client, a: dict, name="Credential access", **extra) -> dict:
    r = client.post(f"/api/purple/assessments/{a['id']}/campaigns", json={"name": name} | extra)
    assert r.status_code == 201, r.text
    return r.json()["campaign_list"][-1]


def new_case(client, campaign_id: int, name="Password spraying", techniques=("T1110.003",)):
    body = {"plan": {"name": name, "techniques": list(techniques), "command": "spray.ps1"}}
    r = client.post(f"/api/purple/campaigns/{campaign_id}/test-cases", json=body)
    assert r.status_code == 201, r.text
    return client.get(f"/api/purple/test-cases/{r.json()['created'][0]}").json()


def red(client, t: dict, expect=200, **changes) -> dict:
    body = {
        "expected_version": t["red_version"],
        "red_status": t["red_status"],
        "red_assignee": t["red_assignee"],
        "attack_start": t["attack_start"],
        "attack_stop": t["attack_stop"],
        "targets": t["targets"],
        "sources": t["sources"],
        "red_tools": t["red_tools"],
        "red_notes": t["red_notes"],
    } | changes
    r = client.put(f"/api/purple/test-cases/{t['id']}/red", json=body)
    assert r.status_code == expect, r.text
    return r.json()


def blue(client, t: dict, expect=200, **changes) -> dict:
    body = {
        "expected_version": t["blue_version"],
        "blue_status": t["blue_status"],
        "blue_assignee": t["blue_assignee"],
        "blue_notes": t["blue_notes"],
        "detection_steps": t["detection_steps"],
        "prevention_steps": t["prevention_steps"],
        "outcome_override": t["outcome_override"],
        "detections": [
            {k: d[k] for k in ("id", "kind", "rule_code", "tool", "outcome", "expected")}
            for d in t["detection_list"]
        ],
    } | changes
    r = client.put(f"/api/purple/test-cases/{t['id']}/blue", json=body)
    assert r.status_code == expect, r.text
    return r.json()


def run(client, t: dict) -> dict:
    t = client.post(
        f"/api/purple/test-cases/{t['id']}/start", json={"expected_version": t["red_version"]}
    ).json()
    r = client.post(
        f"/api/purple/test-cases/{t['id']}/stop", json={"expected_version": t["red_version"]}
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def analyst(make_user):
    return make_user("analyst")


# ---------------------------------------------------------------- pure logic


def test_outcome_priority_and_override():
    assert pt.derive_outcome([]) == "tbd"
    assert pt.derive_outcome(["none", "logged_local"]) == "logged_local"
    assert pt.derive_outcome(["logged_central", "alerted", "none"]) == "alerted"
    assert pt.derive_outcome(["alerted", "blocked"]) == "blocked"
    assert pt.derive_outcome(["not_applicable", "tbd"]) == "not_applicable"
    assert pt.derive_outcome(["blocked"], "none") == "none"


def test_metrics_count_only_executed_tests_with_a_result():
    cases = [
        pt.CaseInput("blocked", "executed", "done"),
        pt.CaseInput("alerted", "executed", "done"),
        pt.CaseInput("logged_central", "executed", "in_review"),
        pt.CaseInput("none", "executed", "done"),
        pt.CaseInput("tbd", "executed", "in_review"),  # no result yet
        pt.CaseInput("tbd", "planned", "waiting"),
        pt.CaseInput("tbd", "not_executed", "waiting"),
    ]
    m = pt.metrics(cases)
    assert (m.total, m.executed, m.not_executed, m.blue_done) == (7, 5, 1, 3)
    assert m.defense_success == 0.5
    assert m.visibility == 0.75


def test_trend():
    assert pt.trend([]) == "untested"
    assert pt.trend(["none"]) == "new"
    assert pt.trend(["none", "alerted"]) == "improved"
    assert pt.trend(["blocked", "tbd", "logged_local"]) == "regressed"
    assert pt.trend(["alerted", "alerted"]) == "unchanged"


def test_suggest_rules_match_sub_techniques_both_ways():
    rules = [
        pt.RuleCandidate(1, "AO-BRU-01", "Brute force", "operational", ["T1110"]),
        pt.RuleCandidate(2, "XX-01", "Other", "operational", ["T1059"]),
        pt.RuleCandidate(3, "YY-01", "Spray", "retired", ["T1110.003"]),
    ]
    assert [r["code"] for r in pt.suggest_rules(["T1110.003"], rules)] == ["AO-BRU-01", "YY-01"]
    assert [r["code"] for r in pt.suggest_rules(["T1110"], rules)] == ["AO-BRU-01", "YY-01"]


# ---------------------------------------------------------------- API


def test_assessment_campaign_test_case_flow(admin):
    a = new_assessment(admin, environment="Production", start_date=str(date.today()))
    c = new_campaign(admin, a)
    t = new_case(admin, c["id"])
    assert t["lineage_key"].startswith("tc:")
    assert t["red_status"] == "planned" and t["blue_status"] == "waiting"
    assert t["outcome"] == "tbd"
    # unknown technique
    r = admin.post(
        f"/api/purple/campaigns/{c['id']}/test-cases",
        json={"plan": {"name": "x", "techniques": ["T9999"]}},
    )
    assert r.status_code == 422

    t = run(admin, t)
    assert t["red_status"] == "executed" and t["attack_start"] and t["attack_stop"]
    assert t["blue_status"] == "in_review"  # handed to the blue team

    t = blue(
        admin,
        t,
        blue_status="done",
        blue_notes="Spraying seen only in the DC logs; no alert. **Fix**: add a rule.",
        detections=[
            {"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "logged_central"},
            {"kind": "tool", "tool": "Microsoft Defender for Identity", "outcome": "alerted"},
        ],
    )
    assert t["outcome"] == "alerted"
    assert t["derived_outcome"] == "alerted"
    assert [d["rule_code"] or d["tool"] for d in t["detection_list"]] == [
        "AO-BRU-01",
        "Microsoft Defender for Identity",
    ]
    detail = admin.get(f"/api/purple/assessments/{a['id']}").json()
    assert detail["metrics"]["executed"] == 1
    assert detail["metrics"]["defense_success"] == 1.0
    assert detail["heatmap"] == {"T1110.003": "alerted"}
    assert detail["campaign_list"][0]["test_cases"][0]["has_findings"] is True


def test_override_outcome(admin):
    t = new_case(admin, new_campaign(admin, new_assessment(admin))["id"])
    t = run(admin, t)
    t = blue(
        admin,
        t,
        detections=[{"kind": "tool", "tool": "EDR", "outcome": "blocked"}],
        outcome_override="none",
    )
    assert t["outcome"] == "none" and t["derived_outcome"] == "blocked" and t["overridden"]


def test_red_and_blue_have_separate_versions(admin, analyst):
    t = new_case(admin, new_campaign(admin, new_assessment(admin))["id"])
    # red and blue change the same test at the same time: both saves pass
    r1 = red(
        admin, t, red_notes="ran it", red_status="executed", attack_start="2026-11-18T10:00:00Z"
    )
    b1 = blue(analyst, t, blue_notes="looking")
    assert r1["red_version"] == 2 and b1["blue_version"] == 2
    # a stale save of the same side is refused
    r = admin.put(
        f"/api/purple/test-cases/{t['id']}/red",
        json={"expected_version": 1, "red_status": "planned"},
    )
    assert r.status_code == 409
    blue(analyst, t, expect=409, blue_notes="stale")


def test_red_validation(admin):
    t = new_case(admin, new_campaign(admin, new_assessment(admin))["id"])
    red(admin, t, expect=422, red_status="executed")  # no start time
    red(
        admin,
        t,
        expect=422,
        attack_start="2026-11-18T10:00:00Z",
        attack_stop="2026-11-18T09:00:00Z",
    )
    blue(admin, t, expect=422, detections=[{"kind": "rule", "rule_code": "NO-SUCH-01"}])
    blue(admin, t, expect=422, detections=[{"kind": "tool", "tool": ""}])


def test_done_records_verification_of_linked_rules(admin):
    t = run(admin, new_case(admin, new_campaign(admin, new_assessment(admin))["id"]))
    t = blue(
        admin,
        t,
        blue_status="done",
        detections=[
            {"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "alerted"},
            {"kind": "rule", "rule_code": "AO-ACC-01", "outcome": "none"},
            {"kind": "rule", "rule_code": "AO-ACC-02", "outcome": "tbd"},  # no result: skipped
        ],
    )
    verified = {v["rule"]: v["result"] for v in t["verified"]}
    assert verified == {"AO-BRU-01": "ok", "AO-ACC-01": "issues"}
    hist = admin.get("/api/l3/AO-BRU-01/verifications").json()
    assert hist[0]["result"] == "ok" and hist[0]["note"].startswith("Purple team:")
    assert admin.get("/api/l3/AO-BRU-01").json()["last_verified_at"] == str(date.today())
    assert admin.get("/api/l3/AO-ACC-01").json()["last_verified_at"] is None
    # saving again while done does not verify twice
    again = blue(admin, t, blue_notes="more notes")
    assert again["verified"] == []
    # the rule shows the test; Priorities shows the last result
    tests = admin.get("/api/purple/rules/AO-BRU-01/tests").json()
    assert tests[0]["outcome"] == "alerted" and tests[0]["test_case_id"] == t["id"]
    rows = {r["code"]: r for r in admin.get("/api/growth/gaps").json()["rows"]}
    if "AO-ACC-01" in rows:
        assert rows["AO-ACC-01"]["last_test_outcome"] == "none"


def test_no_verification_when_switched_off(admin):
    t = run(admin, new_case(admin, new_campaign(admin, new_assessment(admin))["id"]))
    t = blue(
        admin,
        t,
        blue_status="done",
        record_verification=False,
        detections=[{"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "alerted"}],
    )
    assert t["verified"] == []
    assert admin.get("/api/l3/AO-BRU-01/verifications").json() == []


def test_detection_keeps_rule_code_after_rule_deleted(admin):
    t = new_case(admin, new_campaign(admin, new_assessment(admin))["id"])
    t = blue(admin, t, detections=[{"kind": "rule", "rule_code": "AO-COL-01", "outcome": "none"}])
    assert admin.delete("/api/l3/AO-COL-01").status_code == 204
    t = admin.get(f"/api/purple/test-cases/{t['id']}").json()
    d = t["detection_list"][0]
    assert d["rule_code"] == "AO-COL-01" and d["rule_missing"] is True
    # the test can still be saved with the deleted rule in it
    blue(admin, t, blue_notes="rule gone")


def test_roles(admin, make_user):
    a = new_assessment(admin)
    c = new_campaign(admin, a)
    t = new_case(admin, c["id"])
    auditor = make_user("auditor")
    analyst = make_user("analyst")
    assert auditor.get(f"/api/purple/assessments/{a['id']}").status_code == 200
    assert auditor.get(f"/api/purple/test-cases/{t['id']}").status_code == 200
    writes = [
        ("post", "/api/purple/assessments", {"name": "x"}),
        ("put", f"/api/purple/assessments/{a['id']}", {"name": "x", "expected_version": 1}),
        ("delete", f"/api/purple/assessments/{a['id']}", None),
        ("post", f"/api/purple/assessments/{a['id']}/rerun", {}),
        ("post", f"/api/purple/assessments/{a['id']}/campaigns", {"name": "x"}),
        ("put", f"/api/purple/campaigns/{c['id']}", {"name": "x"}),
        ("delete", f"/api/purple/campaigns/{c['id']}", None),
        ("post", f"/api/purple/campaigns/{c['id']}/test-cases", {"plan": {"name": "x"}}),
        ("put", f"/api/purple/test-cases/{t['id']}", {"name": "x", "expected_version": 1}),
        (
            "put",
            f"/api/purple/test-cases/{t['id']}/red",
            {"expected_version": 1, "red_status": "planned"},
        ),
        (
            "put",
            f"/api/purple/test-cases/{t['id']}/blue",
            {"expected_version": 1, "blue_status": "waiting"},
        ),
        ("post", f"/api/purple/test-cases/{t['id']}/start", {"expected_version": 1}),
        ("post", f"/api/purple/test-cases/{t['id']}/stop", {"expected_version": 1}),
        ("delete", f"/api/purple/test-cases/{t['id']}", None),
        ("post", "/api/purple/templates", {"name": "x"}),
        ("post", "/api/purple/campaign-templates", {"name": "x"}),
    ]
    for method, url, body in writes:
        kw = {"json": body} if body is not None else {}
        assert getattr(auditor, method)(url, **kw).status_code == 403, url
    files = {"file": ("a.txt", b"hello", "text/plain")}
    assert (
        auditor.post(f"/api/purple/test-cases/{t['id']}/attachments", files=files).status_code
        == 403
    )
    # the analyst may edit
    assert red(analyst, t, red_notes="analyst")["red_notes"] == "analyst"


def test_audit_records_old_and_new_values(admin):
    t = new_case(admin, new_campaign(admin, new_assessment(admin, name="Audited"))["id"])
    blue(admin, t, blue_notes="first finding")
    log = admin.get("/api/audit?limit=20").json()
    items = log["items"] if isinstance(log, dict) else log
    entry = next(e for e in items if e["action"] == "update_blue")
    assert entry["entity"] == "pt_test_case"
    assert entry["entity_key"] == "Audited / Password spraying"
    assert entry["changes"]["blue_notes"] == ["", "first finding"]


def test_rerun_keeps_lineage_and_shows_trend(admin):
    a = new_assessment(admin, name="Run 1", start_date="2026-10-01")
    c = new_campaign(admin, a)
    t = run(admin, new_case(admin, c["id"]))
    blue(admin, t, detections=[{"kind": "tool", "tool": "SIEM", "outcome": "alerted"}])
    r = admin.post(f"/api/purple/assessments/{a['id']}/rerun", json={"name": "Run 2"})
    assert r.status_code == 201, r.text
    a2 = r.json()
    assert a2["previous_id"] == a["id"]
    t2_row = a2["campaign_list"][0]["test_cases"][0]
    t2 = admin.get(f"/api/purple/test-cases/{t2_row['id']}").json()
    assert t2["lineage_key"] == t["lineage_key"]
    assert t2["red_status"] == "planned" and t2["outcome"] == "tbd"
    # the defense checked last time is expected again, without a result
    assert [(d["tool"], d["expected"], d["outcome"]) for d in t2["detection_list"]] == [
        ("SIEM", True, "tbd")
    ]
    t2 = run(admin, t2)
    t2 = blue(admin, t2, detections=[{"kind": "tool", "tool": "SIEM", "outcome": "none"}])
    assert t2["trend"] == "regressed"
    assert [h["outcome"] for h in t2["history"]] == ["alerted", "none"]
    trends = admin.get("/api/purple/trends").json()
    assert trends["counts"]["regressed"] == 1
    assert trends["procedures"][0]["trend"] == "regressed"
    assert [x["name"] for x in trends["assessments"]] == ["Run 1", "Run 2"]


def test_queue(admin, analyst):
    c = new_campaign(admin, new_assessment(admin))
    t1 = new_case(admin, c["id"], name="Mine to run")
    red(admin, t1, red_assignee="admin")
    t2 = run(analyst, new_case(admin, c["id"], name="Nobody reviews"))
    q = {r["name"]: r["side"] for r in admin.get("/api/purple/queue").json()}
    assert q == {"Mine to run": "red", "Nobody reviews": "blue_unassigned"}
    blue(admin, t2, blue_assignee="analyst1")
    q = {r["name"]: r["side"] for r in analyst.get("/api/purple/queue").json()}
    assert q == {"Nobody reviews": "blue"}


def test_evidence(admin, settings):
    t = new_case(admin, new_campaign(admin, new_assessment(admin))["id"])
    url = f"/api/purple/test-cases/{t['id']}/attachments"
    r = admin.post(
        url + "?side=blue", files={"file": ("alert.png", b"\x89PNG\r\n\x1a\n...", "image/png")}
    )
    assert r.status_code == 201, r.text
    png = r.json()
    assert png["viewable"] and png["side"] == "blue"
    r = admin.post(url, files={"file": ("events.log", b"4625 failed logon\n", "text/plain")})
    assert r.status_code == 201 and not r.json()["viewable"]
    # wrong content for the extension, unknown types
    assert admin.post(url, files={"file": ("x.png", b"not a png", "image/png")}).status_code == 422
    assert admin.post(url, files={"file": ("x.exe", b"MZ", "application/x")}).status_code == 422
    assert (
        admin.post(url, files={"file": ("bin.log", b"\x00\x01\x02", "text/plain")}).status_code
        == 422
    )
    content = admin.get(f"/api/purple/attachments/{png['id']}/content")
    assert (
        content.status_code == 200
        and "default-src 'none'" in content.headers["content-security-policy"]
    )
    # all evidence counts against one limit
    storage = admin.get("/api/evidence/storage").json()
    assert storage["files"] == 2
    t = admin.get(f"/api/purple/test-cases/{t['id']}").json()
    assert len(t["attachments"]) == 2
    assert admin.delete(f"/api/purple/attachments/{png['id']}").status_code == 204


def test_exports(admin):
    a = new_assessment(admin, name="Export me", summary="**Overall** good")
    c = new_campaign(admin, a)
    t = run(admin, new_case(admin, c["id"], name="=cmd|' /C calc'!A0"))
    blue(
        admin,
        t,
        blue_notes="Finding: no alert",
        detections=[{"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "none"}],
    )
    pdf = admin.get(f"/api/purple/assessments/{a['id']}/report.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    for lang in ("de", "nl"):
        assert (
            admin.get(f"/api/purple/assessments/{a['id']}/report.pdf?lang={lang}").status_code
            == 200
        )
    nav = admin.get(f"/api/purple/assessments/{a['id']}/navigator.json")
    assert nav.status_code == 200
    layer = nav.json()
    assert layer["domain"] == "enterprise-attack"
    assert layer["techniques"][0]["techniqueID"] == "T1110.003"
    csv = admin.get(f"/api/purple/assessments/{a['id']}/export.csv")
    assert csv.status_code == 200
    assert "'=cmd" in csv.text  # no formula injection
    assert "AO-BRU-01: none" in csv.text


def test_delete_assessment_cascades(admin):
    a = new_assessment(admin)
    t = new_case(admin, new_campaign(admin, a)["id"])
    admin.post(
        f"/api/purple/test-cases/{t['id']}/attachments",
        files={"file": ("n.txt", b"note", "text/plain")},
    )
    assert admin.delete(f"/api/purple/assessments/{a['id']}").status_code == 204
    assert admin.get(f"/api/purple/test-cases/{t['id']}").status_code == 404
    assert admin.get("/api/evidence/storage").json()["files"] == 0


def test_assessment_update_and_version(admin):
    a = new_assessment(admin)
    body = {"name": "Renamed", "status": "in_progress", "summary": "x", "expected_version": 1}
    r = admin.put(f"/api/purple/assessments/{a['id']}", json=body)
    assert r.status_code == 200 and r.json()["version"] == 2
    assert admin.put(f"/api/purple/assessments/{a['id']}", json=body).status_code == 409
    bad = {"name": "x", "expected_version": 2, "start_date": "2026-11-02", "end_date": "2026-11-01"}
    assert admin.put(f"/api/purple/assessments/{a['id']}", json=bad).status_code == 422


def test_first_attack_starts_the_assessment(admin):
    a = new_assessment(admin)
    assert a["status"] == "planned"
    t = new_case(admin, new_campaign(admin, a)["id"])
    admin.post(f"/api/purple/test-cases/{t['id']}/start", json={"expected_version": 1})
    a = admin.get(f"/api/purple/assessments/{a['id']}").json()
    assert a["status"] == "in_progress" and a["version"] == 2


def test_procedure_in_two_campaign_templates_is_added_once(admin):
    tpl = admin.post(
        "/api/purple/templates", json={"name": "Shared", "techniques": ["T1003"]}
    ).json()
    other = admin.post("/api/purple/templates", json={"name": "Other"}).json()
    ct1 = admin.post(
        "/api/purple/campaign-templates", json={"name": "One", "template_ids": [tpl["id"]]}
    ).json()
    ct2 = admin.post(
        "/api/purple/campaign-templates",
        json={"name": "Two", "template_ids": [tpl["id"], other["id"]]},
    ).json()
    r = admin.post(
        "/api/purple/assessments",
        json={"name": "x", "campaign_template_ids": [ct1["id"], ct2["id"]]},
    )
    names = [[t["name"] for t in c["test_cases"]] for c in r.json()["campaign_list"]]
    assert names == [["Shared"], ["Other"]]
