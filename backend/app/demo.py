"""Reproducible random demo data on top of the MaGMa catalogue (docs/PLAN.md section 7a).

Usage:
    python -m app.demo --seed 42          (uses DATABASE_URL)
    DEMO_DATA=true on first start         (applied once after seeding the catalogue)
    POST /api/admin/demo-data             (admin, overwrites the use case fields)

Only use case fields are overwritten; the catalogue itself (IDs, names) is kept.
"""

import argparse
import logging
import random
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    BusinessDriver,
    ComplianceDriver,
    ComplianceSource,
    L2UseCase,
    L3UseCase,
    Lifecycle,
    ReferenceItem,
    RefKind,
    Verification,
    VerificationResult,
)

log = logging.getLogger("magma.demo")

# Typical strength of a detection technology: (effectiveness, implementation, coverage) means.
TECH_PROFILE = {
    "SIEM": (0.70, 0.60, 0.60),
    "Big data analytics": (0.60, 0.45, 0.50),
    "NIDS/NIPS": (0.65, 0.65, 0.55),
    "HIPS": (0.75, 0.60, 0.65),
    "Anti-malware": (0.70, 0.80, 0.80),
    "Network anomaly detection": (0.55, 0.45, 0.50),
    "Email protection": (0.75, 0.75, 0.85),
}
DEFAULT_PROFILE = (0.6, 0.55, 0.55)

COMPLIANCE_REFS = {
    "Internal Security Policy": [
        ("ISP-4.1", "Logging"),
        ("ISP-7.2", "Access control"),
        ("ISP-9.3", "Security monitoring"),
    ],
    "External Regulator #1": [
        ("DORA-10", "DORA Art. 10 Detection"),
        ("DORA-17", "DORA Art. 17 ICT incident management"),
    ],
    "External Regulator #2": [("NIS2-21", "NIS2 Art. 21 Risk management measures")],
}

DEMO_MARK = "[demo rule]"
DEMO_RULE_KINDS = [
    "correlation rule",
    "threshold alert",
    "signature match",
    "anomaly baseline",
    "threat intel match",
]

NOTES_OK = [
    "Atomic Red Team test detected as expected",
    "Purple team exercise: alert fired within SLA",
    "Quarterly check, rule logic and data feed OK",
    "Replayed sample logs, alert raised",
]
NOTES_ISSUES = [
    "Missed one test variant, rule tuned afterwards",
    "Data source gap found on two hosts, ticket opened",
    "Too many false positives, threshold adjusted",
]


def _metric(rnd: random.Random, mean: float) -> float:
    return round(min(1.0, max(0.05, rnd.gauss(mean, 0.15))), 2)


def _pick(rnd: random.Random, items: list, lo: int, hi: int) -> list:
    return rnd.sample(items, min(len(items), rnd.randint(lo, hi))) if items else []


def apply_demo_data(db: Session, seed: int = 42, today: date | None = None) -> dict[str, int]:
    rnd = random.Random(seed)
    today = today or date.today()

    refs = {
        k: list(db.scalars(select(ReferenceItem).where(ReferenceItem.kind == k))) for k in RefKind
    }
    drivers = list(db.scalars(select(BusinessDriver)))

    compliance: list[ComplianceDriver] = []
    for src in db.scalars(select(ComplianceSource)):
        existing = {d.ref for d in src.drivers}
        for code, name in COMPLIANCE_REFS.get(src.name, []):
            if code not in existing:
                src.drivers.append(ComplianceDriver(ref=code, name=name))
        compliance.extend(src.drivers)
    db.flush()

    db.execute(delete(Verification))

    # Earlier demo rules are replaced, so re-running with the same seed gives the same result.
    db.execute(delete(L3UseCase).where(L3UseCase.description == DEMO_MARK))
    db.flush()
    db.expire_all()

    # Most catalogue L3 rules sit under CC, AO, EX and PV. Give about three quarters of the
    # empty L2 use cases 1-3 generated rules so the dashboard shows every L1; the rest stay
    # empty and show up as detection gaps.
    added = 0
    for l2 in db.scalars(select(L2UseCase).order_by(L2UseCase.code)):
        if l2.children or rnd.random() > 0.75:
            continue
        for n in range(1, rnd.randint(1, 3) + 1):
            db.add(
                L3UseCase(
                    parent=l2,
                    code=f"{l2.code}-{n:02d}",
                    name=f"{l2.name}: {rnd.choice(DEMO_RULE_KINDS)}",
                    description=DEMO_MARK,
                )
            )
            added += 1
    db.flush()

    l2s = list(db.scalars(select(L2UseCase).order_by(L2UseCase.code)))
    for l2 in l2s:
        has_rules = bool(l2.children)
        l2.lifecycle_status = Lifecycle.operational if has_rules else Lifecycle.onboarding
        l2.actors = _pick(rnd, refs[RefKind.threat_actor], 1, 2)
        l2.business_drivers = _pick(rnd, drivers, 1, 2)
        l2.compliance_drivers = _pick(rnd, compliance, 0, 2)
        l2.risk_level = rnd.randint(1, 5)
        l2.target_implementation = rnd.choice([0.5, 0.6, 0.7, 0.8])
        l2.onboarded_at = today - timedelta(days=rnd.randint(200, 1100)) if has_rules else None
        l2.last_verified_at = None
        l2.last_verified_by = None

    users = ["jana", "tom", "admin"]
    rules = list(db.scalars(select(L3UseCase).order_by(L3UseCase.code)))
    counts = {"rules": len(rules), "demo_rules_added": added, "l2": len(l2s), "verifications": 0}
    for rule in rules:
        status = rnd.choices(
            [
                Lifecycle.operational,
                Lifecycle.maintenance,
                Lifecycle.onboarding,
                Lifecycle.offloading,
            ],
            weights=[70, 10, 15, 5],
        )[0]
        rule.lifecycle_status = status

        techs = _pick(rnd, refs[RefKind.detection_technology], 1, 2)
        rule.references = (
            techs
            + _pick(rnd, refs[RefKind.log_source], 1, 3)
            + _pick(rnd, refs[RefKind.scope], 1, 2)
        )

        if rnd.random() < 0.10:
            rule.effectiveness = rule.implementation = rule.coverage = None
        else:
            prof = TECH_PROFILE.get(techs[0].name, DEFAULT_PROFILE) if techs else DEFAULT_PROFILE
            impl_mean = prof[1] * (0.5 if status == Lifecycle.onboarding else 1.0)
            rule.effectiveness = _metric(rnd, prof[0])
            rule.implementation = _metric(rnd, impl_mean)
            rule.coverage = _metric(rnd, prof[2])

        rule.onboarded_at = today - timedelta(days=rnd.randint(30, 1095))
        rule.verification_interval_days = rnd.choice([None] * 8 + [30, 90])
        rule.comments = ""
        rule.last_verified_at = None
        rule.last_verified_by = None

        if status in (Lifecycle.operational, Lifecycle.maintenance) and rnd.random() > 0.12:
            # 1-4 verifications, the latest between 0 and 230 days ago (some become overdue)
            when = today - timedelta(days=rnd.randint(0, 230))
            history = []
            for _ in range(rnd.randint(1, 4)):
                if when < rule.onboarded_at:
                    break
                history.append(when)
                when -= timedelta(days=rnd.randint(60, 120))
            for i, d in enumerate(history):
                issues = rnd.random() < 0.15
                who = rnd.choice(users)
                db.add(
                    Verification(
                        l3_id=rule.id,
                        verified_at=d,
                        username=who,
                        result=VerificationResult.issues if issues else VerificationResult.ok,
                        note=rnd.choice(NOTES_ISSUES if issues else NOTES_OK),
                    )
                )
                counts["verifications"] += 1
                if i == 0:
                    rule.last_verified_at = d
                    rule.last_verified_by = who

    # L2 verification date = the oldest verification among its scored rules
    for l2 in l2s:
        dates = [r.last_verified_at for r in l2.children if r.last_verified_at]
        if dates:
            l2.last_verified_at = min(dates)
            l2.last_verified_by = "demo"

    db.commit()
    log.info("Applied demo data (seed %d): %s", seed, counts)
    return counts


def main() -> None:
    from app.config import get_settings
    from app.db import make_engine
    from app.startup import initialize

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    settings = get_settings()
    engine = make_engine(settings.database_url)
    from sqlalchemy.orm import sessionmaker

    factory = sessionmaker(bind=engine, expire_on_commit=False)
    initialize(engine, factory, settings)
    with factory() as db:
        print(apply_demo_data(db, args.seed))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
