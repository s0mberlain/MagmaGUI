"""Purple teaming quick tests: one test of a detection or a script, result and finding recorded
in a single step (app/api/purple_quick.py)."""

from datetime import date

from tests.test_purple import new_assessment, new_campaign, new_case, run

QT = "/api/purple/quick-tests"


def quick(client, expect=201, **body) -> dict:
    r = client.post(QT, json={"name": "LSASS dump with ProcDump"} | body)
    assert r.status_code == expect, r.text
    return r.json()


def test_empty_list(admin):
    r = admin.get(QT).json()
    assert r == {"assessment_id": None, "metrics": r["metrics"], "tests": []}
    assert r["metrics"]["total"] == 0


def test_quick_test_records_result_and_finding_in_one_step(admin):
    t = quick(
        admin,
        techniques=["t1003.001"],
        executor="command_prompt",
        command="procdump.exe -ma lsass.exe out.dmp",
        targets=["WS-LAB-07"],
        detections=[
            {"kind": "tool", "tool": "EDR", "outcome": "alerted", "alert_name": "LSASS access"},
            {"kind": "rule", "rule_code": "ao-bru-01", "outcome": "none", "expected": True},
        ],
        blue_notes="EDR alerted, the SIEM rule did not fire.",
    )
    assert t["techniques"] == ["T1003.001"]
    assert t["red_status"] == "executed" and t["blue_status"] == "done"
    assert t["attack_start"] and t["attack_start"] == t["attack_stop"]
    assert t["red_assignee"] == "admin" and t["blue_assignee"] == "admin"
    assert t["outcome"] == "alerted"
    assert t["has_findings"] is True
    assert t["assessment_kind"] == "quick" and t["tags"] == ["quick"]
    assert [d["rule_code"] or d["tool"] for d in t["detection_list"]] == ["EDR", "AO-BRU-01"]
    # done: the linked rule got a verification with the result
    assert [(v["rule"], v["result"]) for v in t["verified"]] == [("AO-BRU-01", "issues")]
    hist = admin.get("/api/l3/AO-BRU-01/verifications").json()
    assert hist and hist[0]["result"] == "issues" and "Quick tests" in hist[0]["note"]

    listed = admin.get(QT).json()
    assert listed["assessment_id"] == t["assessment_id"]
    row = listed["tests"][0]
    assert row["id"] == t["id"] and row["command"].startswith("procdump")
    assert row["defenses"] == [
        {"kind": "tool", "name": "EDR", "outcome": "alerted"},
        {"kind": "rule", "name": "AO-BRU-01", "outcome": "none"},
    ]
    assert listed["metrics"]["executed"] == 1
    # the rule page shows the result
    tests = admin.get("/api/purple/rules/AO-BRU-01/tests").json()
    assert tests[0]["test_case_id"] == t["id"] and tests[0]["outcome"] == "none"


def test_quick_tests_share_one_hidden_container(admin):
    a = new_assessment(admin, name="Real exercise")
    one = quick(admin, name="First")
    two = quick(admin, name="Second", executed_at="2026-01-05T10:00:00Z")
    assert one["assessment_id"] == two["assessment_id"]
    assert one["campaign_id"] == two["campaign_id"]
    # not with the assessments, not in the trends
    assert [x["id"] for x in admin.get("/api/purple/assessments").json()] == [a["id"]]
    trends = admin.get("/api/purple/trends").json()
    assert [x["assessment_id"] for x in trends["assessments"]] == [a["id"]]
    assert trends["procedures"] == []
    # newest first
    assert [x["name"] for x in admin.get(QT).json()["tests"]] == ["First", "Second"]
    # the container cannot be deleted or re-run, single quick tests can be deleted
    cid = one["assessment_id"]
    assert admin.delete(f"/api/purple/assessments/{cid}").status_code == 409
    assert admin.post(f"/api/purple/assessments/{cid}/rerun", json={}).status_code == 409
    assert admin.delete(f"/api/purple/test-cases/{one['id']}").status_code == 204
    assert [x["name"] for x in admin.get(QT).json()["tests"]] == ["Second"]


def test_not_done_stays_in_review_without_verification(admin):
    t = quick(
        admin,
        done=False,
        detections=[{"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "alerted"}],
    )
    assert t["blue_status"] == "in_review" and t["verified"] == []
    assert admin.get("/api/l3/AO-BRU-01/verifications").json() == []
    # the ordinary blue side save finishes it
    body = {
        "expected_version": t["blue_version"],
        "blue_status": "done",
        "detections": [{"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "alerted"}],
    }
    r = admin.put(f"/api/purple/test-cases/{t['id']}/blue", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["verified"][0]["result"] == "ok"


def test_verification_can_be_switched_off(admin):
    t = quick(
        admin,
        record_verification=False,
        detections=[{"kind": "rule", "rule_code": "AO-BRU-01", "outcome": "alerted"}],
    )
    assert t["verified"] == [] and t["blue_status"] == "done"
    assert admin.get("/api/l3/AO-BRU-01/verifications").json() == []


def test_from_library_procedure_joins_its_runs(admin):
    tpl = admin.post(
        "/api/purple/templates",
        json={"name": "Password spraying", "techniques": ["T1110.003"], "cleanup": "reset"},
    ).json()
    c = new_campaign(admin, new_assessment(admin))
    body = {"template_ids": [tpl["id"]]}
    r = admin.post(f"/api/purple/campaigns/{c['id']}/test-cases", json=body)
    planned = admin.get(f"/api/purple/test-cases/{r.json()['created'][0]}").json()
    run(admin, planned)
    t = quick(
        admin,
        name="Password spraying",
        template_id=tpl["id"],
        techniques=["T1110.003"],
        detections=[{"kind": "tool", "tool": "DC logs", "outcome": "logged_central"}],
    )
    assert t["template_id"] == tpl["id"] and t["lineage_key"] == f"tpl:{tpl['id']}"
    assert t["cleanup"] == "reset"
    assert len(t["history"]) == 2 and t["history"][-1]["current"] is True
    assert quick(admin, template_id=99999, expect=422)


def test_validation(admin):
    quick(admin, name="", expect=422)
    quick(admin, techniques=["T9999"], expect=422)
    quick(admin, detections=[{"kind": "rule", "rule_code": "NO-SUCH-01"}], expect=422)
    quick(admin, detections=[{"kind": "tool", "tool": ""}], expect=422)
    assert admin.get(QT).json()["tests"] == []


def test_roles_and_audit(admin, make_user):
    auditor = make_user("auditor")
    analyst = make_user("analyst")
    assert auditor.get(QT).status_code == 200
    assert auditor.post(QT, json={"name": "x"}).status_code == 403
    t = quick(analyst, name="By the analyst", blue_notes="finding text")
    assert t["red_assignee"] == "analyst1"
    log = admin.get("/api/audit?limit=20").json()
    items = log["items"] if isinstance(log, dict) else log
    entry = next(e for e in items if e["action"] == "create" and e["entity"] == "pt_quick_test")
    assert entry["entity_key"] == "Quick tests / By the analyst"
    assert entry["changes"]["finding"] == "finding text"


def test_ordinary_assessments_unchanged(admin):
    """Quick tests do not touch the assessments: their list, metrics and trends stay the same."""
    a = new_assessment(admin, name="Exercise", start_date=str(date.today()))
    t = run(admin, new_case(admin, new_campaign(admin, a)["id"]))
    before = admin.get("/api/purple/assessments").json()
    trends_before = admin.get("/api/purple/trends").json()
    quick(admin, detections=[{"kind": "tool", "tool": "EDR", "outcome": "blocked"}])
    after = admin.get("/api/purple/assessments").json()
    assert [(x["id"], x["metrics"]) for x in after] == [(x["id"], x["metrics"]) for x in before]
    assert admin.get("/api/purple/trends").json() == trends_before
    assert admin.get(f"/api/purple/test-cases/{t['id']}").json()["assessment_kind"] == "assessment"
