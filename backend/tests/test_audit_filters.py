"""Audit log filters for auditors: user, action, object key search and date range, plus the
facets that fill the filter lists (design critique 2026-11-21)."""

from datetime import date, timedelta


def test_audit_filters(admin, make_user):
    analyst = make_user("analyst", "jana")
    auditor = make_user("auditor", "otto")
    assert analyst.patch("/api/l3/AO-CRE-01", json={"comments": "tuned"}).status_code == 200
    assert admin.patch("/api/l3/AO-CRE-02", json={"comments": "checked"}).status_code == 200

    by_jana = auditor.get("/api/audit?user=jana").json()
    assert by_jana and all(e["username"] == "jana" for e in by_jana)
    assert any(e["entity_key"] == "AO-CRE-01" for e in by_jana)

    hits = auditor.get("/api/audit?search=cre-02").json()
    assert hits and all("AO-CRE-02" in e["entity_key"] for e in hits)

    updates = auditor.get("/api/audit?action=update&entity=l3").json()
    assert {e["entity_key"] for e in updates} >= {"AO-CRE-01", "AO-CRE-02"}

    today = date.today()
    week = f"since={today - timedelta(days=1)}&until={today + timedelta(days=1)}"
    assert auditor.get(f"/api/audit?{week}").json()
    assert auditor.get(f"/api/audit?until={today - timedelta(days=2)}").json() == []

    facets = auditor.get("/api/audit/facets").json()
    assert "jana" in facets["users"] and "update" in facets["actions"]
    assert "l3" in facets["entities"]
    assert analyst.get("/api/audit/facets").status_code == 403


def test_audit_search_is_literal(admin):
    # LIKE wildcards in the search are matched literally, not as patterns
    assert admin.get("/api/audit?search=%25").json() == []
