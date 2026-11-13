from app.configs import check_yaml, diff_lines

URL = "/api/l3/AO-CRE-01/config"
V1 = "query: process.name == 'lsass.exe'\nthreshold: 5\n"
V2 = "query: process.name == 'lsass.exe'\nthreshold: 3\nseverity: high\n"


def test_check_yaml_reports_line():
    assert check_yaml("a: 1\nb: [1, 2]\n").valid
    r = check_yaml("a: 1\nb: [1, 2\nc: 3\n")
    assert not r.valid and r.line is not None
    assert check_yaml("").valid  # empty config is allowed


def test_diff_lines():
    d = diff_lines("a\nb\nc\n", "a\nB\nc\nd\n")
    assert (d["added"], d["removed"]) == (2, 1)
    kinds = [x["kind"] for x in d["lines"]]
    assert kinds[0] == "hunk" and "del" in kinds and "add" in kinds


def test_commit_history_diff_restore_tag(admin, make_user):
    assert admin.get(URL).json() == {"head": None, "content": "", "commits": 0}

    r = admin.put(URL, json={"content": V1, "message": "Initial", "base_sha": None})
    assert r.status_code == 201, r.text
    c1 = r.json()
    assert c1["rev"] == 1 and len(c1["sha"]) == 64 and c1["parent_sha"] is None

    # unchanged content and invalid YAML are refused
    same = admin.put(URL, json={"content": V1, "message": "x", "base_sha": c1["sha"]})
    assert same.status_code == 422
    bad = admin.put(URL, json={"content": "a: [1\n", "message": "x", "base_sha": c1["sha"]})
    assert bad.status_code == 422 and "line" in bad.json()["detail"]

    c2 = admin.put(URL, json={"content": V2, "message": "Lower threshold", "base_sha": c1["sha"]})
    assert c2.status_code == 201
    c2 = c2.json()
    assert c2["rev"] == 2 and c2["parent_sha"] == c1["sha"]

    # stale base -> 409 with a diff, nothing written
    stale = admin.put(URL, json={"content": "x: 1\n", "message": "y", "base_sha": c1["sha"]})
    assert stale.status_code == 409
    assert stale.json()["head"]["rev"] == 2 and stale.json()["diff"]["lines"]

    hist = admin.get(f"{URL}/history").json()
    assert [h["rev"] for h in hist] == [2, 1]

    d = admin.get(f"{URL}/diff", params={"to": "r2"}).json()
    assert d["from"]["rev"] == 1 and (d["added"], d["removed"]) == (2, 1)
    assert admin.get(f"{URL}/commits/{c1['sha'][:7]}").json()["content"] == V1

    r = admin.post(f"{URL}/restore/r1", json={})
    assert r.status_code == 201
    c3 = r.json()
    assert c3["rev"] == 3 and c3["restored_from"] == c1["sha"]
    assert admin.get(URL).json()["content"] == V1

    assert admin.post(f"{URL}/tags", json={"name": "prod", "ref": "r2"}).status_code == 201
    assert admin.post(f"{URL}/tags", json={"name": "prod"}).status_code == 409
    assert admin.post(f"{URL}/tags", json={"name": "bad tag"}).status_code == 422
    assert admin.get(f"{URL}/commits/prod").json()["rev"] == 2

    dl = admin.get(f"{URL}/download")
    assert dl.text == V1 and 'filename="AO-CRE-01.yaml"' in dl.headers["content-disposition"]
    assert "AO-CRE-01-r2.yaml" in admin.get(f"{URL}/download?ref=r2").headers["content-disposition"]

    heads = admin.get("/api/config/heads/l3", params={"prefix": "AO-CRE"}).json()
    assert heads["AO-CRE-01"]["rev"] == 3
    recent = admin.get("/api/config/recent").json()
    assert recent[0]["code"] == "AO-CRE-01" and recent[0]["rev"] == 3

    # auditor can read but not write
    auditor = make_user("auditor")
    assert auditor.get(f"{URL}/history").status_code == 200
    assert (
        auditor.put(
            URL, json={"content": "a: 1\n", "message": "x", "base_sha": c3["sha"]}
        ).status_code
        == 403
    )
    assert auditor.post(f"{URL}/restore/r2", json={}).status_code == 403

    actions = [a["action"] for a in admin.get("/api/audit").json()]
    assert {"config_commit", "config_restore", "config_tag"} <= set(actions)


def test_verify_tags_current_config(admin):
    admin.put(
        "/api/l2/AO-CRE/config",
        json={"content": "owner: soc\n", "message": "Init", "base_sha": None},
    )
    r = admin.post("/api/l2/AO-CRE/verify", json={})
    assert r.status_code == 201 and r.json()["config_tag"].startswith("verified-")
    r2 = admin.post("/api/l2/AO-CRE/verify", json={})
    assert r2.json()["config_tag"].endswith("-2")
    tags = admin.get("/api/l2/AO-CRE/config").json()["head"]["tags"]
    assert len(tags) == 2
    # without a config, no tag
    assert admin.post("/api/l3/AO-CRE-02/verify", json={}).json()["config_tag"] is None


def test_validate_endpoint(admin):
    r = admin.post("/api/config/validate", json={"content": "a: b: c"}).json()
    assert not r["valid"] and r["line"] == 1
