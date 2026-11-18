"""Build app/attack_data/atomics.json, the offline Atomic Red Team index of the purple team
library, from Atomic Red Team's atomics/Indexes/index.yaml.

    python scripts/build_atomics.py path/to/index.yaml [commit]

Atomic Red Team (https://github.com/redcanaryco/atomic-red-team) is (c) Red Canary, MIT
license; the notice is kept in app/attack_data/ATOMIC-RED-TEAM-LICENSE.txt.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

OUT = Path(__file__).resolve().parents[1] / "app" / "attack_data" / "atomics.json"


def build(index: dict, commit: str = "") -> dict:
    tests = {}
    for tactic, techniques in (index or {}).items():
        for tid, entry in (techniques or {}).items():
            for t in entry.get("atomic_tests") or []:
                guid = t.get("auto_generated_guid")
                if not guid:
                    continue
                ex = t.get("executor") or {}
                cur = tests.get(guid)
                if cur is not None:
                    if tactic not in cur["tactics"]:
                        cur["tactics"].append(tactic)
                    continue
                tests[guid] = {
                    "guid": guid,
                    "technique": tid,
                    "technique_name": (entry.get("technique") or {}).get("name", ""),
                    "tactics": [tactic],
                    "name": (t.get("name") or "").strip(),
                    "description": (t.get("description") or "").strip(),
                    "platforms": list(t.get("supported_platforms") or []),
                    "executor": ex.get("name", ""),
                    "elevation": bool(ex.get("elevation_required")),
                    "command": (ex.get("command") or ex.get("steps") or "").strip(),
                    "cleanup": (ex.get("cleanup_command") or "").strip(),
                    "inputs": {
                        k: str((v or {}).get("default", ""))
                        for k, v in (t.get("input_arguments") or {}).items()
                    },
                }
    items = sorted(tests.values(), key=lambda x: (x["technique"], x["name"]))
    return {
        "source": "https://github.com/redcanaryco/atomic-red-team",
        "commit": commit,
        "built": datetime.now(UTC).date().isoformat(),
        "tests": items,
    }


if __name__ == "__main__":
    src = Path(sys.argv[1])
    data = build(yaml.safe_load(src.read_text()), sys.argv[2] if len(sys.argv) > 2 else "")
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"{len(data['tests'])} atomic tests -> {OUT} ({OUT.stat().st_size // 1024} KB)")
