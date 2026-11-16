"""Issues #34 (evidence files on interviews) and #36 (proposals filtered by log sources)."""

import io

import pytest

from tests.test_interviews import component, log_source_id, new_system, save, start, threat

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
VSDX = b"PK\x03\x04" + b"\x00" * 32
VSD = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32
DIA_GZ = b"\x1f\x8b\x08\x00" + b"\x00" * 16
DIA_XML = b'<?xml version="1.0"?><dia:diagram/>'
EXCALIDRAW = b'{"type": "excalidraw", "version": 2, "elements": []}'
TM7 = '﻿<ThreatModel xmlns="http://schemas.datacontract.org"/>'.encode("utf-16-le")
TM7 = b"\xff\xfe" + TM7[2:]


@pytest.fixture
def analyst(make_user):
    return make_user("analyst")


def upload(client, iv_id: int, name: str, data: bytes, expect: int = 201) -> dict:
    r = client.post(
        f"/api/interviews/{iv_id}/attachments",
        files={"file": (name, io.BytesIO(data), "application/octet-stream")},
    )
    assert r.status_code == expect, r.text
    return r.json()


# ---------------------------------------------------------------- #34 evidence


@pytest.mark.parametrize(
    "name,data,kind,viewable",
    [
        ("scope.pdf", PDF, "pdf", True),
        ("board.PNG", PNG, "image", True),
        ("photo.jpg", JPG, "image", True),
        ("photo.jpeg", JPG, "image", True),
        ("network.vsdx", VSDX, "diagram", False),
        ("legacy.vsd", VSD, "diagram", False),
        ("flow.dia", DIA_GZ, "diagram", False),
        ("flow-plain.dia", DIA_XML, "diagram", False),
        ("sketch.excalidraw", EXCALIDRAW, "diagram", False),
        ("model.tm7", TM7, "threat_model", False),
    ],
)
def test_accepted_file_types(analyst, name, data, kind, viewable):
    iv = start(analyst, new_system(analyst)["id"])
    a = upload(analyst, iv["id"], name, data)
    assert (a["filename"], a["kind"], a["viewable"], a["size"]) == (name, kind, viewable, len(data))
    r = analyst.get(f"/api/interview-attachments/{a['id']}/content")
    assert r.status_code == 200
    assert r.content == data
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("inline" if viewable else "attachment")
    assert r.headers["x-content-type-options"] == "nosniff"
    if not viewable:
        assert r.headers["content-type"] == "application/octet-stream"
    # ?download=1 always downloads
    r = analyst.get(f"/api/interview-attachments/{a['id']}/content?download=1")
    assert r.headers["content-disposition"].startswith("attachment")


@pytest.mark.parametrize(
    "name,data",
    [
        ("evil.html", b"<script>alert(1)</script>"),
        ("evil.svg", b"<svg/>"),
        ("noext", PDF),
        (".pdf", PDF),
        ("fake.pdf", b"<html>not a pdf</html>"),
        ("fake.png", JPG),
        ("fake.excalidraw", b"[1, 2]"),
        ("fake.tm7", b"\x00\x01binary"),
        ("empty.pdf", b""),
    ],
)
def test_refused_files(analyst, name, data):
    iv = start(analyst, new_system(analyst)["id"])
    upload(analyst, iv["id"], name, data, expect=422)
    assert analyst.get(f"/api/interviews/{iv['id']}/attachments").json() == []


def test_too_large(analyst, monkeypatch):
    from app.api import evidence

    monkeypatch.setattr(evidence, "MAX_FILE", 100)
    iv = start(analyst, new_system(analyst)["id"])
    upload(analyst, iv["id"], "big.pdf", PDF + b"x" * 200, expect=413)


def test_file_name_is_cleaned(analyst):
    iv = start(analyst, new_system(analyst)["id"])
    a = upload(analyst, iv["id"], "../../etc/Prüfung v1.pdf", PDF)
    assert a["filename"] == "Prüfung v1.pdf"
    r = analyst.get(f"/api/interview-attachments/{a['id']}/content")
    assert 'filename="Pr_fung v1.pdf"' in r.headers["content-disposition"]
    assert "filename*=UTF-8''Pr%C3%BCfung%20v1.pdf" in r.headers["content-disposition"]


def test_evidence_lifecycle_roles_and_audit(analyst, make_user, admin):
    s = new_system(analyst)
    iv = start(analyst, s["id"])
    a = upload(analyst, iv["id"], "scope.pdf", PDF)
    got = analyst.get(f"/api/interviews/{iv['id']}").json()
    assert [x["filename"] for x in got["attachments"]] == ["scope.pdf"]

    auditor = make_user("auditor")
    assert auditor.get(f"/api/interview-attachments/{a['id']}/content").status_code == 200
    upload(auditor, iv["id"], "x.pdf", PDF, expect=403)
    assert auditor.delete(f"/api/interview-attachments/{a['id']}").status_code == 403

    b = upload(analyst, iv["id"], "second.png", PNG)
    assert analyst.delete(f"/api/interview-attachments/{b['id']}").status_code == 204
    assert analyst.get(f"/api/interview-attachments/{b['id']}/content").status_code == 404

    # completing freezes the evidence
    iv = save(analyst, got, components=[component(threats=[threat("spoofing")])])
    r = analyst.post(
        f"/api/interviews/{iv['id']}/complete", json={"expected_version": iv["version"]}
    )
    assert r.status_code == 200, r.text
    upload(analyst, iv["id"], "late.pdf", PDF, expect=409)
    assert analyst.delete(f"/api/interview-attachments/{a['id']}").status_code == 409
    assert analyst.get(f"/api/interview-attachments/{a['id']}/content").status_code == 200

    # listed (without content) in the PDF report and the JSON export
    assert analyst.get(f"/api/interviews/{iv['id']}/pdf").status_code == 200
    export = admin.get("/api/export/json").json()
    att = export["systems"][0]["interviews"][0]["attachments"]
    assert [(x["filename"], x["size"]) for x in att] == [("scope.pdf", len(PDF))]
    assert "data" not in att[0]

    log = admin.get("/api/audit?limit=50").json()
    actions = [(e["action"], e["entity"]) for e in log if e["entity"] == "interview_evidence"]
    assert ("upload", "interview_evidence") in actions
    assert ("delete", "interview_evidence") in actions

    # deleting the system removes interviews and their files
    assert analyst.delete(f"/api/systems/{s['id']}").status_code in (204, 409)


def test_deleting_draft_removes_files(analyst):
    iv = start(analyst, new_system(analyst)["id"])
    a = upload(analyst, iv["id"], "scope.pdf", PDF)
    assert analyst.delete(f"/api/interviews/{iv['id']}").status_code == 204
    assert analyst.get(f"/api/interview-attachments/{a['id']}/content").status_code == 404


# ---------------------------------------------------------------- #36 log source filter


def _setup_rules(client):
    """AO-ACC rules use the database log, AO-CRE rules none; spoofing maps to both."""
    for code in ("AO-ACC-01",):
        r = client.patch(f"/api/l3/{code}", json={"log_sources": ["Database log"]})
        assert r.status_code == 200, r.text


def test_filter_is_on_by_default_and_matches_component_log_sources(analyst, admin):
    assert admin.get("/api/stride-mapping").json()["log_source_filter"] is True
    _setup_rules(analyst)
    db_log = log_source_id(analyst, "Database log")
    os_log = log_source_id(analyst, "OS logging")
    iv = start(analyst, new_system(analyst)["id"])
    comps = [
        component("web", "Web", threats=[threat("spoofing")], log_source_ids=[os_log]),
        component("db", "Database", threats=[threat("spoofing")], log_source_ids=[db_log]),
    ]
    view = save(analyst, iv, components=comps)["view"]
    assert view["log_source_filter"] is True
    proposed = {p["code"]: p for p in view["proposals"]}
    # AO-ACC: only the database component delivers what its rules need
    assert "AO-ACC" in proposed
    assert [s["component"] for s in proposed["AO-ACC"]["sources"]] == ["db"]
    # every other spoofing L2 needs log sources nobody delivers (or records none)
    assert set(proposed) == {"AO-ACC"}
    mismatch = {m["code"]: m for m in view["log_source_mismatch"]}
    assert "AO-ACC" not in mismatch
    assert "AO-CRE" in mismatch
    m = mismatch["AO-CRE"]
    assert {s["component"] for s in m["sources"]} == {"web", "db"}
    assert m["risk_score"] == 12
    web = next(s for s in m["sources"] if s["component"] == "web")
    assert web["component_log_sources"] == ["OS logging"]


def test_component_without_log_sources_proposes_nothing(analyst):
    _setup_rules(analyst)
    iv = start(analyst, new_system(analyst)["id"])
    view = save(analyst, iv, components=[component(threats=[threat("spoofing")])])["view"]
    assert view["proposals"] == []
    assert "AO-ACC" in [m["code"] for m in view["log_source_mismatch"]]


def test_added_by_hand_is_not_filtered(analyst):
    _setup_rules(analyst)
    iv = start(analyst, new_system(analyst)["id"])
    iv = save(analyst, iv, components=[component(threats=[threat("spoofing")])])
    cre = analyst.get("/api/l2/AO-CRE").json()["id"]
    view = save(
        analyst,
        iv,
        added=[{"l2_id": cre, "threats": [{"component": "web", "category": "spoofing"}]}],
    )["view"]
    assert [p["code"] for p in view["proposals"]] == ["AO-CRE"]
    assert "AO-CRE" not in [m["code"] for m in view["log_source_mismatch"]]


def test_admin_can_switch_the_filter_off(analyst, admin):
    _setup_rules(analyst)
    iv = start(analyst, new_system(analyst)["id"])
    iv = save(analyst, iv, components=[component(threats=[threat("spoofing")])])
    assert iv["view"]["proposals"] == []
    r = analyst.put("/api/stride-mapping/log-source-filter", json={"enabled": False})
    assert r.status_code == 403
    r = admin.put("/api/stride-mapping/log-source-filter", json={"enabled": False})
    assert r.status_code == 200 and r.json()["log_source_filter"] is False
    view = analyst.get(f"/api/interviews/{iv['id']}").json()["view"]
    assert {"AO-ACC", "AO-CRE"} <= {p["code"] for p in view["proposals"]}
    assert view["log_source_mismatch"] == []
    log = admin.get("/api/audit?limit=10").json()
    assert any(
        e["entity"] == "stride_mapping" and e["entity_key"] == "log_source_filter" for e in log
    )
