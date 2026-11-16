"""Issue #29: format and variables of the SIEM name of a rule, kept in the app settings."""

URL = "/api/settings/rule-name"


def test_defaults_and_update(admin, make_user):
    s = admin.get(URL).json()
    assert s["format"] == "$ucID:$ucName" and s["variables"] == []
    assert s["builtins"] == ["ucID", "ucName", "l2ID", "l1ID"] and s["updated_by"] is None

    body = {
        "format": "$companyName:$ucID:$ucName",
        "variables": [{"name": "companyName", "value": "MYCORP"}],
    }
    r = admin.put(URL, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["updated_by"] == "admin"
    analyst = make_user("analyst")
    got = analyst.get(URL).json()
    assert got["format"] == body["format"] and got["variables"] == body["variables"]
    # only admins change it
    assert analyst.put(URL, json=body).status_code == 403
    audit = admin.get("/api/audit").json()
    assert any(e["entity"] == "settings" and e["entity_key"] == "rule_name" for e in audit)


def test_validation(admin):
    def put(**kw):
        return admin.put(URL, json={"format": "$ucID", "variables": [], **kw})

    assert put(variables=[{"name": "ucID", "value": "x"}]).status_code == 422
    two = [{"name": "a", "value": "1"}, {"name": "a", "value": "2"}]
    assert put(variables=two).status_code == 422
    assert put(variables=[{"name": "bad name", "value": "x"}]).status_code == 422
    assert put(variables=[{"name": "1st", "value": "x"}]).status_code == 422
    assert put(format="   ").status_code == 422
    assert put(format="x" * 501).status_code == 422
