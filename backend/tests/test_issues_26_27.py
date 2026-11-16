"""Issue #26 (new reference entries from the rule form) and #27 (onboarding date)."""

from datetime import date


def test_new_rule_is_onboarded_today_by_default(admin):
    r = admin.post("/api/l3", json={"code": "AO-CRE-90", "name": "New"})
    assert r.status_code == 201, r.text
    assert r.json()["onboarded_at"] == date.today().isoformat()
    r = admin.post(
        "/api/l3", json={"code": "AO-CRE-91", "name": "Older", "onboarded_at": "2026-01-05"}
    )
    assert r.json()["onboarded_at"] == "2026-01-05"
    r = admin.post("/api/l3", json={"code": "AO-CRE-92", "name": "None", "onboarded_at": None})
    assert r.json()["onboarded_at"] is None


def test_analyst_can_add_reference_entry_and_use_it(admin, make_user):
    """The rule form adds a log source through the reference list API, then saves the rule."""
    analyst = make_user("analyst")
    r = analyst.post("/api/references/log_source", json={"name": "Zeek DNS", "description": ""})
    assert r.status_code == 201, r.text
    r = analyst.patch("/api/l3/AO-CRE-01", json={"log_sources": ["Zeek DNS"]})
    assert r.status_code == 200 and r.json()["log_sources"] == ["Zeek DNS"]
    # auditors cannot add entries
    auditor = make_user("auditor")
    r = auditor.post("/api/references/scope", json={"name": "OT", "description": ""})
    assert r.status_code == 403
