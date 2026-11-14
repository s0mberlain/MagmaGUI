"""Thin SIEM integration (PLAN section 3: no live connector, an API the SIEM side pushes to).

A SIEM (or a small script next to it) pushes two kinds of data with an API token:

- its **rule inventory**: which detection rules exist, enabled or not, with ATT&CK techniques.
  The app compares it with the L3 rules (linked through `L3UseCase.siem_rule_ids`) and shows
  SIEM rules without a use case, use cases whose SIEM rule is missing or disabled, and
  suggestions by matching ATT&CK techniques.
- **alert counts** per SIEM rule and month: stored as output metrics (PLAN 2.13) of every L3
  rule linked to that SIEM rule, either replacing the month or adding to it (daily pushes).

A SIEM rule is matched to an L3 rule by one of the rule's `siem_rule_ids` or by the L3 code
itself, so a SIEM rule named like `AO-CRE-01 Credential dumping` can also use the code as id.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    L3UseCase,
    Lifecycle,
    OutputMetric,
    SiemAlertBatch,
    SiemRule,
    SiemSource,
)

SOURCE_RE = r"^[a-z0-9][a-z0-9_.-]{0,31}$"


def source(db: Session, name: str, create: bool = True) -> SiemSource | None:
    s = db.scalar(select(SiemSource).where(SiemSource.name == name))
    if s is None and create:
        s = SiemSource(name=name, alerts_report={})
        db.add(s)
        db.flush()
    return s


def rule_index(db: Session) -> dict[str, list[L3UseCase]]:
    """SIEM rule id (case-insensitive) or L3 code -> L3 rules."""
    idx: dict[str, list[L3UseCase]] = defaultdict(list)
    for r in db.scalars(select(L3UseCase)):
        idx[r.code.lower()].append(r)
        for sid in r.siem_rule_ids or []:
            if r not in idx[sid.lower()]:
                idx[sid.lower()].append(r)
    return idx


# ---------------------------------------------------------------- rule inventory


def replace_inventory(db: Session, src: SiemSource, rules: list[dict], user: str) -> int:
    """Replace the source's inventory with the pushed list (a full snapshot each time)."""
    by_id = {r.rule_id: r for r in src.rules}
    seen = set()
    for item in rules:
        rid = item["id"]
        if rid in seen:
            continue
        seen.add(rid)
        row = by_id.get(rid)
        if row is None:
            row = SiemRule(rule_id=rid)
            src.rules.append(row)
        row.name = item.get("name") or ""
        row.enabled = bool(item.get("enabled", True))
        row.severity = item.get("severity") or ""
        row.techniques = list(dict.fromkeys(item.get("techniques") or []))
    for rid, row in by_id.items():
        if rid not in seen:
            src.rules.remove(row)
    src.inventory_at = datetime.now(UTC)
    src.inventory_by = user
    return len(seen)


@dataclass
class Reconciliation:
    source: str
    rules_total: int = 0
    enabled: int = 0
    linked: int = 0
    unlinked: list[dict] = field(default_factory=list)
    disabled_but_operational: list[dict] = field(default_factory=list)


def _base(t: str) -> str:
    return t.split(".")[0]


def reconcile(db: Session) -> tuple[list[Reconciliation], list[dict]]:
    """Per source: SIEM rules without a use case, linked but disabled while operational.
    Overall: L3 SIEM ids that no source reports (missing in the SIEM)."""
    idx = rule_index(db)
    rules = list(db.scalars(select(L3UseCase)))
    by_tech: dict[str, list[L3UseCase]] = defaultdict(list)
    for r in rules:
        for t in r.attack_techniques or []:
            by_tech[_base(t)].append(r)
    known: set[str] = set()
    out = []
    for src in db.scalars(select(SiemSource).order_by(SiemSource.name)):
        rec = Reconciliation(source=src.name, rules_total=len(src.rules))
        for sr in src.rules:
            known.add(sr.rule_id.lower())
            rec.enabled += sr.enabled
            l3s = idx.get(sr.rule_id.lower(), [])
            if l3s:
                rec.linked += 1
                for l3 in l3s:
                    if not sr.enabled and l3.lifecycle_status in (
                        Lifecycle.operational,
                        Lifecycle.maintenance,
                    ):
                        rec.disabled_but_operational.append(
                            {"rule_id": sr.rule_id, "name": sr.name, "code": l3.code}
                        )
                continue
            suggest: dict[str, int] = defaultdict(int)
            for t in sr.techniques or []:
                for l3 in by_tech.get(_base(t), []):
                    suggest[l3.code] += 2 if t in (l3.attack_techniques or []) else 1
            rec.unlinked.append(
                {
                    "rule_id": sr.rule_id,
                    "name": sr.name,
                    "enabled": sr.enabled,
                    "severity": sr.severity,
                    "techniques": sr.techniques or [],
                    "suggestions": [c for c, _ in sorted(suggest.items(), key=lambda x: -x[1])][:5],
                }
            )
        out.append(rec)
    missing = []
    if out:  # only meaningful once at least one SIEM reported its rules
        for r in rules:
            for sid in r.siem_rule_ids or []:
                if sid.lower() not in known:
                    missing.append(
                        {
                            "code": r.code,
                            "name": r.name,
                            "rule_id": sid,
                            "status": r.lifecycle_status,
                        }
                    )
    return out, missing


# ---------------------------------------------------------------- alert counts


def batch_applied(db: Session, src: SiemSource, batch_id: str) -> bool:
    return (
        db.scalar(
            select(SiemAlertBatch.id).where(
                SiemAlertBatch.source_id == src.id, SiemAlertBatch.batch_id == batch_id
            )
        )
        is not None
    )


def mark_batch(db: Session, src: SiemSource, batch_id: str, user: str) -> None:
    db.add(SiemAlertBatch(source_id=src.id, batch_id=batch_id, applied_by=user))


@dataclass
class AlertReport:
    created: int = 0
    updated: int = 0
    matched: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def push_alerts(
    db: Session, src: SiemSource, items: list[dict], mode: str, user: str, dry_run: bool
) -> AlertReport:
    """items: {rule, period (first of month), alerts, incidents, false_positives,
    false_negatives}. Several items for the same rule and month are summed first."""
    idx = rule_index(db)
    rep = AlertReport()
    sums: dict[tuple[str, date], dict] = {}
    shown: dict[str, str] = {}  # ids match case-insensitively; report them as first sent
    for it in items:
        rid = shown.setdefault(it["rule"].lower(), it["rule"])
        key = (rid, it["period"])
        acc = sums.setdefault(
            key, {"alerts": 0, "incidents": 0, "false_positives": 0, "false_negatives": None}
        )
        for k in ("alerts", "incidents", "false_positives"):
            acc[k] += it.get(k) or 0
        if it.get("false_negatives") is not None:
            acc["false_negatives"] = (acc["false_negatives"] or 0) + it["false_negatives"]

    # Several SIEM rules can belong to one use case rule: add their counts up per rule and month
    # first, otherwise "replace" would keep only the last one.
    matched, unmatched = set(), set()
    per_rule: dict[tuple[int, date], dict] = {}
    targets: dict[int, L3UseCase] = {}
    labels: dict[tuple[int, date], list[str]] = {}
    for (rid, period), vals in sums.items():
        l3s = idx.get(rid.lower())
        if not l3s:
            unmatched.add(rid)
            continue
        matched.add(rid)
        for l3 in l3s:
            targets[l3.id] = l3
            labels.setdefault((l3.id, period), []).append(rid)
            acc = per_rule.setdefault(
                (l3.id, period),
                {"alerts": 0, "incidents": 0, "false_positives": 0, "false_negatives": None},
            )
            for k in ("alerts", "incidents", "false_positives"):
                acc[k] += vals[k]
            if vals["false_negatives"] is not None:
                acc["false_negatives"] = (acc["false_negatives"] or 0) + vals["false_negatives"]

    for (l3_id, period), new in per_rule.items():
        l3 = targets[l3_id]
        rid = ", ".join(labels[(l3_id, period)])
        m = db.scalar(
            select(OutputMetric).where(OutputMetric.l3_id == l3.id, OutputMetric.period == period)
        )
        if m is not None and mode == "add":
            new["alerts"] += m.alerts
            new["incidents"] += m.incidents
            new["false_positives"] += m.false_positives
            if m.false_negatives is not None or new["false_negatives"] is not None:
                new["false_negatives"] = (m.false_negatives or 0) + (new["false_negatives"] or 0)
        if new["false_positives"] > new["alerts"]:
            rep.errors.append(
                f"{rid} {period:%Y-%m}: false positives ({new['false_positives']}) "
                f"exceed alerts ({new['alerts']})"
            )
            continue
        if m is None:
            rep.created += 1
            if dry_run:
                continue
            m = OutputMetric(l3_id=l3.id, period=period, note="")
            db.add(m)
        else:
            rep.updated += 1
            if dry_run:
                continue
        m.alerts, m.incidents = new["alerts"], new["incidents"]
        m.false_positives, m.false_negatives = new["false_positives"], new["false_negatives"]
        m.source, m.updated_by = "siem", user
        if not m.note:
            m.note = f"from {src.name}"
    rep.matched = sorted(matched)
    rep.unmatched = sorted(unmatched)
    if not dry_run:
        src.alerts_at = datetime.now(UTC)
        src.alerts_by = user
        src.alerts_report = {
            "created": rep.created,
            "updated": rep.updated,
            "matched": len(rep.matched),
            "unmatched": rep.unmatched[:200],
            "errors": rep.errors[:50],
        }
    return rep
