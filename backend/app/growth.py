"""Risk-based prioritisation: risk level and target implementation per rule (PLAN 2.11)."""

from dataclasses import dataclass

from app.models import L3UseCase

DEFAULT_RISK_TARGETS = {1: 0.4, 2: 0.5, 3: 0.6, 4: 0.75, 5: 0.9}


def parse_risk_targets(raw: str) -> dict[int, float]:
    """ "1=0.4,2=0.5,..." -> {1: 0.4, ...}; levels that are missing or invalid keep the default."""
    out = dict(DEFAULT_RISK_TARGETS)
    for part in raw.split(","):
        k, _, v = part.partition("=")
        try:
            level, target = int(k.strip()), float(v.strip())
        except ValueError:
            continue
        if 1 <= level <= 5 and 0 <= target <= 1:
            out[level] = target
    return out


@dataclass
class Effective:
    risk: int | None
    risk_source: str | None  # rule | l2
    target: float | None
    target_source: str | None  # rule | l2 | risk
    gap: float | None  # target - implementation, never below 0
    priority: float | None  # potential x risk / 5: what is gained by working on this rule


def effective(rule: L3UseCase, targets: dict[int, float], potential: float | None) -> Effective:
    l2 = rule.parent
    if rule.risk_level is not None:
        risk, rsrc = rule.risk_level, "rule"
    elif l2.risk_level is not None:
        risk, rsrc = l2.risk_level, "l2"
    else:
        risk, rsrc = None, None
    if rule.target_implementation is not None:
        target, tsrc = rule.target_implementation, "rule"
    elif l2.target_implementation is not None:
        target, tsrc = l2.target_implementation, "l2"
    elif risk is not None:
        target, tsrc = targets[risk], "risk"
    else:
        target, tsrc = None, None
    gap = None
    if target is not None and rule.implementation is not None:
        gap = round(max(0.0, target - rule.implementation), 4)
    elif target is not None:
        gap = target
    priority = None
    if risk is not None and potential is not None:
        priority = round(potential * risk / 5, 4)
    return Effective(risk, rsrc, target, tsrc, gap, priority)
