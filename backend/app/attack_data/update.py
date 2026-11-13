"""Rebuild enterprise.json from MITRE's STIX bundle.

    python -m app.attack_data.update [path-or-url-to-enterprise-attack.json]

Default source: https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json
Keeps only what the app needs: tactics in matrix order, current techniques with their tactics,
revoked IDs with their replacement, and deprecated IDs.
"""

import json
import sys
from pathlib import Path

import httpx

URL = "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json"
OUT = Path(__file__).with_name("enterprise.json")


def _ext(o: dict) -> str | None:
    for r in o.get("external_references", []):
        if r.get("source_name") == "mitre-attack":
            return r.get("external_id")
    return None


def build(bundle: dict) -> dict:
    objs = bundle["objects"]
    by_id = {o["id"]: o for o in objs}
    matrix = next(o for o in objs if o["type"] == "x-mitre-matrix" and not o.get("revoked"))
    tactics = [
        {"id": _ext(by_id[r]), "short": by_id[r]["x_mitre_shortname"], "name": by_id[r]["name"]}
        for r in matrix["tactic_refs"]
    ]
    rev_rel = {
        r["source_ref"]: r["target_ref"]
        for r in objs
        if r["type"] == "relationship" and r["relationship_type"] == "revoked-by"
    }
    techniques, revoked, deprecated = {}, {}, {}
    for o in objs:
        if o["type"] != "attack-pattern" or not (tid := _ext(o)):
            continue
        if o.get("revoked"):
            if target := by_id.get(rev_rel.get(o["id"], "")):
                revoked[tid] = _ext(target)
        elif o.get("x_mitre_deprecated"):
            deprecated[tid] = o["name"]
        else:
            techniques[tid] = {
                "name": o["name"],
                "tactics": [
                    p["phase_name"]
                    for p in o.get("kill_chain_phases", [])
                    if p["kill_chain_name"] == "mitre-attack"
                ],
            }

    def final(t: str) -> str:
        for _ in range(10):
            if t not in revoked:
                break
            t = revoked[t]
        return t

    return {
        "version": matrix.get("modified", "")[:10],
        "source": "MITRE ATT&CK Enterprise, github.com/mitre/cti enterprise-attack.json",
        "tactics": tactics,
        "techniques": dict(sorted(techniques.items())),
        "revoked": {k: final(v) for k, v in sorted(revoked.items())},
        "deprecated": dict(sorted(deprecated.items())),
    }


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else URL
    if src.startswith("http"):
        bundle = httpx.get(src, timeout=120, follow_redirects=True).raise_for_status().json()
    else:
        bundle = json.loads(Path(src).read_text())
    data = build(bundle)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(
        f"ATT&CK {data['version']}: {len(data['techniques'])} techniques, "
        f"{len(data['revoked'])} revoked"
    )


if __name__ == "__main__":
    main()
