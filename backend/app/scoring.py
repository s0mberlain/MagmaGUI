"""Scoring engine (docs/PLAN.md section 2.5).

Per rule (L3), from the Excel tool:
    weight    = effectiveness × implementation × coverage   (all 0..1)
    potential = effectiveness − weight

Aggregation, without the Excel quirks:
- A rule counts ("scored") only when all three metrics are set AND its lifecycle status is
  operational or maintenance. Other rules are shown but left out of every average.
- L2 = plain average over its scored rules; None when it has none (a detection gap).
- L1 = average over its L2s that have a score; every threat counts equally.
- Overall = average over applicable L1s that have a score.
- SOC detection score = average weight, growth potential = average potential,
  detection gap = 1 − SOC detection score.

The module is pure (no database access) so it can be tested directly.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models import Lifecycle

SCORED_STATES = frozenset({Lifecycle.operational, Lifecycle.maintenance})
ACTIVE_STATES = frozenset({Lifecycle.onboarding, Lifecycle.operational, Lifecycle.maintenance})
METRICS = ("effectiveness", "implementation", "coverage", "weight", "potential")


@dataclass(frozen=True)
class RuleInput:
    code: str
    l2_code: str
    status: Lifecycle
    effectiveness: float | None
    implementation: float | None
    coverage: float | None
    last_verified_at: date | None = None
    verification_interval_days: int | None = None


@dataclass(frozen=True)
class L2Input:
    code: str
    l1_code: str


@dataclass(frozen=True)
class L1Input:
    code: str
    applicable: bool = True


@dataclass
class Scores:
    effectiveness: float | None = None
    implementation: float | None = None
    coverage: float | None = None
    weight: float | None = None
    potential: float | None = None

    def as_dict(self) -> dict[str, float | None]:
        return {m: getattr(self, m) for m in METRICS}


@dataclass
class RuleScore(Scores):
    assessed: bool = False
    scored: bool = False
    verification_due: date | None = None
    verification_overdue: bool = False


@dataclass
class GroupScore(Scores):
    code: str = ""
    rules: int = 0
    scored_rules: int = 0
    children: int = 0
    scored_children: int = 0


@dataclass
class Kpis:
    soc_detection_score: float | None
    growth_potential: float | None
    detection_gap: float | None
    framework_completeness: float | None
    l2_with_scored_rules: int
    applicable_l2: int
    assessment_coverage: float | None
    assessed_rules: int
    active_rules: int
    verification_health: float | None
    verified_in_time: int
    verification_overdue: int
    operational_rules: int


@dataclass
class Result:
    rules: dict[str, RuleScore] = field(default_factory=dict)
    l2: dict[str, GroupScore] = field(default_factory=dict)
    l1: dict[str, GroupScore] = field(default_factory=dict)
    overall: Scores = field(default_factory=Scores)
    kpis: Kpis | None = None


def _avg(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def _average_scores(items: list[Scores]) -> Scores:
    return Scores(**{m: _avg(getattr(i, m) for i in items) for m in METRICS})


def score_rule(rule: RuleInput, today: date, default_interval: int) -> RuleScore:
    e, i, c = rule.effectiveness, rule.implementation, rule.coverage
    assessed = e is not None and i is not None and c is not None
    out = RuleScore(effectiveness=e, implementation=i, coverage=c, assessed=assessed)
    if assessed:
        out.weight = e * i * c
        out.potential = e - out.weight
    out.scored = assessed and rule.status in SCORED_STATES
    if rule.status in SCORED_STATES:
        interval = rule.verification_interval_days or default_interval
        if rule.last_verified_at:
            out.verification_due = rule.last_verified_at + timedelta(days=interval)
            out.verification_overdue = out.verification_due < today
        else:
            out.verification_overdue = True  # never verified
    return out


def compute(
    l1s: list[L1Input],
    l2s: list[L2Input],
    rules: list[RuleInput],
    today: date,
    default_interval: int = 180,
) -> Result:
    res = Result()
    for r in rules:
        res.rules[r.code] = score_rule(r, today, default_interval)

    rules_by_l2: dict[str, list[str]] = {}
    for r in rules:
        rules_by_l2.setdefault(r.l2_code, []).append(r.code)

    for l2 in l2s:
        codes = rules_by_l2.get(l2.code, [])
        scored = [res.rules[c] for c in codes if res.rules[c].scored]
        g = GroupScore(code=l2.code, rules=len(codes), scored_rules=len(scored))
        if scored:
            for m, v in _average_scores(scored).as_dict().items():
                setattr(g, m, v)
        res.l2[l2.code] = g

    l2_by_l1: dict[str, list[str]] = {}
    for l2 in l2s:
        l2_by_l1.setdefault(l2.l1_code, []).append(l2.code)

    for l1 in l1s:
        children = [res.l2[c] for c in l2_by_l1.get(l1.code, [])]
        with_score = [c for c in children if c.weight is not None]
        g = GroupScore(
            code=l1.code,
            rules=sum(c.rules for c in children),
            scored_rules=sum(c.scored_rules for c in children),
            children=len(children),
            scored_children=len(with_score),
        )
        if l1.applicable and with_score:
            for m, v in _average_scores(with_score).as_dict().items():
                setattr(g, m, v)
        res.l1[l1.code] = g

    applicable = {l1.code for l1 in l1s if l1.applicable}
    res.overall = _average_scores([res.l1[c] for c in applicable if res.l1[c].weight is not None])

    applicable_l2 = [l2 for l2 in l2s if l2.l1_code in applicable]
    with_scored = [l2 for l2 in applicable_l2 if res.l2[l2.code].scored_rules > 0]
    active = [r for r in rules if r.status in ACTIVE_STATES]
    assessed = [r for r in active if res.rules[r.code].assessed]
    operational = [r for r in rules if r.status in SCORED_STATES]
    overdue = [r for r in operational if res.rules[r.code].verification_overdue]

    def ratio(a: int, b: int) -> float | None:
        return a / b if b else None

    soc = res.overall.weight
    res.kpis = Kpis(
        soc_detection_score=soc,
        growth_potential=res.overall.potential,
        detection_gap=None if soc is None else 1 - soc,
        framework_completeness=ratio(len(with_scored), len(applicable_l2)),
        l2_with_scored_rules=len(with_scored),
        applicable_l2=len(applicable_l2),
        assessment_coverage=ratio(len(assessed), len(active)),
        assessed_rules=len(assessed),
        active_rules=len(active),
        verification_health=ratio(len(operational) - len(overdue), len(operational)),
        verified_in_time=len(operational) - len(overdue),
        verification_overdue=len(overdue),
        operational_rules=len(operational),
    )
    return res
