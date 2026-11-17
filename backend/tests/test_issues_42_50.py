"""Fixes from the test report of 2026-11-17: owner sign-off (#42), one draft per system (#45),
audit of evidence views and PDF exports (#46), evidence quota (#47), Origin check (#49) and
the SIEM name built on the server (#50). #38-#41 are in test_issues_32_36.py and
test_interviews.py, #48 in test_interviews.py."""

import io

import pytest
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.test_interviews import complete, component, new_system, save, start
from tests.test_issues_32_36 import PDF, PNG, VSDX, upload


@pytest.fixture
def analyst(make_user):
    return make_user("analyst")


def _completed(analyst) -> dict:
    s = new_system(analyst)
    return complete(analyst, save(analyst, start(analyst, s["id"]), components=[component()]))


def _signoff(client, iv_id: int, name: str, data: bytes, expect: int = 201) -> dict:
    r = client.post(
        f"/api/interviews/{iv_id}/attachments?signoff=true",
        files={"file": (name, io.BytesIO(data), "application/octet-stream")},
    )
    assert r.status_code == expect, r.text
    return r.json()


# ---------------------------------------------------------------- #42 sign-off


def test_signoff_after_completion_until_confirmed(analyst, admin):
    iv = _completed(analyst)
    # ordinary evidence stays locked, a sign-off is accepted once
    upload(analyst, iv["id"], "later.pdf", PDF, expect=409)
    _signoff(analyst, iv["id"], "owner.vsdx", VSDX, expect=422)
    a = _signoff(analyst, iv["id"], "owner-mail.pdf", PDF)
    assert a["signoff"] is True
    _signoff(analyst, iv["id"], "second.png", PNG, expect=409)
    # it can be replaced until the confirmation is recorded
    assert analyst.delete(f"/api/interview-attachments/{a['id']}").status_code == 204
    a = _signoff(analyst, iv["id"], "owner-mail.png", PNG)
    url = f"/api/interviews/{iv['id']}/confirmation"
    r = analyst.put(url, json={"confirmed_by": "J. Jansen", "confirmed_at": iv["interview_date"]})
    assert r.status_code == 200, r.text
    assert [x["filename"] for x in r.json()["attachments"] if x["signoff"]] == ["owner-mail.png"]
    assert analyst.delete(f"/api/interview-attachments/{a['id']}").status_code == 409
    confirm = next(e for e in admin.get("/api/audit?limit=10").json() if e["action"] == "confirm")
    assert confirm["changes"]["signoff"] == "owner-mail.png"


def test_signoff_not_on_draft(analyst):
    iv = start(analyst, new_system(analyst)["id"])
    _signoff(analyst, iv["id"], "owner.pdf", PDF, expect=409)


# ---------------------------------------------------------------- #45 one draft


def test_database_allows_one_draft_per_system(analyst, app):
    s = new_system(analyst)
    iv = start(analyst, s["id"])
    engine = app.state.engine
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO interviews (system_id, status, interview_date, participants, notes,"
                " data, analyst, version, updated_by, created_at, updated_at) "
                "SELECT system_id, status, interview_date, participants, notes, data, analyst,"
                " version, updated_by, created_at, updated_at FROM interviews WHERE id = :id"
            ),
            {"id": iv["id"]},
        )
    # a completed interview and a new draft live side by side
    complete(analyst, save(analyst, iv, components=[component()]))
    start(analyst, s["id"])


# ---------------------------------------------------------------- #46 audit of reading


def test_viewing_downloading_and_exporting_is_audited(analyst, admin, make_user):
    auditor = make_user("auditor")
    iv = start(analyst, new_system(analyst)["id"])
    a = upload(analyst, iv["id"], "scope.pdf", PDF)
    for _ in range(3):
        assert auditor.get(f"/api/interview-attachments/{a['id']}/content").status_code == 200
    r = auditor.get(f"/api/interview-attachments/{a['id']}/content?download=1")
    assert r.status_code == 200
    assert auditor.get(f"/api/interviews/{iv['id']}/pdf").status_code == 200
    log = [
        e
        for e in admin.get("/api/audit?limit=50").json()
        if e["username"] == "auditor1" and e["action"] != "login"
    ]
    kinds = sorted((e["action"], e["entity"]) for e in log)
    # repeated views within the hour are one entry
    assert kinds == [
        ("download", "interview_evidence"),
        ("export", "interview"),
        ("view", "interview_evidence"),
    ]


# ---------------------------------------------------------------- #47 quota


def test_evidence_quota(analyst, admin, settings):
    settings.evidence_max_total_mb = 1
    iv = start(analyst, new_system(analyst)["id"])
    big = PDF + b"0" * (700 * 1024)
    upload(analyst, iv["id"], "one.pdf", big)
    r = analyst.post(
        f"/api/interviews/{iv['id']}/attachments",
        files={"file": ("two.pdf", io.BytesIO(big), "application/pdf")},
    )
    assert r.status_code == 413 and "storage is full" in r.json()["detail"]
    storage = admin.get("/api/evidence/storage").json()
    assert storage["files"] == 1 and storage["limit_bytes"] == 1024 * 1024
    assert storage["used_bytes"] == len(big)
    assert analyst.get("/api/evidence/storage").status_code == 403


# ---------------------------------------------------------------- #49 Origin check


def test_cross_site_changes_are_refused(analyst):
    body = {"name": "Evil", "owner_name": "X", "criticality": 3}
    r = analyst.post("/api/systems", json=body, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = analyst.post("/api/systems", json=body, headers={"Referer": "https://evil.example/page"})
    assert r.status_code == 403
    # the app itself, and clients that send no Origin, still work
    r = analyst.post("/api/systems", json=body, headers={"Origin": "http://testserver"})
    assert r.status_code == 201, r.text
    body["name"] = "Other"
    assert analyst.post("/api/systems", json=body).status_code == 201
    # reading is never blocked
    r = analyst.get("/api/systems", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200


# ---------------------------------------------------------------- #50 SIEM name


def test_siem_name_on_server(admin):
    r = admin.put(
        "/api/settings/rule-name",
        json={"format": "$co:$ucID", "variables": [{"name": "co", "value": "ACME"}]},
    )
    assert r.status_code == 200, r.text
    assert admin.get("/api/l3/AO-CRE-03").json()["siem_name"] == "ACME:AO-CRE-03"
    listed = {x["code"]: x for x in admin.get("/api/l3?l2=AO-CRE").json()}
    assert listed["AO-CRE-03"]["siem_name"] == "ACME:AO-CRE-03"

    # Excel export has the column
    wb = load_workbook(io.BytesIO(admin.get("/api/export/excel").content))
    ws = wb["L3 UC"]
    assert ws.cell(1, 26).value == "SIEM name"
    row = next(r for r in range(2, ws.max_row + 1) if ws.cell(r, 6).value == "AO-CRE-03")
    assert ws.cell(row, 26).value == "ACME:AO-CRE-03"

    # the SIEM inventory can use the SIEM name as rule id
    inv = {"rules": [{"id": "acme:ao-cre-03", "name": "From the SIEM"}]}
    s = admin.put("/api/integrations/siem/splunk/rules", json=inv).json()
    assert s["linked"] == 1 and s["unlinked"] == []


# ---------------------------------------------------------------- #44 PDF text


def test_pdf_text_keeps_unicode_and_renders_markdown():
    from app.report import _t, md_text

    assert _t("„quotes“ → ✓ – Größe") == "„quotes“ → ✓ – Größe"
    assert _t("漢字 😀") == "?? ?"  # not in the bundled font
    assert md_text("# Title\n**bold** and *it*, `code`\n- one\n[site](https://x.org)") == (
        "**Title**\n**bold** and it, code\n• one\nsite (https://x.org)"
    )
    # fpdf2's own markers in plain text are not interpreted
    assert "​" in md_text("a--b")


def test_interview_pdf_with_unicode_notes(analyst):
    s = new_system(analyst, description="**Kernsystem** für „Zahlungen“")
    iv = start(analyst, s["id"])
    iv = save(analyst, iv, notes="- Punkt → ✓\n- 漢字 😀", components=[component()])
    r = analyst.get(f"/api/interviews/{iv['id']}/pdf?lang=de")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
