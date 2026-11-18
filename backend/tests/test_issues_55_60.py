"""Issues #57 (take a use case off a single risk) and #59 (gaps of the threat model overview)."""

import pytest

from tests.test_interviews import complete, component, l2_id, new_system, save, start, threat

WEB_SPOOF = {"component": "web", "category": "spoofing"}
DB_SPOOF = {"component": "db", "category": "spoofing"}


@pytest.fixture
def analyst(make_user):
    return make_user("analyst")


@pytest.fixture(autouse=True)
def no_log_source_filter(admin):
    r = admin.put("/api/stride-mapping/log-source-filter", json={"enabled": False})
    assert r.status_code == 200, r.text


def risk(view: dict, comp: str, cat: str) -> dict:
    return next(r for r in view["risks"] if (r["component"], r["category"]) == (comp, cat))


def two_components():
    return [
        component("web", threats=[threat("spoofing")]),
        component("db", "Database", threats=[threat("spoofing")]),
    ]


def test_proposed_l2_can_be_taken_off_one_risk(analyst):
    s = new_system(analyst)
    acc = l2_id(analyst, "AO-ACC")
    iv = save(analyst, start(analyst, s["id"]), components=two_components())
    web = risk(iv["view"], "web", "spoofing")
    u = next(u for u in web["use_cases"] if u["code"] == "AO-ACC")
    assert u["auto"] is True

    iv = save(analyst, iv, removed=[{"l2_id": acc, "reason": "no web login", "threats": [WEB_SPOOF]}])
    v = iv["view"]
    assert "AO-ACC" not in [u["code"] for u in risk(v, "web", "spoofing")["use_cases"]]
    # still accepted for the other risk
    assert "AO-ACC" in [u["code"] for u in risk(v, "db", "spoofing")["use_cases"]]
    p = next(p for p in v["proposals"] if p["code"] == "AO-ACC")
    assert [(x["component"], x["category"]) for x in p["sources"]] == [("db", "spoofing")]
    # listed as removed from that risk, but not as a removed use case
    (r,) = [r for r in v["removed"] if r["code"] == "AO-ACC"]
    assert r["reason"] == "no web login"
    assert [(x["component"], x["category"]) for x in r["threats"]] == [("web", "spoofing")]
    assert acc not in v["removed_ids"]

    # completing links AO-ACC only through the db risk
    complete(analyst, iv)
    d = analyst.get(f"/api/systems/{s['id']}").json()
    link = next(x for x in d["links"] if x["code"] == "AO-ACC")
    assert [x["component"] for x in link["sources"]] == ["Database"]


def test_removing_from_every_risk_drops_the_proposal(analyst):
    s = new_system(analyst)
    acc = l2_id(analyst, "AO-ACC")
    iv = save(
        analyst,
        start(analyst, s["id"]),
        components=two_components(),
        removed=[{"l2_id": acc, "reason": "", "threats": [WEB_SPOOF, DB_SPOOF]}],
    )
    v = iv["view"]
    assert "AO-ACC" not in [p["code"] for p in v["proposals"]]
    assert [r["code"] for r in v["removed"]].count("AO-ACC") == 1


def test_removal_of_a_threat_that_no_longer_applies_is_dropped(analyst):
    s = new_system(analyst)
    acc = l2_id(analyst, "AO-ACC")
    iv = save(
        analyst,
        start(analyst, s["id"]),
        components=two_components(),
        removed=[{"l2_id": acc, "reason": "", "threats": [WEB_SPOOF]}],
    )
    comps = [
        component("web", threats=[threat("spoofing", state="does_not_apply")]),
        component("db", "Database", threats=[threat("spoofing")]),
    ]
    iv = save(analyst, iv, components=comps)
    v = iv["view"]
    # not turned into a removal of the whole use case
    assert v["removed"] == [] or all(r["code"] != "AO-ACC" for r in v["removed"])
    assert "AO-ACC" in [p["code"] for p in v["proposals"]]


def test_hand_picked_use_case_is_not_flagged_auto(analyst):
    s = new_system(analyst)
    dbc = l2_id(analyst, "AO-DBC")
    iv = save(
        analyst,
        start(analyst, s["id"]),
        components=[component(threats=[threat("spoofing")])],
        added=[{"l2_id": dbc, "threats": [WEB_SPOOF]}],
    )
    u = next(u for u in risk(iv["view"], "web", "spoofing")["use_cases"] if u["code"] == "AO-DBC")
    assert (u["auto"], u["manual"]) == (False, True)
    # dropping the hand pick removes it from the risk
    iv = save(analyst, iv, added=[])
    assert "AO-DBC" not in [u["code"] for u in risk(iv["view"], "web", "spoofing")["use_cases"]]


def test_risk_without_use_case_is_a_system_gap(analyst):
    """#59: a risk the "Gap" filter shows is also listed under Gaps and counted."""
    s = new_system(analyst)
    cats = analyst.get("/api/stride-mapping").json()["categories"]
    every = sorted({x["l2_id"] for c in cats for x in c["l2s"]})
    iv = save(
        analyst,
        start(analyst, s["id"]),
        components=[component(threats=[threat("spoofing"), threat("tampering", likelihood=1)])],
        removed=[{"l2_id": i, "reason": ""} for i in every],
    )
    complete(analyst, iv)
    d = analyst.get(f"/api/systems/{s['id']}").json()
    gap_risks = [r for r in d["risks"] if r["coverage"] == "gap"]
    assert [(r["component"], r["category"]) for r in gap_risks] == [("web", "spoofing")]
    assert [(g["component"], g["category"], g["score"]) for g in d["gap_risks"]] == [
        ("web", "spoofing", 12)
    ]
    # tampering (score 4) is below the threshold: accepted, not a gap
    assert d["gaps"] == 1
    row = next(x for x in analyst.get("/api/systems").json() if x["id"] == s["id"])
    assert row["gaps"] == 1
