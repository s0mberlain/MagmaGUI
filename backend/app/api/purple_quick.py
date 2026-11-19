"""Purple teaming quick tests: test one detection or script and record the result and the
finding in a single step, without planning an assessment and campaigns first.

A quick test is an ordinary test case (app/models.py PtTestCase), so everything else works on it
unchanged: the test case page (red and blue side, evidence files, history), the verification of
the linked L3 rules, the rule page and the last test result in Priorities. All quick tests live
in one hidden container: an assessment with kind "quick" and one campaign, created on first use.
The container is not listed with the assessments and stays out of the purple team trends.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import audit
from app.api.deps import DB
from app.api.purple import (
    QUICK,
    DetectionIn,
    Items,
    Name,
    Short,
    Text,
    _metrics,
    _now,
    _rule,
    _templates,
    _verify_rules,
    case_out,
    case_row,
    techniques_in,
)
from app.models import (
    PtAssessment,
    PtAssessmentStatus,
    PtBlueStatus,
    PtCampaign,
    PtDetection,
    PtOutcome,
    PtRedStatus,
    PtTestCase,
    User,
)
from app.security import Editor, Reader

router = APIRouter(tags=["purple teaming"])

CONTAINER_NAME = "Quick tests"


class QuickTestIn(BaseModel):
    name: Name
    # a procedure of the library: the quick test joins its runs (history on the test case page)
    template_id: int | None = None
    techniques: Items = []
    executor: Short = ""
    command: Text = ""
    targets: Items = []
    # when the test ran; now if empty
    executed_at: datetime | None = None
    red_notes: Text = ""
    detections: Annotated[list[DetectionIn], Field(max_length=50)] = []
    # the finding: what was seen, what is missing, what should be fixed
    blue_notes: Text = ""
    outcome_override: PtOutcome | None = None
    # done: the result is final (blue side done); otherwise the blue side stays in review
    done: bool = True
    # with done: record a verification on the linked L3 rules
    record_verification: bool = True

    _t = field_validator("techniques")(lambda cls, v: techniques_in(v))


def _container(db: Session, user: User | None) -> PtAssessment | None:
    """The quick tests container; created when `user` is given and it does not exist yet."""
    a = db.scalar(select(PtAssessment).where(PtAssessment.kind == QUICK).order_by(PtAssessment.id))
    if a is not None or user is None:
        return a
    a = PtAssessment(
        name=CONTAINER_NAME,
        kind=QUICK,
        description="Single tests of a detection or a script, recorded with the quick test form.",
        status=PtAssessmentStatus.in_progress,
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(a)
    db.add(PtCampaign(assessment=a, name=CONTAINER_NAME, position=0))
    db.flush()
    db.refresh(a)
    return a


def _cases(a: PtAssessment | None) -> list[PtTestCase]:
    return [t for c in a.campaigns for t in c.test_cases] if a else []


def quick_row(t: PtTestCase) -> dict:
    return case_row(t) | {
        "created_at": t.created_at,
        "executor": t.executor,
        "command": t.command,
        "targets": t.targets or [],
        "red_assignee": t.red_assignee,
        "blue_notes": t.blue_notes,
        "template_id": t.template_id,
        "defenses": [
            {
                "kind": d.kind,
                "name": (d.l3.code if d.l3 is not None else d.rule_code) or d.tool,
                "outcome": d.outcome.value,
            }
            for d in t.detections
        ],
    }


@router.get("/purple/quick-tests")
def list_quick_tests(_: Reader, db: DB) -> dict:
    a = _container(db, None)
    if a is not None:
        a = db.scalar(
            select(PtAssessment)
            .where(PtAssessment.id == a.id)
            .options(
                selectinload(PtAssessment.campaigns)
                .selectinload(PtCampaign.test_cases)
                .selectinload(PtTestCase.detections)
            )
        )
    cases = _cases(a)
    rows = [quick_row(t) for t in cases]
    rows.sort(key=lambda r: (r["attack_start"] or r["created_at"], r["id"]), reverse=True)
    return {"assessment_id": a.id if a else None, "metrics": _metrics(cases), "tests": rows}


@router.post("/purple/quick-tests", status_code=201)
def create_quick_test(body: QuickTestIn, user: Editor, db: DB) -> dict:
    a = _container(db, user)
    campaign = a.campaigns[0]
    rules = {}
    for d in body.detections:
        if d.kind == "rule":
            l3 = _rule(db, d.rule_code)
            if l3 is None:
                raise HTTPException(422, f"Unknown L3 rule {d.rule_code}")
            rules[d.rule_code] = l3
    when = body.executed_at or _now()
    tpl = _templates(db, [body.template_id])[0] if body.template_id else None
    t = PtTestCase(
        template_id=tpl.id if tpl else None,
        lineage_key=f"tpl:{tpl.id}" if tpl else f"tc:{uuid.uuid4().hex}",
        name=body.name,
        description=tpl.description if tpl else "",
        techniques=body.techniques,
        tactic=tpl.tactic if tpl else "",
        platforms=list(tpl.platforms or []) if tpl else [],
        executor=body.executor,
        command=body.command,
        cleanup=tpl.cleanup if tpl else "",
        references=list(tpl.references or []) if tpl else [],
        tags=["quick"],
        position=len(campaign.test_cases),
        red_status=PtRedStatus.executed,
        red_assignee=user.username,
        attack_start=when,
        attack_stop=when,
        targets=list(body.targets),
        red_notes=body.red_notes,
        red_updated_by=user.username,
        blue_status=PtBlueStatus.done if body.done else PtBlueStatus.in_review,
        blue_assignee=user.username,
        blue_notes=body.blue_notes,
        outcome_override=body.outcome_override,
        blue_updated_by=user.username,
    )
    for i, d in enumerate(body.detections):
        l3 = rules.get(d.rule_code) if d.kind == "rule" else None
        t.detections.append(
            PtDetection(
                kind=d.kind,
                l3=l3,
                rule_code=l3.code if l3 else "",
                tool=d.tool if d.kind == "tool" else "",
                outcome=d.outcome,
                expected=d.expected,
                alert_name=d.alert_name,
                severity=d.severity,
                detected_at=d.detected_at,
                note=d.note,
                position=i,
            )
        )
    t.campaign = campaign
    db.add(t)
    db.flush()
    audit.record(
        db,
        user,
        "create",
        "pt_quick_test",
        f"{a.name} / {t.name}",
        {
            "techniques": t.techniques,
            "command": t.command,
            "targets": t.targets,
            "executed_at": when,
            "detections": [
                {"rule": d.rule_code, "tool": d.tool, "outcome": d.outcome.value}
                for d in t.detections
            ],
            "finding": t.blue_notes,
            "done": body.done,
        },
    )
    verified: list[dict] = []
    if body.done and body.record_verification:
        verified = _verify_rules(db, t, user)
    db.commit()
    return case_out(db, t) | {"verified": verified}
