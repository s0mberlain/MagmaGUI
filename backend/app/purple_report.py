"""PDF of a purple team assessment, in English, German or Dutch.

A summary with the defense metrics, the outcome per campaign, then every test case with what
the red team did, what the defenses did and the findings. Until the assessment is completed
every page carries a "Draft" watermark.
"""

from app.interview_report import _Pdf
from app.purple import OUTCOME_ORDER
from app.report import ACCENT, MUTED, pct

TEXTS: dict[str, dict[str, str]] = {
    "title": {
        "en": "Purple team assessment",
        "de": "Purple-Team-Assessment",
        "nl": "Purple team-assessment",
    },
    "page": {"en": "page", "de": "Seite", "nl": "pagina"},
    "draft": {"en": "DRAFT", "de": "ENTWURF", "nl": "CONCEPT"},
    "status": {"en": "Status", "de": "Status", "nl": "Status"},
    "planned": {"en": "Planned", "de": "Geplant", "nl": "Gepland"},
    "in_progress": {"en": "In progress", "de": "In Arbeit", "nl": "Bezig"},
    "completed": {"en": "Completed", "de": "Abgeschlossen", "nl": "Afgerond"},
    "environment": {"en": "Environment", "de": "Umgebung", "nl": "Omgeving"},
    "period": {"en": "Period", "de": "Zeitraum", "nl": "Periode"},
    "scope": {"en": "Scope", "de": "Umfang", "nl": "Scope"},
    "summary": {
        "en": "Summary and findings",
        "de": "Zusammenfassung und Feststellungen",
        "nl": "Samenvatting en bevindingen",
    },
    "results": {"en": "Results", "de": "Ergebnisse", "nl": "Resultaten"},
    "executed": {"en": "Executed tests", "de": "Ausgeführte Tests", "nl": "Uitgevoerde tests"},
    "of": {"en": "of {n} planned", "de": "von {n} geplant", "nl": "van {n} gepland"},
    "success": {"en": "Defense success", "de": "Abwehrerfolg", "nl": "Verdedigingssucces"},
    "success_sub": {
        "en": "blocked or alerted",
        "de": "blockiert oder alarmiert",
        "nl": "geblokkeerd of gealarmeerd",
    },
    "visibility": {"en": "Visibility", "de": "Sichtbarkeit", "nl": "Zichtbaarheid"},
    "visibility_sub": {
        "en": "at least logged",
        "de": "mindestens protokolliert",
        "nl": "minstens gelogd",
    },
    "campaigns": {"en": "Campaigns", "de": "Kampagnen", "nl": "Campagnes"},
    "campaign": {"en": "Campaign", "de": "Kampagne", "nl": "Campagne"},
    "tests": {"en": "Tests", "de": "Tests", "nl": "Tests"},
    "test_cases": {"en": "Test cases", "de": "Testfälle", "nl": "Testgevallen"},
    "techniques": {"en": "ATT&CK", "de": "ATT&CK", "nl": "ATT&CK"},
    "outcome": {"en": "Outcome", "de": "Ergebnis", "nl": "Uitkomst"},
    "red": {"en": "Red team", "de": "Red Team", "nl": "Red team"},
    "blue": {"en": "Blue team", "de": "Blue Team", "nl": "Blue team"},
    "red_status": {"en": "Execution", "de": "Ausführung", "nl": "Uitvoering"},
    "start": {"en": "Attack start", "de": "Angriffsbeginn", "nl": "Start aanval"},
    "stop": {"en": "Attack stop", "de": "Angriffsende", "nl": "Einde aanval"},
    "targets": {"en": "Targets", "de": "Ziele", "nl": "Doelen"},
    "sources": {"en": "Sources", "de": "Quellen", "nl": "Bronnen"},
    "tools": {"en": "Red team tools", "de": "Red-Team-Werkzeuge", "nl": "Red team-tools"},
    "command": {
        "en": "Command / procedure",
        "de": "Befehl / Vorgehen",
        "nl": "Commando / procedure",
    },
    "red_notes": {"en": "Red team notes", "de": "Notizen Red Team", "nl": "Notities red team"},
    "detections": {"en": "Detections", "de": "Erkennungen", "nl": "Detecties"},
    "defense": {"en": "Defense", "de": "Abwehr", "nl": "Verdediging"},
    "alert": {"en": "Alert", "de": "Alarm", "nl": "Alert"},
    "findings": {"en": "Findings", "de": "Feststellungen", "nl": "Bevindingen"},
    "detection_steps": {
        "en": "Detection steps",
        "de": "Erkennungsschritte",
        "nl": "Detectiestappen",
    },
    "prevention_steps": {
        "en": "Prevention steps",
        "de": "Präventionsschritte",
        "nl": "Preventiestappen",
    },
    "planned_r": {"en": "Planned", "de": "Geplant", "nl": "Gepland"},
    "executed_r": {"en": "Executed", "de": "Ausgeführt", "nl": "Uitgevoerd"},
    "not_executed": {"en": "Not executed", "de": "Nicht ausgeführt", "nl": "Niet uitgevoerd"},
    "blocked": {"en": "Blocked", "de": "Blockiert", "nl": "Geblokkeerd"},
    "alerted": {"en": "Alerted", "de": "Alarmiert", "nl": "Gealarmeerd"},
    "logged_central": {
        "en": "Logged (central)",
        "de": "Protokolliert (zentral)",
        "nl": "Gelogd (centraal)",
    },
    "logged_local": {
        "en": "Logged (local only)",
        "de": "Protokolliert (nur lokal)",
        "nl": "Gelogd (alleen lokaal)",
    },
    "none": {"en": "Not detected", "de": "Nicht erkannt", "nl": "Niet gedetecteerd"},
    "not_applicable": {"en": "N/A", "de": "n. z.", "nl": "n.v.t."},
    "tbd": {"en": "TBD", "de": "Offen", "nl": "Open"},
    "mttd": {
        "en": "Mean time to detect",
        "de": "Mittlere Zeit bis zur Erkennung",
        "nl": "Gemiddelde tijd tot detectie",
    },
    "no_tests": {
        "en": "No test cases yet.",
        "de": "Noch keine Testfälle.",
        "nl": "Nog geen testgevallen.",
    },
}


def _duration(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    s = int(seconds)
    if s < 120:
        return f"{s} s"
    if s < 7200:
        return f"{s // 60} min"
    return f"{s // 3600} h {s % 3600 // 60} min"


def build(a: dict, cases: dict[int, dict], lang: str, app_name: str) -> bytes:
    """`a` is the assessment detail of app/api/purple.py, `cases` its test cases by id."""

    def tr(key: str, **kw) -> str:
        entry = TEXTS.get(key)
        text = entry.get(lang, entry["en"]) if entry else key
        return text.format(**kw) if kw else text

    def red_label(s: str) -> str:
        return tr({"planned": "planned_r", "executed": "executed_r"}.get(s, s))

    title = f"{tr('title')} - {a['name']}"
    watermark = None if a["status"] == "completed" else tr("draft")
    pdf = _Pdf(f"{app_name} - {title}", watermark, tr("page"))
    pdf.add_page()
    pdf.set_fill_color(*ACCENT)
    pdf.rect(pdf.l_margin, 14, 14, 1.6, style="F")
    pdf.ln(2)
    pdf.h1(title)
    period = " - ".join(x.isoformat() for x in (a.get("start_date"), a.get("end_date")) if x)
    pdf.kv(
        [
            (tr("status"), tr(a["status"])),
            (tr("environment"), a.get("environment") or ""),
            (tr("period"), period),
        ]
    )
    if a.get("description"):
        pdf.ln(1)
        pdf.md(a["description"])
    if a.get("scope"):
        pdf.h3(tr("scope"))
        pdf.md(a["scope"])

    m = a["metrics"]
    pdf.h2(tr("results"), need=60)
    pdf.tiles(
        [
            (
                tr("executed"),
                str(m["executed"]),
                tr("of", n=m["total"]),
                m["executed"] / m["total"] if m["total"] else None,
            ),
            (tr("success"), pct(m["defense_success"]), tr("success_sub"), m["defense_success"]),
            (tr("visibility"), pct(m["visibility"]), tr("visibility_sub"), m["visibility"]),
        ]
    )
    pdf.table(
        [(tr(o), 25, "R") for o in OUTCOME_ORDER[:5]] + [(tr("mttd"), 54, "R")],
        [
            [str(m["counts"].get(o, 0)) for o in OUTCOME_ORDER[:5]]
            + [_duration(m["mean_time_to_detect"])]
        ],
    )
    if a.get("summary"):
        pdf.h2(tr("summary"), need=30)
        pdf.md(a["summary"])

    pdf.h2(tr("campaigns"), need=40)
    rows = []
    for c in a["campaign_list"]:
        cm = c["metrics"]
        rows.append(
            [
                c["name"],
                f"{cm['executed']}/{cm['total']}",
                cm["defense_success"],
                pct(cm["defense_success"]),
                str(cm["counts"].get("none", 0)),
            ]
        )
    pdf.table(
        [
            (tr("campaign"), 74, "L"),
            (tr("tests"), 22, "R"),
            (tr("success"), 40, "L"),
            ("", 22, "R"),
            (tr("none"), 20, "R"),
        ],
        rows,
        bars={2: (2, (29, 78, 216))},
    )

    for c in a["campaign_list"]:
        pdf.h2(f"{tr('campaign')}: {c['name']}", need=40)
        if c.get("description"):
            pdf.md(c["description"], color=MUTED)
        if not c["test_cases"]:
            pdf.p(tr("no_tests"), color=MUTED)
        for row in c["test_cases"]:
            t = cases[row["id"]]
            pdf.h3(f"{t['name']}  [{tr(t['outcome'])}]")
            pdf.kv(
                [
                    (tr("techniques"), ", ".join(t["techniques"])),
                    (tr("red_status"), red_label(t["red_status"])),
                    (
                        tr("start"),
                        t["attack_start"].strftime("%Y-%m-%d %H:%M UTC")
                        if t["attack_start"]
                        else "",
                    ),
                    (
                        tr("stop"),
                        t["attack_stop"].strftime("%Y-%m-%d %H:%M UTC") if t["attack_stop"] else "",
                    ),
                    (tr("targets"), ", ".join(t["targets"])),
                    (tr("sources"), ", ".join(t["sources"])),
                    (tr("tools"), ", ".join(t["red_tools"])),
                ]
            )
            if t["description"]:
                pdf.md(t["description"], size=9, color=MUTED)
            if t["command"]:
                pdf.p(f"{tr('command')}:", size=9, color=MUTED)
                pdf.p(t["command"][:3000], size=8.5)
            if t["red_notes"]:
                pdf.p(f"{tr('red_notes')}:", size=9, color=MUTED)
                pdf.md(t["red_notes"], size=9)
            if t["detection_list"]:
                pdf.ln(1)
                pdf.table(
                    [(tr("defense"), 70, "L"), (tr("outcome"), 40, "L"), (tr("alert"), 68, "L")],
                    [
                        [
                            (d["rule_code"] + (f" {d['rule_name']}" if d["rule_name"] else ""))
                            if d["kind"] == "rule"
                            else d["tool"],
                            tr(d["outcome"]),
                            d["alert_name"] or d["note"][:80],
                        ]
                        for d in t["detection_list"]
                    ],
                )
            for key in ("detection_steps", "prevention_steps"):
                if t[key]:
                    pdf.p(f"{tr(key)}:", size=9, color=MUTED)
                    pdf.md(t[key], size=9)
            if t["blue_notes"]:
                pdf.p(f"{tr('findings')}:", size=9, color=MUTED)
                pdf.md(t["blue_notes"], size=9)
    return bytes(pdf.output())
