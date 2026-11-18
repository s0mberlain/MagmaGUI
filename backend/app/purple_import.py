"""Imports into the purple team library (test procedures and campaign templates).

Formats:
- ``atomic``: Atomic Red Team YAML, a technique file (``atomics/T1003/T1003.yaml``, with
  ``atomic_tests``) or the full ``atomics/Indexes/index.yaml`` (tactic -> technique -> tests).
  The bundled offline index (app/attack_data/atomics.json) uses the same conversion.
- ``vectr_tsi``: an SRA / VECTR Threat Simulation Index YAML (github.com/SecurityRiskAdvisors/
  indexes): ``metadata.bundle`` plus one key per campaign holding its tests (name, description,
  platforms, prerequisites, guidance, block, detect, controls, metadata.tid/tactic/id/x_tools).
  Each campaign becomes a campaign template.
- ``csv``: the test case CSV this app exports (columns Campaign, Test case, Techniques, Tactic,
  Command, Tags; Description and Operator guidance optional).

Every parser returns the same neutral shape (`Parsed`); app/api/purple_library.py previews it
and applies it.
"""

import csv
import io
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from app import attack

ATOMICS = Path(__file__).parent / "attack_data" / "atomics.json"
MAX_TEMPLATES = 5000
_TID = re.compile(r"^T\d{4}(\.\d{3})?$")


class ImportFormatError(ValueError):
    pass


@dataclass
class Parsed:
    bundle: str = ""
    templates: list[dict] = field(default_factory=list)
    # [{"name", "description", "refs": [source_ref or name of the templates, in order]}]
    campaigns: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _s(v, limit: int = 20_000) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        v = "\n".join(str(x) for x in v if x not in (None, ""))
    return str(v).strip()[:limit]


def _list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = [v]
    out = []
    for x in v:
        x = str(x).strip()[:255] if x is not None else ""
        if x and x not in out:
            out.append(x)
    return out


def _bullets(v) -> str:
    items = [x for x in _list(v) if x and x != "''"]
    return "\n".join(f"- {x}" for x in items)


def _techniques(*ids) -> list[str]:
    out = []
    for raw in ids:
        for tid in _list(raw):
            tid = tid.upper()
            if _TID.match(tid) and attack.status(tid)[0] != "unknown" and tid not in out:
                out.append(tid)
    return out


def _tactic_short(value: str, techniques: list[str]) -> str:
    """ATT&CK tactic short name from a TA id, a short or display name, or the technique."""
    tactics = attack.data()["tactics"]
    v = (value or "").strip()
    for t in tactics:
        if v and v.lower() in (t["id"].lower(), t["short"], t["name"].lower()):
            return t["short"]
    v = v.lower().replace(" ", "-")
    if any(t["short"] == v for t in tactics):
        return v
    for tid in techniques:
        tech = attack.data()["techniques"].get(attack.resolve(tid) or tid)
        if tech and tech.get("tactics"):
            return tech["tactics"][0]
    return ""


def _fill(text: str, inputs: dict[str, str]) -> str:
    for k, v in inputs.items():
        text = text.replace("#{" + k + "}", v)
    return text


def atomic_template(t: dict) -> dict:
    """A library template from one (compact) Atomic Red Team test."""
    inputs = {str(k): str(v) for k, v in (t.get("inputs") or {}).items()}
    tech = _techniques(t.get("technique"))
    guidance = []
    if t.get("elevation"):
        guidance.append("Requires administrator / root privileges.")
    if inputs:
        guidance.append("Input arguments (defaults filled in):")
        guidance += [f"- `{k}` = `{v}`" for k, v in inputs.items()]
    tactics = t.get("tactics") or []
    return {
        "name": _s(t.get("name"), 255) or _s(t.get("guid"), 255),
        "description": _s(t.get("description")),
        "techniques": tech,
        "tactic": _tactic_short(tactics[0] if tactics else "", tech),
        "platforms": _list(t.get("platforms")),
        "executor": _s(t.get("executor"), 64),
        "command": _fill(_s(t.get("command")), inputs),
        "cleanup": _fill(_s(t.get("cleanup")), inputs),
        "operator_guidance": "\n".join(guidance),
        "expected_defenses": [],
        "detection_steps": "",
        "prevention_steps": "",
        "references": [
            f"https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/{t.get('technique')}/{t.get('technique')}.md"
        ]
        if t.get("technique")
        else [],
        "tags": ["atomic-red-team"],
        "source": "atomic",
        "source_ref": _s(t.get("guid"), 128),
    }


def _compact_atomic(tid: str, test: dict, tactic: str = "", tech_name: str = "") -> dict:
    ex = test.get("executor") or {}
    return {
        "guid": test.get("auto_generated_guid") or "",
        "technique": tid,
        "technique_name": tech_name,
        "tactics": [tactic] if tactic else [],
        "name": test.get("name") or "",
        "description": test.get("description") or "",
        "platforms": test.get("supported_platforms") or [],
        "executor": ex.get("name", ""),
        "elevation": bool(ex.get("elevation_required")),
        "command": ex.get("command") or ex.get("steps") or "",
        "cleanup": ex.get("cleanup_command") or "",
        "inputs": {
            k: str((v or {}).get("default", ""))
            for k, v in (test.get("input_arguments") or {}).items()
        },
    }


def parse_atomic(doc) -> Parsed:
    p = Parsed(bundle="Atomic Red Team")
    tests: list[dict] = []
    if isinstance(doc, dict) and "atomic_tests" in doc:
        tid = str(doc.get("attack_technique") or "").upper()
        for t in doc.get("atomic_tests") or []:
            if isinstance(t, dict):
                tests.append(_compact_atomic(tid, t, tech_name=doc.get("display_name", "")))
    elif isinstance(doc, dict):
        seen = set()
        for tactic, techniques in doc.items():
            if not isinstance(techniques, dict):
                continue
            for tid, entry in techniques.items():
                if not isinstance(entry, dict):
                    continue
                for t in entry.get("atomic_tests") or []:
                    if isinstance(t, dict) and t.get("auto_generated_guid") not in seen:
                        seen.add(t.get("auto_generated_guid"))
                        tests.append(_compact_atomic(str(tid).upper(), t, str(tactic)))
    else:
        raise ImportFormatError("This is not an Atomic Red Team YAML file")
    if not tests:
        raise ImportFormatError("No atomic tests found in the file")
    for t in tests:
        tpl = atomic_template(t)
        if not tpl["techniques"]:
            p.errors.append(f"{tpl['name']}: unknown ATT&CK technique {t['technique']}")
        p.templates.append(tpl)
    return p


def parse_tsi(doc) -> Parsed:
    if not isinstance(doc, dict):
        raise ImportFormatError("This is not a Threat Simulation Index YAML file")
    meta = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    p = Parsed(bundle=_s(meta.get("bundle"), 200) or "Threat Simulation Index")
    for campaign, tests in doc.items():
        if campaign == "metadata" or not isinstance(tests, list):
            continue
        refs = []
        for t in tests:
            if not isinstance(t, dict) or not t.get("name"):
                continue
            m = t.get("metadata") if isinstance(t.get("metadata"), dict) else {}
            tech = _techniques(m.get("tid"))
            prereq = _list(t.get("prerequisites"))
            guidance = _list(t.get("guidance"))
            ref = _s(m.get("x_vectr_id") or m.get("id"), 128) or _s(t["name"], 128)
            p.templates.append(
                {
                    "name": _s(t["name"], 255),
                    "description": _s(t.get("description")),
                    "techniques": tech,
                    "tactic": _tactic_short(_s(m.get("tactic")) or str(campaign), tech),
                    "platforms": _list(t.get("platforms")),
                    "executor": "manual",
                    "command": "\n".join(guidance),
                    "cleanup": "",
                    "operator_guidance": ("Prerequisites: " + ", ".join(prereq) if prereq else ""),
                    "expected_defenses": _list(t.get("controls")),
                    "detection_steps": _bullets(t.get("detect")),
                    "prevention_steps": _bullets(t.get("block")),
                    "references": _list(m.get("x_tools")),
                    "tags": [x for x in (_s(meta.get("prefix"), 64),) if x],
                    "source": "vectr",
                    "source_ref": ref,
                }
            )
            if not tech and m.get("tid"):
                p.errors.append(f"{t['name']}: unknown ATT&CK technique {m.get('tid')}")
            refs.append(ref)
        if refs:
            p.campaigns.append(
                {"name": f"{p.bundle}: {campaign}"[:255], "description": "", "refs": refs}
            )
    if not p.templates:
        raise ImportFormatError("No test cases found in the file")
    return p


def _col(header: list[str], *names: str) -> int | None:
    low = [h.strip().lower() for h in header]
    for n in names:
        if n in low:
            return low.index(n)
    return None


def parse_csv(text: str) -> Parsed:
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        raise ImportFormatError("The file is empty")
    header = rows[0]
    c_name = _col(header, "test case", "name", "test")
    if c_name is None:
        raise ImportFormatError("The CSV needs a column named Test case")
    cols = {
        "campaign": _col(header, "campaign"),
        "techniques": _col(header, "techniques", "technique", "mitre id", "attack id"),
        "tactic": _col(header, "tactic", "phase"),
        "command": _col(header, "command"),
        "tags": _col(header, "tags"),
        "description": _col(header, "description"),
        "guidance": _col(header, "operator guidance", "guidance"),
    }

    def cell(row, key):
        i = cols[key] if key in cols else None
        if i is None or i >= len(row):
            return ""
        v = row[i]
        return v[1:] if v.startswith("'") and v[1:2] in ("=", "+", "-", "@") else v

    p = Parsed(bundle="CSV")
    campaigns: dict[str, list[str]] = {}
    for n, row in enumerate(rows[1:], start=2):
        if c_name >= len(row) or not row[c_name].strip():
            continue
        name = row[c_name].strip()[:255]
        raw_tech = re.split(r"[\s,;]+", cell(row, "techniques"))
        tech = _techniques(*[x for x in raw_tech if x])
        bad = [x for x in raw_tech if x and x.upper() not in tech]
        if bad:
            p.errors.append(f"Row {n}: unknown ATT&CK technique {', '.join(bad)}")
        p.templates.append(
            {
                "name": name,
                "description": _s(cell(row, "description")),
                "techniques": tech,
                "tactic": _tactic_short(cell(row, "tactic"), tech),
                "platforms": [],
                "executor": "",
                "command": _s(cell(row, "command")),
                "cleanup": "",
                "operator_guidance": _s(cell(row, "guidance")),
                "expected_defenses": [],
                "detection_steps": "",
                "prevention_steps": "",
                "references": [],
                "tags": _list([x.strip() for x in cell(row, "tags").split(",")]),
                "source": "csv",
                "source_ref": "",
            }
        )
        camp = cell(row, "campaign").strip()
        if camp:
            campaigns.setdefault(camp[:255], []).append(name)
    p.campaigns = [{"name": k, "description": "", "refs": v} for k, v in campaigns.items()]
    if not p.templates:
        raise ImportFormatError("No test cases found in the file")
    return p


def parse(fmt: str, data: bytes) -> Parsed:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportFormatError("The file is not UTF-8 text") from None
    if fmt == "csv":
        p = parse_csv(text)
    else:
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as e:
            raise ImportFormatError(f"The file is not valid YAML: {e}") from None
        p = parse_atomic(doc) if fmt == "atomic" else parse_tsi(doc)
    if len(p.templates) > MAX_TEMPLATES:
        raise ImportFormatError(f"At most {MAX_TEMPLATES} test procedures per import")
    return p


@lru_cache
def atomics() -> dict:
    """The bundled Atomic Red Team index (scripts/build_atomics.py)."""
    if not ATOMICS.exists():  # pragma: no cover
        return {"tests": [], "commit": "", "source": ""}
    return json.loads(ATOMICS.read_text())


def atomic(guid: str) -> dict | None:
    return next((t for t in atomics()["tests"] if t["guid"] == guid), None)
