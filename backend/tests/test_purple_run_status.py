"""Purple teaming: VECTR-style execution status of a test (Not performed, In progress, Paused,
Completed, Abandoned) and who works on it."""

from tests.test_purple import new_assessment, new_campaign, new_case


def act(client, t: dict, what: str, expect=200) -> dict:
    r = client.post(
        f"/api/purple/test-cases/{t['id']}/{what}", json={"expected_version": t["red_version"]}
    )
    assert r.status_code == expect, r.text
    return r.json() if expect == 200 else t


def case(client) -> dict:
    return new_case(client, new_campaign(client, new_assessment(client))["id"])


def test_start_pause_resume_complete(admin):
    t = case(admin)
    assert t["red_status"] == "planned"
    act(admin, t, "pause", expect=409)  # nothing runs yet
    act(admin, t, "resume", expect=409)
    t = act(admin, t, "start")
    started = t["attack_start"]
    assert t["red_status"] == "in_progress" and t["red_assignee"] == "admin"
    t = act(admin, t, "pause")
    assert t["red_status"] == "paused" and t["attack_start"] == started
    assert admin.get(f"/api/purple/assessments/{t['assessment_id']}").json()["status"] == (
        "in_progress"
    )
    t = act(admin, t, "resume")
    assert t["red_status"] == "in_progress" and t["attack_start"] == started
    t = act(admin, act(admin, t, "pause"), "stop")  # complete straight from paused
    assert t["red_status"] == "executed" and t["attack_stop"]
    assert t["blue_status"] == "in_review"
    act(admin, t, "abandon", expect=409)


def test_abandon(admin):
    t = act(admin, case(admin), "start")
    t = act(admin, t, "abandon")
    assert t["red_status"] == "not_executed" and t["attack_stop"]
    assert t["blue_status"] == "waiting"
    # a stale version is refused like every red side change
    r = admin.post(f"/api/purple/test-cases/{t['id']}/start", json={"expected_version": 1})
    assert r.status_code == 409


def test_paused_tests_are_open_work_in_the_queue(admin):
    t = act(admin, act(admin, case(admin), "start"), "pause")
    assert [r["id"] for r in admin.get("/api/purple/queue").json() if r["side"] == "red"] == [
        t["id"]
    ]


def test_red_side_save_accepts_paused(admin):
    t = act(admin, case(admin), "start")
    body = {
        "expected_version": t["red_version"],
        "red_status": "paused",
        "attack_start": t["attack_start"],
    }
    r = admin.put(f"/api/purple/test-cases/{t['id']}/red", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["red_status"] == "paused"


def test_assignee_from_the_campaign_table(admin, make_user):
    analyst = make_user("analyst")
    t = case(admin)
    r = admin.put(
        f"/api/purple/test-cases/{t['id']}/assignee", json={"side": "red", "assignee": "analyst1"}
    )
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["red_assignee"] == "analyst1" and n["red_version"] == t["red_version"] + 1
    r = analyst.put(
        f"/api/purple/test-cases/{t['id']}/assignee", json={"side": "blue", "assignee": "admin"}
    )
    assert (
        r.json()["blue_assignee"] == "admin" and r.json()["blue_version"] == t["blue_version"] + 1
    )
    # unchanged: no new version, no audit entry
    same = admin.put(
        f"/api/purple/test-cases/{t['id']}/assignee", json={"side": "red", "assignee": "analyst1"}
    ).json()
    assert same["red_version"] == n["red_version"]
    log = admin.get("/api/audit?limit=50").json()
    items = log["items"] if isinstance(log, dict) else log
    assigns = [e for e in items if e["action"] == "assign"]
    assert len(assigns) == 2
    assert {"red_assignee": ["", "analyst1"]} in [e["changes"] for e in assigns]
    bad = admin.put(f"/api/purple/test-cases/{t['id']}/assignee", json={"side": "x"})
    assert bad.status_code == 422


def test_people_and_roles(admin, make_user):
    analyst = make_user("analyst")
    auditor = make_user("auditor")
    names = [p["username"] for p in auditor.get("/api/purple/people").json()]
    assert names == ["admin", "analyst1"]  # auditors cannot work on tests
    t = case(admin)
    for what in ("pause", "resume", "abandon"):
        r = auditor.post(f"/api/purple/test-cases/{t['id']}/{what}", json={"expected_version": 1})
        assert r.status_code == 403
    r = auditor.put(f"/api/purple/test-cases/{t['id']}/assignee", json={"side": "red"})
    assert r.status_code == 403
    assert (
        analyst.post(
            f"/api/purple/test-cases/{t['id']}/start", json={"expected_version": t["red_version"]}
        ).status_code
        == 200
    )
