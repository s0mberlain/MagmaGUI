import random
from datetime import date

import pytest

from app.models import Lifecycle
from app.scoring import L1Input, L2Input, RuleInput, compute

OP = Lifecycle.operational
TODAY = date(2026, 11, 13)


def rule(code, e, i, c, status=OP, verified=None, interval=None):
    return RuleInput(code, code.rsplit("-", 1)[0], status, e, i, c, verified, interval)


def test_rule_weight_and_potential():
    r = compute(
        [L1Input("AO")], [L2Input("AO-CRE", "AO")], [rule("AO-CRE-01", 0.9, 0.8, 0.7)], TODAY
    )
    s = r.rules["AO-CRE-01"]
    assert s.weight == pytest.approx(0.504)
    assert s.potential == pytest.approx(0.396)
    assert s.scored and s.assessed


def test_unassessed_and_non_operational_rules_are_ignored():
    rules = [
        rule("AO-CRE-01", 1.0, 1.0, 1.0),
        rule("AO-CRE-02", None, 0.5, 0.5),  # not assessed
        rule("AO-CRE-03", 0.0, 0.0, 0.0, status=Lifecycle.onboarding),  # not scored
        rule("AO-CRE-04", 0.0, 0.0, 0.0, status=Lifecycle.retired),
    ]
    r = compute([L1Input("AO")], [L2Input("AO-CRE", "AO")], rules, TODAY)
    assert r.l2["AO-CRE"].weight == pytest.approx(1.0)
    assert r.l2["AO-CRE"].scored_rules == 1
    assert r.rules["AO-CRE-03"].weight == 0.0 and not r.rules["AO-CRE-03"].scored
    # active = 01, 02, 03 (retired excluded); assessed = 01, 03
    assert r.kpis.assessment_coverage == pytest.approx(2 / 3)


def test_empty_l2_is_a_gap_not_a_zero():
    l2s = [L2Input("AO-CRE", "AO"), L2Input("AO-EXF", "AO")]
    r = compute([L1Input("AO")], l2s, [rule("AO-CRE-01", 0.5, 0.5, 0.5)], TODAY)
    assert r.l2["AO-EXF"].weight is None
    assert r.l1["AO"].weight == pytest.approx(0.125)  # Excel would give 0.0625
    assert r.kpis.framework_completeness == pytest.approx(0.5)


def test_l1_averages_l2s_equally():
    l2s = [L2Input("AO-CRE", "AO"), L2Input("AO-PER", "AO")]
    rules = [rule("AO-CRE-01", 1, 1, 1)] + [
        rule(f"AO-PER-{n:02d}", 0.5, 1, 1) for n in range(1, 11)
    ]
    r = compute([L1Input("AO")], l2s, rules, TODAY)
    assert r.l1["AO"].weight == pytest.approx(0.75)  # not dominated by the 10 PER rules


def test_overall_kpis_and_not_applicable_l1():
    l1s = [L1Input("AO"), L1Input("CC"), L1Input("WE", applicable=False), L1Input("RE")]
    l2s = [L2Input("AO-CRE", "AO"), L2Input("CC-SNC", "CC"), L2Input("RE-POS", "RE")]
    rules = [rule("AO-CRE-01", 0.8, 1, 1), rule("CC-SNC-01", 0.4, 1, 1)]
    r = compute(l1s, l2s, rules, TODAY)
    assert r.overall.weight == pytest.approx(0.6)
    k = r.kpis
    assert k.soc_detection_score == pytest.approx(0.6)
    assert k.detection_gap == pytest.approx(0.4)
    assert k.growth_potential == pytest.approx(0.0)
    assert (k.l2_with_scored_rules, k.applicable_l2) == (2, 3)
    assert r.l1["RE"].weight is None


def test_verification_due_and_health():
    rules = [
        rule("AO-CRE-01", 1, 1, 1, verified=date(2026, 10, 1)),  # within 180 days
        rule("AO-CRE-02", 1, 1, 1, verified=date(2026, 1, 1)),  # overdue
        rule("AO-CRE-03", 1, 1, 1),  # never verified
        rule("AO-CRE-04", 1, 1, 1, verified=date(2026, 10, 1), interval=30),  # overdue by override
        rule("AO-CRE-05", 1, 1, 1, status=Lifecycle.onboarding),  # not counted
    ]
    r = compute([L1Input("AO")], [L2Input("AO-CRE", "AO")], rules, TODAY)
    assert r.rules["AO-CRE-01"].verification_due == date(2027, 3, 30)
    assert [c for c, s in r.rules.items() if s.verification_overdue] == [
        "AO-CRE-02",
        "AO-CRE-03",
        "AO-CRE-04",
    ]
    assert r.kpis.verification_health == pytest.approx(0.25)
    assert r.rules["AO-CRE-05"].verification_due is None


def test_empty_catalogue():
    r = compute([L1Input("AO")], [], [], TODAY)
    assert r.kpis.soc_detection_score is None
    assert r.kpis.detection_gap is None
    assert r.kpis.framework_completeness is None


def test_random_properties():
    rnd = random.Random(7)
    l1s = [L1Input(c) for c in ("AA", "BB", "CC")]
    l2s = [L2Input(f"{l1.code}-X{n:02d}", l1.code) for l1 in l1s for n in range(5)]
    rules = []
    for l2 in l2s:
        for n in range(rnd.randint(0, 6)):
            vals = [rnd.choice([None, rnd.random()]) for _ in range(3)]
            rules.append(rule(f"{l2.code}-{n:02d}", *vals, status=rnd.choice(list(Lifecycle))))
    r = compute(l1s, l2s, rules, TODAY)
    for group in [*r.rules.values(), *r.l2.values(), *r.l1.values(), r.overall]:
        for m in ("effectiveness", "implementation", "coverage", "weight", "potential"):
            v = getattr(group, m)
            assert v is None or 0 <= v <= 1
        if group.weight is not None:
            assert group.potential <= group.effectiveness + 1e-9


def test_catalogue_coverage_counts_empty_l2_as_zero():
    """One perfect rule in one of four L2s: the SOC score says 100 %, the catalogue coverage
    (the rule driver coverage uses) says 25 %."""
    l2s = [L2Input(c, "AO") for c in ("AO-AAA", "AO-BBB", "AO-CCC", "AO-DDD")]
    r = compute([L1Input("AO")], l2s, [rule("AO-AAA-01", 1.0, 1.0, 1.0)], TODAY)
    assert r.kpis.soc_detection_score == pytest.approx(1.0)
    assert r.kpis.catalogue_coverage == pytest.approx(0.25)
    empty = compute([L1Input("AO")], [], [], TODAY)
    assert empty.kpis.catalogue_coverage is None
