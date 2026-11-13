from datetime import UTC, datetime

from app import snapshots


def test_snapshot_trend_and_compare(admin, make_user):
    analyst = make_user("analyst")
    auditor = make_user("auditor")
    assert auditor.post("/api/snapshots", json={"label": "x"}).status_code == 403
    r = analyst.post("/api/snapshots", json={"label": "Baseline"})
    assert r.status_code == 201
    first = r.json()
    assert first["kpis"]["rules"] > 0 and first["kpis"]["soc_detection_score"] is None

    admin.patch(
        "/api/l3/AO-CRE-01",
        json={
            "effectiveness": 0.9,
            "implementation": 0.8,
            "coverage": 0.5,
            "lifecycle_status": "operational",
        },
    )
    t = auditor.get("/api/trends").json()
    assert t["schedule"] == "off"
    assert [p["kind"] for p in t["points"]] == ["manual", "live"]
    assert t["points"][1]["lifecycle_changes"] == 1
    assert abs(t["points"][1]["kpis"]["soc_detection_score"] - 0.36) < 1e-9
    assert {m["key"] for m in t["metrics"]} >= {"soc_detection_score", "log_sources_used"}

    c = auditor.get(f"/api/snapshots/compare?a={first['id']}&b=live").json()
    assert c["kpis"]["soc_detection_score"] == {"a": None, "b": 0.36}
    rule = next(x for x in c["rules"] if x["code"] == "AO-CRE-01")
    assert rule["change"] == "changed" and rule["b"]["status"] == "operational"
    assert [x["code"] for x in c["l1"]] == ["AO"]

    full = auditor.get(f"/api/snapshots/{first['id']}").json()
    assert "AO-CRE-01" in full["data"]["rules"]
    assert auditor.delete(f"/api/snapshots/{first['id']}").status_code == 403
    assert admin.delete(f"/api/snapshots/{first['id']}").status_code == 204
    assert admin.get("/api/snapshots").json() == []
    assert admin.get("/api/snapshots/999").status_code == 404


def test_schedule_due(app, admin):
    factory = app.state.sessionmaker
    with factory() as db:
        assert snapshots.due(db, "monthly") and not snapshots.due(db, "off")
    assert snapshots.run_scheduled(factory, "monthly", 180)
    assert not snapshots.run_scheduled(factory, "monthly", 180)
    with factory() as db:
        assert not snapshots.due(db, "daily")
        later = datetime(2099, 1, 1, tzinfo=UTC)
        assert snapshots.due(db, "weekly", later) and snapshots.due(db, "monthly", later)
    assert admin.get("/api/snapshots").json()[0]["kind"] == "scheduled"


def test_demo_history(admin):
    counts = admin.post("/api/admin/demo-data", json={"seed": 7}).json()
    assert counts["snapshots"] == 12 and counts["lifecycle_events"] > counts["rules"]
    pts = admin.get("/api/trends").json()["points"]
    assert len(pts) == 13
    scores = [p["kpis"]["soc_detection_score"] for p in pts]
    assert scores[0] < scores[-1]
    # re-running replaces the demo history instead of adding to it
    admin.post("/api/admin/demo-data", json={"seed": 7})
    assert len(admin.get("/api/snapshots").json()) == 12
