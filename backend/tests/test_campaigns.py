"""Purple team campaigns, tests, test library and red team accounts (PROJ-3, issue #63)."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import login

PW = "red-team-password-123"


@pytest.fixture
def analyst(make_user):
    return make_user("analyst")


@pytest.fixture
def auditor(make_user):
    return make_user("auditor")


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


EXEC = datetime(2026, 11, 2, 10, 0, tzinfo=UTC)


@pytest.fixture
def rules(admin):
    """L2 PT-ACC with R1 (T1059.001, T1003), R2 (T1059.001), a rule without technique, a
    retired rule and one with the revoked T1086 / deprecated T1043."""
    assert admin.post("/api/l1", json={"code": "PT", "name": "Purple"}).status_code == 201
    r = admin.post("/api/l2", json={"code": "PT-ACC", "name": "Accounts"})
    assert r.status_code == 201, r.text
    assert admin.post("/api/l2", json={"code": "PT-OLD", "name": "Old"}).status_code == 201

    def rule(code, techniques, status="operational"):
        r = admin.post(
            "/api/l3",
            json={
                "code": code,
                "name": f"Rule {code}",
                "attack_techniques": techniques,
                "lifecycle_status": status,
                "log_sources": ["Application log"],
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    return {
        "l2": r.json(),
        "r1": rule("PT-ACC-01", ["T1059.001", "T1003"]),
        "r2": rule("PT-ACC-02", ["T1059.001"]),
        "r3": rule("PT-ACC-03", []),
        "retired": rule("PT-ACC-04", ["T1110"], "retired"),
        "old": rule("PT-OLD-01", ["T1086", "T1043"]),
    }


def new_campaign(client, name="Q1 Purple", **kw):
    body = {"name": name, "planned_start": "2026-12-01", "planned_end": "2026-12-12"} | kw
    r = client.post("/api/campaigns", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_test(client, cid, **kw):
    body = {"title": "PowerShell", "technique": "T1059.001"} | kw
    r = client.post(f"/api/campaigns/{cid}/tests", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def set_status(client, cid, action):
    return client.post(f"/api/campaigns/{cid}/status", json={"action": action})


def patch(client, test, **kw):
    r = client.patch(f"/api/campaign-tests/{test['id']}", json={"version": test["version"]} | kw)
    return r


def ok_patch(client, test, **kw):
    r = patch(client, test, **kw)
    assert r.status_code == 200, r.text
    return r.json()


def verifications(client, code):
    return client.get(f"/api/l3/{code}/verifications").json()


@pytest.fixture
def red_team(app, admin):
    """Make a red team account; returns (user json, signed-in client factory)."""
    clients = []

    def _make(username="red1"):
        r = admin.post(
            "/api/users", json={"username": username, "role": "red_team", "password": PW}
        )
        assert r.status_code == 201, r.text
        user = r.json()

        def sign_in():
            c = TestClient(app)
            clients.append(c)
            return login(c, username, PW)

        return user, sign_in

    yield _make
    for c in clients:
        c.close()


# ---------------------------------------------------------------- campaigns


def test_create_list_and_validation(analyst):
    c = new_campaign(analyst)
    assert c["status"] == "planned" and c["test_count"] == 0 and c["white_box"] is False
    listed = analyst.get("/api/campaigns").json()
    assert [(x["name"], x["status"], x["test_count"]) for x in listed] == [
        ("Q1 Purple", "planned", 0)
    ]
    # AK-2: duplicate name (also with other case)
    r = analyst.post(
        "/api/campaigns",
        json={"name": "q1 purple", "planned_start": "2026-12-01", "planned_end": "2026-12-12"},
    )
    assert r.status_code == 409
    # AK-3: end before start
    r = analyst.post(
        "/api/campaigns",
        json={"name": "Other", "planned_start": "2026-12-12", "planned_end": "2026-12-01"},
    )
    assert r.status_code == 422


def test_auditor_reads_but_cannot_write(analyst, auditor):
    c = new_campaign(analyst)
    assert auditor.get(f"/api/campaigns/{c['id']}").status_code == 200
    assert (
        auditor.post(
            "/api/campaigns",
            json={"name": "X", "planned_start": "2026-12-01", "planned_end": "2026-12-02"},
        ).status_code
        == 403
    )
    assert (
        auditor.post(
            f"/api/campaigns/{c['id']}/tests", json={"title": "x", "technique": "T1003"}
        ).status_code
        == 403
    )


def test_status_flow_and_close_check(analyst, rules):
    c = new_campaign(analyst)
    t1 = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    t2 = add_test(analyst, c["id"], title="Dump", technique="T1003")
    # results only while running (AK-27 for analysts too)
    assert patch(analyst, t1, exec_status="executed").status_code == 409
    assert set_status(analyst, c["id"], "start").json()["status"] == "running"  # AK-4

    # AK-5: a test not run blocks closing
    r = set_status(analyst, c["id"], "close")
    assert r.status_code == 409
    assert {(x["id"], x["reason"]) for x in r.json()["incomplete"]} == {
        (t1["id"], "not_run"),
        (t2["id"], "not_run"),
    }
    t1 = ok_patch(analyst, t1, exec_status="executed", executed_at=iso(EXEC))
    t2 = ok_patch(analyst, t2, exec_status="not_executed")
    # AK-6: executed without outcome
    r = set_status(analyst, c["id"], "close")
    assert r.status_code == 409
    assert [(x["id"], x["reason"]) for x in r.json()["incomplete"]] == [(t1["id"], "no_outcome")]

    t1 = ok_patch(analyst, t1, outcome="logged")
    # AK-7: closed and read-only
    assert set_status(analyst, c["id"], "close").json()["status"] == "closed"
    assert patch(analyst, t1, blue_notes="x").status_code == 409
    assert patch(analyst, t1, title="x").status_code == 409
    assert analyst.patch(f"/api/campaigns/{c['id']}", json={"description": "x"}).status_code == 409
    # AK-8: reopen
    assert set_status(analyst, c["id"], "reopen").json()["status"] == "running"
    assert patch(analyst, t1, blue_notes="seen in SIEM").status_code == 200


def test_delete_rules(admin, analyst, rules):
    c = new_campaign(analyst)
    add_test(analyst, c["id"])
    # AK-10: analysts cannot delete; admin deletes a planned campaign with its tests
    assert analyst.delete(f"/api/campaigns/{c['id']}").status_code == 403
    assert admin.delete(f"/api/campaigns/{c['id']}").status_code == 204
    assert analyst.get(f"/api/campaigns/{c['id']}").status_code == 404

    # AK-9: not with outcomes; verifications written stay
    c = new_campaign(analyst, "B")
    t = add_test(analyst, c["id"], rule_ids=[rules["r2"]["id"]])
    set_status(analyst, c["id"], "start")
    ok_patch(analyst, t, exec_status="executed", outcome="not_detected")
    assert admin.delete(f"/api/campaigns/{c['id']}").status_code == 409


# ---------------------------------------------------------------- proposals


def test_proposals_from_l2(analyst, rules):
    c = new_campaign(analyst)
    r = analyst.post(f"/api/campaigns/{c['id']}/proposals", json={"l2_ids": [rules["l2"]["id"]]})
    assert r.status_code == 200, r.text
    p = r.json()
    # AK-11: exactly two, T1059.001 with R1 and R2, T1003 with R1; AK-15: retired rule left out
    got = {x["technique"]: [y["code"] for y in x["rules"]] for x in p["proposals"]}
    assert got == {"T1003": ["PT-ACC-01"], "T1059.001": ["PT-ACC-01", "PT-ACC-02"]}
    # AK-14
    assert [x["code"] for x in p["no_technique"]] == ["PT-ACC-03"]


def test_proposals_revoked_and_deprecated(analyst, rules):
    c = new_campaign(analyst)
    p = analyst.post(
        f"/api/campaigns/{c['id']}/proposals", json={"l3_ids": [rules["old"]["id"]]}
    ).json()
    # AK-12: T1086 -> T1059.001; AK-13: T1043 is deprecated -> note only
    assert [(x["technique"], x["replaces"]) for x in p["proposals"]] == [("T1059.001", ["T1086"])]
    assert [(x["technique"], x["status"]) for x in p["skipped_techniques"]] == [
        ("T1043", "deprecated")
    ]


def test_proposals_templates_existing_and_accept(analyst, rules):
    for title in ("Mimikatz", "procdump"):
        r = analyst.post(
            "/api/test-library",
            json={"title": title, "technique": "T1003", "procedure": f"run {title}"},
        )
        assert r.status_code == 201
    c = new_campaign(analyst)
    p = analyst.post(
        f"/api/campaigns/{c['id']}/proposals", json={"l3_ids": [rules["r1"]["id"]]}
    ).json()
    t1003 = next(x for x in p["proposals"] if x["technique"] == "T1003")
    # AK-16: templates in library order; the first prefills
    assert [x["title"] for x in t1003["templates"]] == ["Mimikatz", "procdump"]

    # AK-19: accept two of the proposals (here: one plus a hand-edited copy)
    body = {
        "tests": [
            {
                "title": "Mimikatz",
                "technique": "T1003",
                "procedure": "run Mimikatz",
                "rule_ids": [rules["r1"]["id"]],
                "template_id": t1003["templates"][0]["id"],
            },
            {"title": "PS", "technique": "T1059.001", "rule_ids": [rules["r1"]["id"]]},
        ]
    }
    r = analyst.post(f"/api/campaigns/{c['id']}/tests/bulk", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["test_count"] == 2

    # AK-17: R2 also has T1059.001 -> proposal marked as already tested here
    p = analyst.post(
        f"/api/campaigns/{c['id']}/proposals", json={"l3_ids": [rules["r2"]["id"]]}
    ).json()
    (prop,) = p["proposals"]
    assert len(prop["existing_tests"]) == 1
    existing = prop["existing_tests"][0]["id"]
    # ... the analyst adds R2 to the existing test instead of a new test
    r = analyst.post(
        f"/api/campaigns/{c['id']}/tests/bulk",
        json={"add_rules": [{"test_id": existing, "rule_ids": [rules["r2"]["id"]]}]},
    )
    t = next(x for x in r.json()["tests"] if x["id"] == existing)
    assert [x["code"] for x in t["rules"]] == ["PT-ACC-01", "PT-ACC-02"]

    # AK-18: a second test for the same technique by hand
    add_test(analyst, c["id"], title="PS encoded", procedure="powershell -enc ...")
    tests = analyst.get(f"/api/campaigns/{c['id']}").json()["tests"]
    assert sum(1 for x in tests if x["technique"] == "T1059.001") == 2


# ---------------------------------------------------------------- tests and library


def test_technique_required_and_validated(analyst):
    c = new_campaign(analyst)
    # AK-20
    r = analyst.post(f"/api/campaigns/{c['id']}/tests", json={"title": "x"})
    assert r.status_code == 422
    r = analyst.post(f"/api/campaigns/{c['id']}/tests", json={"title": "x", "technique": "T1043"})
    assert r.status_code == 422
    # revoked IDs are stored as their replacement
    assert add_test(analyst, c["id"], technique="T1086")["technique"] == "T1059.001"
    # EC-11: long free text
    r = analyst.post(
        f"/api/campaigns/{c['id']}/tests",
        json={"title": "x", "technique": "T1003", "procedure": "x" * 10_001},
    )
    assert r.status_code == 422


def test_library(analyst, auditor):
    c = new_campaign(analyst)
    t = add_test(analyst, c["id"], procedure="IEX (New-Object Net.WebClient)", tools="pwsh")
    # AK-21
    r = analyst.post(f"/api/campaign-tests/{t['id']}/to-library")
    assert r.status_code == 201
    lib = auditor.get("/api/test-library").json()  # AK-23: auditor reads
    assert [(x["title"], x["technique"], x["procedure"], x["tools"]) for x in lib] == [
        ("PowerShell", "T1059.001", "IEX (New-Object Net.WebClient)", "pwsh")
    ]
    assert (
        auditor.post("/api/test-library", json={"title": "x", "technique": "T1003"}).status_code
        == 403
    )
    tpl = lib[0]["id"]
    assert analyst.get("/api/test-library", params={"technique": "T1059"}).json()[0]["id"] == tpl
    assert analyst.get("/api/test-library", params={"q": "webclient"}).json()[0]["id"] == tpl
    assert analyst.get("/api/test-library", params={"q": "nothing"}).json() == []
    r = analyst.patch(f"/api/test-library/{tpl}", json={"title": "PS download"})
    assert r.json()["title"] == "PS download"

    # AK-22: a test made from a template stays when the template is deleted
    t2 = add_test(analyst, c["id"], title="from lib", template_id=tpl)
    assert analyst.delete(f"/api/test-library/{tpl}").status_code == 204
    t2b = next(
        x for x in analyst.get(f"/api/campaigns/{c['id']}").json()["tests"] if x["id"] == t2["id"]
    )
    assert t2b["title"] == "from lib" and t2b["procedure"] == t2["procedure"]


def test_delete_test(analyst, rules):
    c = new_campaign(analyst)
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    t2 = add_test(analyst, c["id"])
    assert analyst.delete(f"/api/campaign-tests/{t2['id']}").status_code == 204
    set_status(analyst, c["id"], "start")
    ok_patch(analyst, t, exec_status="executed", outcome="logged")
    assert analyst.delete(f"/api/campaign-tests/{t['id']}").status_code == 409


# ---------------------------------------------------------------- outcomes and verification


def test_outcome_writes_verifications(analyst, rules):
    c = new_campaign(analyst)
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"], rules["r2"]["id"]])
    set_status(analyst, c["id"], "start")
    t = ok_patch(analyst, t, exec_status="executed", executed_at=iso(EXEC))
    # AK-36
    t = ok_patch(analyst, t, outcome="alerted", detected_at=iso(EXEC + timedelta(minutes=12)))
    assert t["ttd_seconds"] == 12 * 60
    for code in ("PT-ACC-01", "PT-ACC-02"):
        (v,) = verifications(analyst, code)
        assert v["result"] == "ok" and v["verified_at"] == "2026-11-02"
        assert v["username"] == "analyst1"
        assert v["note"] == "Purple team: Q1 Purple / PowerShell (Alerted)"
        rule = analyst.get(f"/api/l3/{code}").json()
        assert rule["last_verified_at"] == "2026-11-02"

    # AK-41: change Alerted -> Logged -> new Issues found, older stays
    t = ok_patch(analyst, t, outcome="logged", detected_at=None)
    assert t["ttd_seconds"] is None
    vs = verifications(analyst, "PT-ACC-01")
    assert [v["result"] for v in vs] == ["ok", "issues"] or sorted(v["result"] for v in vs) == [
        "issues",
        "ok",
    ]
    assert len(vs) == 2
    # AK-42: clearing writes and removes nothing
    t = ok_patch(analyst, t, outcome=None)
    assert len(verifications(analyst, "PT-ACC-01")) == 2

    # AK-43: linking R3 to a test with an outcome verifies R3
    t = ok_patch(analyst, t, outcome="alerted", detected_at=iso(EXEC + timedelta(hours=1)))
    t = ok_patch(analyst, t, rule_ids=[rules["r1"]["id"], rules["r2"]["id"], rules["r3"]["id"]])
    (v,) = verifications(analyst, "PT-ACC-03")
    assert v["result"] == "ok"
    assert len(verifications(analyst, "PT-ACC-01")) == 3


def test_logged_and_not_detected_are_issues(analyst, rules):
    c = new_campaign(analyst)
    set_status(analyst, c["id"], "start")
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    # AK-37 (no executed at: verification is today's date)
    t = ok_patch(analyst, t, exec_status="executed", outcome="logged")
    (v,) = verifications(analyst, "PT-ACC-01")
    assert v["result"] == "issues" and v["verified_at"] == date.today().isoformat()
    t2 = add_test(analyst, c["id"], title="dump", technique="T1003", rule_ids=[rules["r2"]["id"]])
    # AK-38
    t2 = ok_patch(
        analyst, t2, exec_status="executed", executed_at=iso(EXEC), outcome="not_detected"
    )
    assert t2["ttd_seconds"] is None
    assert [v["result"] for v in verifications(analyst, "PT-ACC-02")] == ["issues"]


def test_outcome_validation(analyst, rules):
    c = new_campaign(analyst)
    set_status(analyst, c["id"], "start")
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    t = ok_patch(analyst, t, exec_status="executed", executed_at=iso(EXEC))
    # AK-39
    assert patch(analyst, t, outcome="alerted").status_code == 422
    assert patch(analyst, t, outcome="blocked").status_code == 422
    # AK-40
    r = patch(analyst, t, outcome="not_detected", detected_at=iso(EXEC + timedelta(minutes=5)))
    assert r.status_code == 422
    # AK-45
    r = patch(analyst, t, outcome="alerted", detected_at=iso(EXEC - timedelta(minutes=5)))
    assert r.status_code == 422
    # future times
    r = patch(analyst, t, executed_at=iso(datetime.now(UTC) + timedelta(days=2)))
    assert r.status_code == 422
    # EC-9: could not execute -> no outcome
    t = ok_patch(analyst, t, exec_status="not_executed")
    assert patch(analyst, t, outcome="logged").status_code == 422
    assert verifications(analyst, "PT-ACC-01") == []
    # EC-7: no rule linked
    t2 = add_test(analyst, c["id"], title="no rule", technique="T1003")
    t2 = ok_patch(analyst, t2, exec_status="executed", outcome="logged")
    assert t2["rules"] == []


def test_conflict_on_stale_version(analyst, make_user, rules):
    other = make_user("analyst", "analyst2")
    c = new_campaign(analyst)
    set_status(analyst, c["id"], "start")
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    ok_patch(analyst, t, exec_status="executed", outcome="logged")
    # EC-6: second analyst saves on the old version
    r = patch(other, t, exec_status="executed", outcome="not_detected")
    assert r.status_code == 409
    assert len(verifications(analyst, "PT-ACC-01")) == 1


def test_median_ttd(analyst):
    c = new_campaign(analyst)
    set_status(analyst, c["id"], "start")
    for minutes in (5, 20, 180):
        t = add_test(analyst, c["id"], title=f"t{minutes}")
        ok_patch(
            analyst,
            t,
            exec_status="executed",
            executed_at=iso(EXEC),
            outcome="alerted",
            detected_at=iso(EXEC + timedelta(minutes=minutes)),
        )
    # AK-44
    assert analyst.get(f"/api/campaigns/{c['id']}").json()["median_ttd_seconds"] == 20 * 60


def test_rule_page_tests(analyst, auditor, rules):
    a = new_campaign(analyst, "A")
    b = new_campaign(analyst, "B")
    for cid, when in ((a["id"], EXEC), (b["id"], EXEC + timedelta(days=3))):
        set_status(analyst, cid, "start")
        t = add_test(analyst, cid, rule_ids=[rules["r1"]["id"]])
        ok_patch(
            analyst,
            t,
            exec_status="executed",
            executed_at=iso(when),
            outcome="alerted",
            detected_at=iso(when + timedelta(minutes=30)),
        )
    # AK-46: newest first, with campaign, technique, executed at, outcome and TTD
    rows = auditor.get("/api/l3/PT-ACC-01/campaign-tests").json()
    assert [(x["campaign_name"], x["technique"], x["outcome"], x["ttd_seconds"]) for x in rows] == [
        ("B", "T1059.001", "alerted", 1800),
        ("A", "T1059.001", "alerted", 1800),
    ]


def test_rule_deleted_keeps_test(admin, analyst, rules):
    c = new_campaign(analyst)
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"], rules["r2"]["id"]])
    assert admin.delete("/api/l3/PT-ACC-02").status_code == 204
    t = next(
        x for x in analyst.get(f"/api/campaigns/{c['id']}").json()["tests"] if x["id"] == t["id"]
    )
    assert [x["code"] for x in t["rules"]] == ["PT-ACC-01"]  # EC-1


# ---------------------------------------------------------------- red team


def test_red_team_access(app, analyst, red_team, rules):
    user, sign_in = red_team()
    a = new_campaign(analyst, "A", red_team_ids=[user["id"]])
    b = new_campaign(analyst, "B")
    red = sign_in()
    # AK-24
    assert [x["name"] for x in red.get("/api/campaigns").json()] == ["A"]
    assert red.get("/api/auth/me").json()["role"] == "red_team"
    # AK-25 / AK-55: everything else denied, also through the API
    for path in (
        f"/api/campaigns/{b['id']}",
        "/api/l3",
        "/api/l3/PT-ACC-01",
        "/api/scores",
        "/api/test-library",
        "/api/export/json",
        "/api/attack/techniques",
        "/api/l3/PT-ACC-01/campaign-tests",
        "/api/users",
    ):
        assert red.get(path).status_code == 403, path
    assert red.get("/api/campaigns/techniques").status_code == 200
    assert red.get(f"/api/campaigns/{a['id']}").status_code == 200
    assert (
        red.post(
            "/api/campaigns",
            json={"name": "X", "planned_start": "2026-12-01", "planned_end": "2026-12-02"},
        ).status_code
        == 403
    )


def test_red_team_blind_and_after_close(analyst, red_team, rules):
    x, sign_in_x = red_team("redx")
    y, sign_in_y = red_team("redy")
    c = new_campaign(analyst, red_team_ids=[x["id"], y["id"]])
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    rx, ry = sign_in_x(), sign_in_y()

    # AK-27: planned -> read-only for the red team
    view = rx.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    assert patch(rx, view, exec_status="executed").status_code == 409
    set_status(analyst, c["id"], "start")

    # AK-26 / AK-30
    view = ok_patch(rx, view, exec_status="executed", executed_at=iso(EXEC), red_notes="ran it")
    a_view = analyst.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    assert a_view["exec_status"] == "executed" and a_view["red_notes"] == "ran it"
    y_view = ry.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    assert y_view["red_notes"] == "ran it" and y_view["exec_status"] == "executed"

    # AK-28: blind while running, also through the API
    ok_patch(
        analyst,
        a_view,
        outcome="alerted",
        detected_at=iso(EXEC + timedelta(minutes=12)),
        blue_notes="secret",
    )
    for client in (rx, ry):
        d = client.get(f"/api/campaigns/{c['id']}").json()
        hidden = {"outcome", "detected_at", "ttd_seconds", "blue_notes", "rules", "white_box_rules"}
        assert not hidden & set(d["tests"][0]), d["tests"][0]
        assert "outcome_counts" not in d and "median_ttd_seconds" not in d
        listed = client.get("/api/campaigns").json()[0]
        assert "outcome_counts" not in listed
    # the red team cannot set outcomes, link rules, edit definitions or delete
    view = rx.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    assert patch(rx, view, outcome="logged").status_code == 403
    assert patch(rx, view, rule_ids=[rules["r2"]["id"]]).status_code == 403
    assert patch(rx, view, title="x").status_code == 403
    assert rx.delete(f"/api/campaign-tests/{view['id']}").status_code == 403
    assert rx.post(f"/api/campaign-tests/{view['id']}/to-library").status_code == 403

    # AK-29: red team adds a test without rules
    r = rx.post(f"/api/campaigns/{c['id']}/tests", json={"title": "ad hoc", "technique": "T1003"})
    assert r.status_code == 201
    new = r.json()
    assert "rules" not in new
    r = rx.post(
        f"/api/campaigns/{c['id']}/tests",
        json={"title": "x", "technique": "T1003", "rule_ids": [rules["r1"]["id"]]},
    )
    assert r.status_code == 403
    a_new = next(
        z for z in analyst.get(f"/api/campaigns/{c['id']}").json()["tests"] if z["id"] == new["id"]
    )
    assert a_new["rules"] == [] and a_new["created_by"] == "redx"
    ok_patch(analyst, a_new, exec_status="not_executed")

    # AK-31: after close: outcome, detected at, TTD; no blue notes, no rules
    assert set_status(analyst, c["id"], "close").json()["status"] == "closed"
    d = rx.get(f"/api/campaigns/{c['id']}").json()
    t0 = next(z for z in d["tests"] if z["id"] == t["id"])
    assert t0["outcome"] == "alerted" and t0["ttd_seconds"] == 720 and t0["detected_at"]
    assert "blue_notes" not in t0 and "rules" not in t0 and "white_box_rules" not in t0
    assert d["outcome_counts"]["alerted"] == 1


def test_white_box(admin, analyst, red_team, rules):
    # a rule with two config versions
    base = None
    for content in ('{"q": "v1"}', '{"q": "v2"}'):
        r = admin.put(
            "/api/l3/PT-ACC-01/config",
            json={"content": content, "message": "cfg", "base_sha": base},
        )
        assert r.status_code == 201, r.text
        base = r.json()["sha"]
    user, sign_in = red_team()
    c = new_campaign(analyst, red_team_ids=[user["id"]])
    add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    red = sign_in()
    assert "white_box_rules" not in red.get(f"/api/campaigns/{c['id']}").json()["tests"][0]

    # AK-35: switching white box on is audit logged with old and new
    set_status(analyst, c["id"], "start")
    r = analyst.patch(f"/api/campaigns/{c['id']}", json={"white_box": True})
    assert r.status_code == 200
    log = admin.get("/api/audit", params={"entity": "campaign"}).json()
    entry = next(e for e in log if e["action"] == "update")
    assert entry["entity_key"] == "Q1 Purple" and entry["changes"]["white_box"] == [False, True]

    # AK-32 / AK-33: definition and current config only
    t = red.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    (wb,) = t["white_box_rules"]
    assert wb["code"] == "PT-ACC-01" and wb["name"] == "Rule PT-ACC-01"
    assert wb["l2_code"] == "PT-ACC" and wb["log_sources"] == ["Application log"]
    assert wb["attack_techniques"] == ["T1059.001", "T1003"]
    assert wb["config"] == '{"q": "v2"}'
    assert not {"history", "tags", "rev", "sha"} & set(wb)
    # AK-34: outcome still hidden before close
    a_t = analyst.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    ok_patch(analyst, a_t, exec_status="executed", outcome="logged")
    t = red.get(f"/api/campaigns/{c['id']}").json()["tests"][0]
    assert "outcome" not in t
    # AK-55: the rule page stays closed
    assert red.get("/api/l3/PT-ACC-01").status_code == 403
    assert red.get("/api/l3/PT-ACC-01/config").status_code == 403


def test_removed_assignment_denies_access(analyst, red_team):
    user, sign_in = red_team()
    other, _ = red_team("red2")
    c = new_campaign(analyst, red_team_ids=[user["id"], other["id"]])
    new_campaign(analyst, "Keep", red_team_ids=[user["id"]], planned_end="2026-12-20")
    red = sign_in()
    assert red.get(f"/api/campaigns/{c['id']}").status_code == 200
    analyst.patch(f"/api/campaigns/{c['id']}", json={"red_team_ids": [other["id"]]})
    assert red.get(f"/api/campaigns/{c['id']}").status_code == 403  # EC-4


# ---------------------------------------------------------------- red team accounts


def user_row(admin, uid):
    return next(u for u in admin.get("/api/users").json() if u["id"] == uid)


def test_expiry_dates(admin, analyst, red_team):
    user, _ = red_team()
    assert user["role"] == "red_team" and user["auth_source"] == "local"  # AK-47
    assert user["expires_on"] is None
    a = new_campaign(analyst, "A", red_team_ids=[user["id"]])
    # AK-48
    u = user_row(admin, user["id"])
    assert u["expires_on"] == "2026-12-19" and u["expiry_manual"] is False
    # AK-49
    b = new_campaign(
        analyst,
        "B",
        planned_start="2027-01-10",
        planned_end="2027-01-20",
        red_team_ids=[user["id"]],
    )
    assert user_row(admin, user["id"])["expires_on"] == "2027-01-27"
    # AK-50
    analyst.patch(f"/api/campaigns/{b['id']}", json={"planned_end": "2027-01-30"})
    assert user_row(admin, user["id"])["expires_on"] == "2027-02-06"
    # AK-51: manual date stays until reset to automatic
    r = admin.patch(f"/api/users/{user['id']}", json={"expires_on": "2026-12-31"})
    assert r.status_code == 200 and r.json()["expiry_manual"] is True
    analyst.patch(f"/api/campaigns/{b['id']}", json={"planned_end": "2027-02-10"})
    assert user_row(admin, user["id"])["expires_on"] == "2026-12-31"
    r = admin.patch(f"/api/users/{user['id']}", json={"expires_on": None})
    assert r.json()["expires_on"] == "2027-02-17" and r.json()["expiry_manual"] is False
    # unassigning from all campaigns -> no date
    analyst.patch(f"/api/campaigns/{a['id']}", json={"red_team_ids": []})
    analyst.patch(f"/api/campaigns/{b['id']}", json={"red_team_ids": []})
    assert user_row(admin, user["id"])["expires_on"] is None
    # audit log
    log = admin.get("/api/audit", params={"entity": "user"}).json()
    assert any(e["action"] == "expiry" and e["entity_key"] == "red1" for e in log)
    # only red team accounts have an expiry date
    analyst_id = next(
        u["id"] for u in admin.get("/api/users").json() if u["username"] == "analyst1"
    )
    assert (
        admin.patch(f"/api/users/{analyst_id}", json={"expires_on": "2026-12-31"}).status_code
        == 422
    )


def test_login_without_campaign_refused(anon, red_team):
    red_team()
    # AK-54
    r = anon.post("/api/auth/login", json={"username": "red1", "password": PW})
    assert r.status_code == 401
    assert "no campaign" in r.json()["detail"]


def test_expired_account_is_disabled(app, admin, analyst, red_team):
    user, sign_in = red_team()
    new_campaign(
        analyst,
        "Old",
        planned_start="2026-01-01",
        planned_end="2026-01-05",
        red_team_ids=[user["id"]],
    )  # EC-5: already over
    # the account expired on 2026-01-12: sign in refused and the account disabled (AK-52)
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "red1", "password": PW})
        assert r.status_code == 401
    u = user_row(admin, user["id"])
    assert u["active"] is False
    log = admin.get("/api/audit", params={"entity": "user"}).json()
    assert any(e["action"] == "expire" and e["entity_key"] == "red1" for e in log)
    # AK-53: re-enable needs a new future date
    assert admin.patch(f"/api/users/{user['id']}", json={"active": True}).status_code == 409
    future = (date.today() + timedelta(days=10)).isoformat()
    r = admin.patch(f"/api/users/{user['id']}", json={"expires_on": future, "active": True})
    assert r.status_code == 200 and r.json()["active"] is True
    sign_in()


def test_session_ends_when_expiry_passes(app, admin, analyst, red_team):
    from app import redteam

    user, sign_in = red_team()
    new_campaign(analyst, red_team_ids=[user["id"]])
    red = sign_in()
    assert red.get("/api/campaigns").status_code == 200
    # the expiry date passes while signed in
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    assert (
        admin.patch(f"/api/users/{user['id']}", json={"expires_on": yesterday}).status_code == 200
    )
    assert red.get("/api/campaigns").status_code == 401
    assert user_row(admin, user["id"])["active"] is False
    # the background sweep does the same for accounts that are not signed in
    with app.state.sessionmaker() as db:
        assert redteam.sweep(db) == 0


def test_sweep_disables_expired(app, admin, analyst, red_team):
    from app import redteam

    user, _ = red_team()
    new_campaign(analyst, red_team_ids=[user["id"]])
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    admin.patch(f"/api/users/{user['id']}", json={"expires_on": yesterday})
    with app.state.sessionmaker() as db:
        assert redteam.sweep(db) == 1
    assert user_row(admin, user["id"])["active"] is False


def test_assignment_warning_and_only_red_team(analyst, red_team, make_user):
    user, _ = red_team()
    c = new_campaign(
        analyst,
        "Past",
        planned_start="2026-01-01",
        planned_end="2026-01-05",
        red_team_ids=[user["id"]],
    )
    assert c["warnings"] == ["The expiry date of red1 is already over"]  # EC-5
    aud = make_user("auditor")
    me = aud.get("/api/auth/me").json()
    r = analyst.post(
        "/api/campaigns",
        json={
            "name": "X",
            "planned_start": "2026-12-01",
            "planned_end": "2026-12-02",
            "red_team_ids": [me["id"]],
        },
    )
    assert r.status_code == 422
    assert [x["username"] for x in analyst.get("/api/campaigns/red-team-accounts").json()] == [
        "red1"
    ]


def test_sso_cannot_map_red_team():
    from app.api.oidc import parse_role_map

    assert parse_role_map("ext=red_team,soc=analyst") == {"soc": "analyst"}


# ---------------------------------------------------------------- export


def test_json_export(analyst, rules):
    c = new_campaign(analyst)
    t = add_test(analyst, c["id"], rule_ids=[rules["r1"]["id"]])
    analyst.post(f"/api/campaign-tests/{t['id']}/to-library")
    data = analyst.get("/api/export/json").json()  # AK-57
    (camp,) = data["campaigns"]
    assert camp["name"] == "Q1 Purple" and camp["status"] == "planned"
    assert camp["tests"][0]["rules"] == ["PT-ACC-01"]
    assert data["test_library"][0]["technique"] == "T1059.001"
