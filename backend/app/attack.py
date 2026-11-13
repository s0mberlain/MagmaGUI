"""MITRE ATT&CK data, remapping of outdated technique IDs and coverage (PLAN 2.14).

The catalogue comes from 2017 and uses technique IDs that MITRE later revoked or split into
sub-techniques (e.g. T1086 PowerShell is now T1059.001). `app/attack_data/enterprise.json` holds
the current techniques, the revoked -> replacement map and the deprecated IDs.
"""

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "attack_data" / "enterprise.json"


@lru_cache
def data() -> dict:
    return json.loads(DATA.read_text())


def status(tid: str) -> tuple[str, str | None]:
    """('current', tid) | ('revoked', replacement) | ('deprecated', None) | ('unknown', None)."""
    d = data()
    if tid in d["techniques"]:
        return "current", tid
    if tid in d["revoked"]:
        return "revoked", d["revoked"][tid]
    if tid in d["deprecated"]:
        return "deprecated", None
    return "unknown", None


def resolve(tid: str) -> str | None:
    """The current technique an ID stands for, or None (deprecated or unknown)."""
    st, new = status(tid)
    return new if st in ("current", "revoked") else None


def remap(ids: list[str]) -> list[str]:
    """Replace revoked IDs by their successors; keep deprecated/unknown ones; no duplicates."""
    out = []
    for t in ids:
        st, new = status(t)
        out.append(new if st == "revoked" else t)
    return list(dict.fromkeys(out))


def name(tid: str) -> str | None:
    d = data()
    if tid in d["techniques"]:
        return d["techniques"][tid]["name"]
    return d["deprecated"].get(tid)


def parent(tid: str) -> str:
    return tid.split(".")[0]


@dataclass
class Hit:
    code: str
    name: str
    weight: float | None  # None = rule not scored (not operational or not assessed)
    direct: bool = True  # False = counted for the parent through a sub-technique


@dataclass
class Cell:
    id: str
    name: str
    rules: list[Hit] = field(default_factory=list)

    @property
    def best(self) -> float | None:
        ws = [h.weight for h in self.rules if h.weight is not None]
        return max(ws) if ws else None
