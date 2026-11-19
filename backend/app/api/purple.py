"""Purple teaming (VECTR-style): assessments, campaigns, test cases, detections and evidence.

See app/purple.py for the data shape and how outcomes and metrics are worked out. The template
library and the imports are in app/api/purple_library.py.

The red and blue side of a test case are saved separately, each with its own version, so both
teams can work on the same test at once; a stale save gets 409 (optimistic locking, like the
interviews). Every change is written to the audit log.
"""

import csv
import hashlib
import io
import json
import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import attack, audit, uploads
from app import purple as pt
from app.api.deps import DB, SettingsDep
from app.models import (
    L3UseCase,
    PtAssessment,
    PtAssessmentStatus,
    PtAttachment,
    PtBlueStatus,
    PtCampaign,
    PtCampaignTemplate,
    PtDetection,
    PtOutcome,
    PtRedStatus,
    PtTemplate,
    PtTestCase,
    Role,
    User,
    VerificationResult,
)
from app.security import Editor, Reader

router = APIRouter(tags=["purple teaming"])

TEXT_MAX = 20_000
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
Text = Annotated[str, StringConstraints(max_length=TEXT_MAX)]
Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Items = Annotated[list[Item], Field(max_length=100)]
Username = Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]

MAX_FILE = 20 * 1024 * 1024
MAX_FILES = 30


def _now() -> datetime:
    return datetime.now(UTC)


def techniques_in(v: list[str]) -> list[str]:
    """Upper-case, de-duplicated, known ATT&CK technique ids (revoked ids are accepted)."""
    out: list[str] = []
    for raw in v:
        tid = raw.strip().upper()
        if not tid:
            continue
        if attack.status(tid)[0] == "unknown":
            raise ValueError(f"Unknown ATT&CK technique {tid}")
        if tid not in out:
            out.append(tid)
    return out


def _dedupe(v: list[str]) -> list[str]:
    out: list[str] = []
    for x in v:
        if x not in out:
            out.append(x)
    return out


# ---------------------------------------------------------------- schemas


class AssessmentIn(BaseModel):
    name: Name
    environment: Short = ""
    description: Text = ""
    scope: Text = ""
    summary: Text = ""
    start_date: date | None = None
    end_date: date | None = None
    status: PtAssessmentStatus = PtAssessmentStatus.planned
    # required when changing an assessment, ignored when creating one
    expected_version: int | None = None
    # create only: campaigns from these campaign templates
    campaign_template_ids: list[int] = []

    @model_validator(mode="after")
    def _dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("The end date cannot be before the start date")
        return self


class CampaignIn(BaseModel):
    name: Name
    description: Text = ""
    position: int | None = None
    campaign_template_id: int | None = None


class PlanIn(BaseModel):
    name: Name
    description: Text = ""
    techniques: Items = []
    tactic: Short = ""
    platforms: Items = []
    executor: Short = ""
    command: Text = ""
    cleanup: Text = ""
    operator_guidance: Text = ""
    references: Items = []
    tags: Items = []

    _t = field_validator("techniques")(lambda cls, v: techniques_in(v))
    _d = field_validator("platforms", "references", "tags")(lambda cls, v: _dedupe(v))


class TestCaseCreate(BaseModel):
    # from the library (one test case per template) or one blank test case from `plan`
    template_ids: list[int] = []
    plan: PlanIn | None = None

    @model_validator(mode="after")
    def _one(self):
        if not self.template_ids and self.plan is None:
            raise ValueError("Choose test procedures from the library or enter a test case")
        return self


class PlanSave(PlanIn):
    expected_version: int
    campaign_id: int | None = None
    position: int | None = None


class RedIn(BaseModel):
    expected_version: int
    red_status: PtRedStatus
    red_assignee: Username = ""
    attack_start: datetime | None = None
    attack_stop: datetime | None = None
    targets: Items = []
    sources: Items = []
    red_tools: Items = []
    red_notes: Text = ""

    @model_validator(mode="after")
    def _times(self):
        if self.attack_start and self.attack_stop and self.attack_stop < self.attack_start:
            raise ValueError("The attack cannot stop before it started")
        return self


class DetectionIn(BaseModel):
    id: int | None = None
    kind: Literal["rule", "tool"]
    rule_code: Short = ""
    tool: Short = ""
    outcome: PtOutcome = PtOutcome.tbd
    expected: bool = False
    alert_name: Short = ""
    severity: Literal["", *pt.SEVERITIES] = ""  # type: ignore[valid-type]
    detected_at: datetime | None = None
    note: Annotated[str, StringConstraints(max_length=2_000)] = ""

    @model_validator(mode="after")
    def _what(self):
        if self.kind == "rule" and not self.rule_code:
            raise ValueError("Choose the L3 rule of the detection")
        if self.kind == "tool" and not self.tool:
            raise ValueError("Name the tool or source of the detection")
        return self


class BlueIn(BaseModel):
    expected_version: int
    blue_status: PtBlueStatus
    blue_assignee: Username = ""
    blue_notes: Text = ""
    detection_steps: Text = ""
    prevention_steps: Text = ""
    outcome_override: PtOutcome | None = None
    detections: Annotated[list[DetectionIn], Field(max_length=50)] = []
    # when the blue side is marked done: verify the linked L3 rules with the result
    record_verification: bool = True


class VersionIn(BaseModel):
    expected_version: int


class RerunIn(BaseModel):
    name: Name | None = None
    start_date: date | None = None


class AttachmentOut(BaseModel):
    id: int
    test_case_id: int
    side: str
    filename: str
    content_type: str
    size: int
    sha256: str
    uploaded_by: str
    uploaded_at: datetime
    viewable: bool


# ---------------------------------------------------------------- helpers


def _assessment(db: Session, assessment_id: int) -> PtAssessment:
    a = db.get(PtAssessment, assessment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    return a


def _campaign(db: Session, campaign_id: int) -> PtCampaign:
    c = db.get(PtCampaign, campaign_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return c


def _case(db: Session, test_case_id: int) -> PtTestCase:
    t = db.get(PtTestCase, test_case_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test case not found")
    return t


def _case_key(t: PtTestCase) -> str:
    return f"{t.campaign.assessment.name} / {t.name}"


def _stale(who: str) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"This was changed by {who or 'someone else'}; reload to see the changes",
    )


def outcome_of(t: PtTestCase) -> str:
    return pt.derive_outcome((d.outcome for d in t.detections), t.outcome_override)


def case_input(t: PtTestCase) -> pt.CaseInput:
    return pt.CaseInput(
        outcome=outcome_of(t),
        red_status=t.red_status.value,
        blue_status=t.blue_status.value,
        attack_start=t.attack_start,
        detected_at=[
            d.detected_at for d in t.detections if d.detected_at and d.outcome.value in pt.SUCCESS
        ],
    )


def _metrics(cases: list[PtTestCase]) -> dict:
    return pt.metrics([case_input(t) for t in cases]).as_dict()


def _all_cases(a: PtAssessment) -> list[PtTestCase]:
    return [t for c in a.campaigns for t in c.test_cases]


def case_row(t: PtTestCase) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "techniques": t.techniques or [],
        "tactic": t.tactic,
        "tags": t.tags or [],
        "red_status": t.red_status.value,
        "blue_status": t.blue_status.value,
        "red_assignee": t.red_assignee,
        "blue_assignee": t.blue_assignee,
        "attack_start": t.attack_start,
        "attack_stop": t.attack_stop,
        "outcome": outcome_of(t),
        "overridden": t.outcome_override is not None,
        "detections": len(t.detections),
        "has_findings": bool((t.blue_notes or "").strip()),
    }


QUICK = "quick"  # PtAssessment.kind of the quick tests container (app/api/purple_quick.py)


def _assessment_query():
    return select(PtAssessment).options(
        selectinload(PtAssessment.campaigns)
        .selectinload(PtCampaign.test_cases)
        .selectinload(PtTestCase.detections)
    )


def _row(a: PtAssessment) -> dict:
    cases = _all_cases(a)
    return {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "environment": a.environment,
        "status": a.status.value,
        "start_date": a.start_date,
        "end_date": a.end_date,
        "previous_id": a.previous_id,
        "campaigns": len(a.campaigns),
        "metrics": _metrics(cases),
        "updated_at": a.updated_at,
    }


def heatmap(cases: list[PtTestCase]) -> dict[str, str]:
    """Technique -> weakest outcome of the executed tests that use it."""
    seen: dict[str, list[str]] = {}
    for t in cases:
        if t.red_status != PtRedStatus.executed:
            continue
        o = outcome_of(t)
        for tid in t.techniques or []:
            seen.setdefault(tid, []).append(o)
    out = {}
    for tid, outcomes in seen.items():
        w = pt.worst(outcomes)
        out[tid] = w or outcomes[0]
    return out


def heatmap_tactics(cells: dict[str, str]) -> list[dict]:
    """The tested techniques grouped by ATT&CK tactic, in matrix order."""
    d = attack.data()
    out = []
    for tac in d["tactics"]:
        techs = []
        for tid, outcome in sorted(cells.items()):
            info = d["techniques"].get(attack.resolve(tid) or tid) or {}
            if tac["short"] in info.get("tactics", []):
                techs.append({"id": tid, "name": attack.name(tid) or tid, "outcome": outcome})
        if techs:
            out.append(
                {"id": tac["id"], "short": tac["short"], "name": tac["name"], "techniques": techs}
            )
    return out


def _detail(db: Session, a: PtAssessment) -> dict:
    db.refresh(a)
    cases = _all_cases(a)
    return _row(a) | {
        "description": a.description,
        "scope": a.scope,
        "summary": a.summary,
        "version": a.version,
        "created_by": a.created_by,
        "updated_by": a.updated_by,
        "created_at": a.created_at,
        "previous_name": (db.get(PtAssessment, a.previous_id).name if a.previous_id else None),
        "campaign_list": [
            {
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "position": c.position,
                "metrics": _metrics(c.test_cases),
                "test_cases": [case_row(t) for t in c.test_cases],
            }
            for c in a.campaigns
        ],
        "heatmap": (cells := heatmap(cases)),
        "heatmap_tactics": heatmap_tactics(cells),
    }


def _template_case(tpl: PtTemplate, campaign: PtCampaign, position: int) -> PtTestCase:
    t = PtTestCase(
        campaign=campaign,
        template_id=tpl.id,
        lineage_key=f"tpl:{tpl.id}",
        name=tpl.name,
        description=tpl.description,
        techniques=list(tpl.techniques or []),
        tactic=tpl.tactic,
        platforms=list(tpl.platforms or []),
        executor=tpl.executor,
        command=tpl.command,
        cleanup=tpl.cleanup,
        operator_guidance=tpl.operator_guidance,
        references=list(tpl.references or []),
        tags=list(tpl.tags or []),
        detection_steps=tpl.detection_steps,
        prevention_steps=tpl.prevention_steps,
        position=position,
    )
    for i, tool in enumerate(tpl.expected_defenses or []):
        t.detections.append(PtDetection(kind="tool", tool=tool, expected=True, position=i))
    return t


def _templates(db: Session, ids: list[int]) -> list[PtTemplate]:
    out = []
    for tid in ids:
        tpl = db.get(PtTemplate, tid)
        if tpl is None:
            raise HTTPException(422, f"Test procedure {tid} not found")
        out.append(tpl)
    return out


def _add_campaign_from_template(
    db: Session,
    a: PtAssessment,
    ct: PtCampaignTemplate,
    position: int,
    name: str | None = None,
    seen: set[int] | None = None,
) -> PtCampaign:
    """`seen`: procedures already in the assessment; a procedure in two campaign templates is
    added once (a second copy would count as a second run in the trends)."""
    c = PtCampaign(
        assessment=a, name=name or ct.name, description=ct.description, position=position
    )
    db.add(c)
    ids = [x for x in ct.template_ids if db.get(PtTemplate, x)]
    if seen is not None:
        ids = [x for x in ids if x not in seen]
        seen.update(ids)
    for i, tpl in enumerate(_templates(db, ids)):
        db.add(_template_case(tpl, c, i))
    return c


def _plan_fields(body: PlanIn) -> dict:
    return body.model_dump(
        include={
            "name",
            "description",
            "techniques",
            "tactic",
            "platforms",
            "executor",
            "command",
            "cleanup",
            "operator_guidance",
            "references",
            "tags",
        }
    )


def _snapshot(obj, fields) -> dict:
    out = {}
    for f in fields:
        v = getattr(obj, f)
        out[f] = list(v) if isinstance(v, list) else (v.value if hasattr(v, "value") else v)
    return out


def detection_out(d: PtDetection) -> dict:
    return {
        "id": d.id,
        "kind": d.kind,
        "rule_code": d.l3.code if d.l3 is not None else d.rule_code,
        "rule_name": d.l3.name if d.l3 is not None else None,
        "rule_missing": d.kind == "rule" and d.l3 is None,
        "tool": d.tool,
        "outcome": d.outcome.value,
        "expected": d.expected,
        "alert_name": d.alert_name,
        "severity": d.severity,
        "detected_at": d.detected_at,
        "note": d.note,
    }


def attachment_out(a: PtAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=a.id,
        test_case_id=a.test_case_id,
        side=a.side,
        filename=a.filename,
        content_type=a.content_type,
        size=a.size,
        sha256=a.sha256,
        uploaded_by=a.uploaded_by,
        uploaded_at=a.uploaded_at,
        viewable=TYPES.get(uploads.ext(a.filename), ("", "", False))[2],
    )


def _history(db: Session, t: PtTestCase) -> list[dict]:
    """The runs of the same procedure in all assessments (resilience)."""
    q = (
        select(PtTestCase)
        .where(PtTestCase.lineage_key == t.lineage_key)
        .options(selectinload(PtTestCase.detections))
    )
    runs = []
    for x in db.scalars(q):
        a = x.campaign.assessment
        runs.append(
            {
                "test_case_id": x.id,
                "assessment_id": a.id,
                "assessment": a.name,
                "date": (x.attack_start.date() if x.attack_start else a.start_date),
                "red_status": x.red_status.value,
                "outcome": outcome_of(x) if x.red_status == PtRedStatus.executed else None,
                "current": x.id == t.id,
            }
        )
    runs.sort(key=lambda r: (r["date"] or date.max, r["test_case_id"]))
    return runs


def case_out(db: Session, t: PtTestCase) -> dict:
    db.refresh(t)
    a = t.campaign.assessment
    history = _history(db, t)
    return case_row(t) | {
        "assessment_id": a.id,
        "assessment_name": a.name,
        "assessment_status": a.status.value,
        "assessment_kind": a.kind,
        "campaign_id": t.campaign_id,
        "campaign_name": t.campaign.name,
        "campaigns": [{"id": c.id, "name": c.name} for c in a.campaigns],
        "template_id": t.template_id,
        "lineage_key": t.lineage_key,
        "position": t.position,
        "description": t.description,
        "platforms": t.platforms or [],
        "executor": t.executor,
        "command": t.command,
        "cleanup": t.cleanup,
        "operator_guidance": t.operator_guidance,
        "references": t.references or [],
        "plan_version": t.plan_version,
        "attack_stop": t.attack_stop,
        "targets": t.targets or [],
        "sources": t.sources or [],
        "red_tools": t.red_tools or [],
        "red_notes": t.red_notes,
        "red_version": t.red_version,
        "red_updated_by": t.red_updated_by,
        "blue_notes": t.blue_notes,
        "detection_steps": t.detection_steps,
        "prevention_steps": t.prevention_steps,
        "outcome_override": t.outcome_override.value if t.outcome_override else None,
        "derived_outcome": pt.derive_outcome(d.outcome for d in t.detections),
        "blue_version": t.blue_version,
        "blue_updated_by": t.blue_updated_by,
        "detection_list": [detection_out(d) for d in t.detections],
        "attachments": [attachment_out(x) for x in t.attachments],
        "history": history,
        "trend": pt.trend([r["outcome"] for r in history]),
        "updated_at": t.updated_at,
    }


# ---------------------------------------------------------------- assessments


@router.get("/purple/assessments")
def list_assessments(_: Reader, db: DB) -> list[dict]:
    q = _assessment_query().where(PtAssessment.kind != QUICK)
    rows = [_row(a) for a in db.scalars(q)]
    rows.sort(key=lambda r: (r["start_date"] or date.max, r["id"]), reverse=True)
    return rows


@router.post("/purple/assessments", status_code=201)
def create_assessment(body: AssessmentIn, user: Editor, db: DB) -> dict:
    a = PtAssessment(
        **body.model_dump(exclude={"expected_version", "campaign_template_ids"}),
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(a)
    seen: set[int] = set()
    for i, ct_id in enumerate(body.campaign_template_ids):
        ct = db.get(PtCampaignTemplate, ct_id)
        if ct is None:
            raise HTTPException(422, f"Campaign template {ct_id} not found")
        _add_campaign_from_template(db, a, ct, i, seen=seen)
    audit.record(
        db,
        user,
        "create",
        "pt_assessment",
        a.name,
        body.model_dump(mode="json", exclude={"expected_version"}),
    )
    db.commit()
    return _detail(db, a)


@router.get("/purple/assessments/{assessment_id}")
def get_assessment(assessment_id: int, _: Reader, db: DB) -> dict:
    return _detail(db, _assessment(db, assessment_id))


ASSESSMENT_FIELDS = (
    "name",
    "environment",
    "description",
    "scope",
    "summary",
    "start_date",
    "end_date",
    "status",
)


@router.put("/purple/assessments/{assessment_id}")
def update_assessment(assessment_id: int, body: AssessmentIn, user: Editor, db: DB) -> dict:
    a = _assessment(db, assessment_id)
    if body.expected_version != a.version:
        raise _stale(a.updated_by)
    before = _snapshot(a, ASSESSMENT_FIELDS)
    old_name = a.name
    for f in ASSESSMENT_FIELDS:
        setattr(a, f, getattr(body, f))
    changes = audit.diff(before, _snapshot(a, ASSESSMENT_FIELDS))
    if changes:
        a.version += 1
        a.updated_by = user.username
        audit.record(db, user, "update", "pt_assessment", old_name, changes)
    db.commit()
    return _detail(db, a)


@router.delete("/purple/assessments/{assessment_id}", status_code=204)
def delete_assessment(assessment_id: int, user: Editor, db: DB) -> None:
    a = _assessment(db, assessment_id)
    if a.kind == QUICK:
        raise HTTPException(status.HTTP_409_CONFLICT, "Delete single quick tests instead")
    audit.record(db, user, "delete", "pt_assessment", a.name, {"test_cases": len(_all_cases(a))})
    db.delete(a)
    db.commit()


@router.post("/purple/assessments/{assessment_id}/rerun", status_code=201)
def rerun_assessment(assessment_id: int, body: RerunIn, user: Editor, db: DB) -> dict:
    """A new assessment with the same campaigns and test procedures and empty results; the
    copies keep the lineage, so the trends compare the runs."""
    old = _assessment(db, assessment_id)
    if old.kind == QUICK:
        raise HTTPException(status.HTTP_409_CONFLICT, "Quick tests cannot be re-run as a whole")
    a = PtAssessment(
        name=body.name or f"{old.name} (re-run)",
        environment=old.environment,
        description=old.description,
        scope=old.scope,
        start_date=body.start_date,
        previous_id=old.id,
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(a)
    for c in old.campaigns:
        nc = PtCampaign(assessment=a, name=c.name, description=c.description, position=c.position)
        db.add(nc)
        for t in c.test_cases:
            nt = PtTestCase(
                campaign=nc,
                template_id=t.template_id,
                lineage_key=t.lineage_key,
                position=t.position,
                **_snapshot(t, PLAN_FIELDS),
                targets=list(t.targets or []),
                sources=list(t.sources or []),
                red_tools=list(t.red_tools or []),
                detection_steps=t.detection_steps,
                prevention_steps=t.prevention_steps,
            )
            db.add(nt)
            # the defenses checked last time are expected again; results start empty
            for d in t.detections:
                nt.detections.append(
                    PtDetection(
                        kind=d.kind,
                        l3_id=d.l3_id,
                        rule_code=d.rule_code,
                        tool=d.tool,
                        expected=True,
                        position=d.position,
                    )
                )
    audit.record(db, user, "rerun", "pt_assessment", a.name, {"from": old.name})
    db.commit()
    return _detail(db, a)


# ---------------------------------------------------------------- campaigns


@router.post("/purple/assessments/{assessment_id}/campaigns", status_code=201)
def create_campaign(assessment_id: int, body: CampaignIn, user: Editor, db: DB) -> dict:
    a = _assessment(db, assessment_id)
    position = body.position if body.position is not None else len(a.campaigns)
    if body.campaign_template_id is not None:
        ct = db.get(PtCampaignTemplate, body.campaign_template_id)
        if ct is None:
            raise HTTPException(422, "Campaign template not found")
        seen = {t.template_id for x in a.campaigns for t in x.test_cases if t.template_id}
        c = _add_campaign_from_template(db, a, ct, position, body.name, seen=seen)
    else:
        c = PtCampaign(
            assessment=a, name=body.name, description=body.description, position=position
        )
        db.add(c)
    audit.record(
        db, user, "create", "pt_campaign", f"{a.name} / {c.name}", body.model_dump(mode="json")
    )
    db.commit()
    return _detail(db, a)


@router.put("/purple/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignIn, user: Editor, db: DB) -> dict:
    c = _campaign(db, campaign_id)
    before = _snapshot(c, ("name", "description", "position"))
    c.name, c.description = body.name, body.description
    if body.position is not None:
        c.position = body.position
    changes = audit.diff(before, _snapshot(c, ("name", "description", "position")))
    if changes:
        audit.record(
            db, user, "update", "pt_campaign", f"{c.assessment.name} / {before['name']}", changes
        )
    db.commit()
    return _detail(db, c.assessment)


@router.delete("/purple/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, user: Editor, db: DB) -> None:
    c = _campaign(db, campaign_id)
    audit.record(
        db,
        user,
        "delete",
        "pt_campaign",
        f"{c.assessment.name} / {c.name}",
        {"test_cases": len(c.test_cases)},
    )
    db.delete(c)
    db.commit()


# ---------------------------------------------------------------- test cases

PLAN_FIELDS = (
    "name",
    "description",
    "techniques",
    "tactic",
    "platforms",
    "executor",
    "command",
    "cleanup",
    "operator_guidance",
    "references",
    "tags",
)
RED_FIELDS = (
    "red_status",
    "red_assignee",
    "attack_start",
    "attack_stop",
    "targets",
    "sources",
    "red_tools",
    "red_notes",
)
BLUE_FIELDS = (
    "blue_status",
    "blue_assignee",
    "blue_notes",
    "detection_steps",
    "prevention_steps",
    "outcome_override",
)


@router.post("/purple/campaigns/{campaign_id}/test-cases", status_code=201)
def create_test_cases(campaign_id: int, body: TestCaseCreate, user: Editor, db: DB) -> dict:
    c = _campaign(db, campaign_id)
    position = len(c.test_cases)
    created: list[PtTestCase] = []
    for tpl in _templates(db, body.template_ids):
        t = _template_case(tpl, c, position)
        db.add(t)
        created.append(t)
        position += 1
    if body.plan is not None:
        t = PtTestCase(
            campaign=c,
            lineage_key=f"tc:{uuid.uuid4().hex}",
            position=position,
            **_plan_fields(body.plan),
        )
        db.add(t)
        created.append(t)
    for t in created:
        audit.record(
            db,
            user,
            "create",
            "pt_test_case",
            f"{c.assessment.name} / {t.name}",
            {"campaign": c.name, "techniques": t.techniques, "template_id": t.template_id},
        )
    db.commit()
    return {"created": [t.id for t in created], "assessment": _detail(db, c.assessment)}


@router.get("/purple/test-cases/{test_case_id}")
def get_test_case(test_case_id: int, _: Reader, db: DB) -> dict:
    return case_out(db, _case(db, test_case_id))


@router.put("/purple/test-cases/{test_case_id}")
def save_plan(test_case_id: int, body: PlanSave, user: Editor, db: DB) -> dict:
    t = _case(db, test_case_id)
    if body.expected_version != t.plan_version:
        raise _stale(t.red_updated_by)
    key = _case_key(t)
    fields = (*PLAN_FIELDS, "campaign_id", "position")
    before = _snapshot(t, fields)
    for f, v in _plan_fields(body).items():
        setattr(t, f, v)
    if body.campaign_id is not None and body.campaign_id != t.campaign_id:
        target = _campaign(db, body.campaign_id)
        if target.assessment_id != t.campaign.assessment_id:
            raise HTTPException(422, "A test case can only move within its assessment")
        t.campaign = target
        t.campaign_id = target.id
    if body.position is not None:
        t.position = body.position
    changes = audit.diff(before, _snapshot(t, fields))
    if changes:
        t.plan_version += 1
        audit.record(db, user, "update", "pt_test_case", key, changes)
    db.commit()
    return case_out(db, t)


@router.delete("/purple/test-cases/{test_case_id}", status_code=204)
def delete_test_case(test_case_id: int, user: Editor, db: DB) -> None:
    t = _case(db, test_case_id)
    audit.record(db, user, "delete", "pt_test_case", _case_key(t))
    db.delete(t)
    db.commit()


def _red_saved(db: Session, t: PtTestCase, user: User) -> None:
    t.red_version += 1
    t.red_updated_by = user.username
    # the first test that runs starts the assessment (VECTR derives the progress the same way)
    a = t.campaign.assessment
    if a.status == PtAssessmentStatus.planned and t.red_status in (
        PtRedStatus.in_progress,
        PtRedStatus.paused,
        PtRedStatus.executed,
    ):
        a.status = PtAssessmentStatus.in_progress
        a.version += 1
        a.updated_by = user.username
        audit.record(
            db, user, "update", "pt_assessment", a.name, {"status": ["planned", "in_progress"]}
        )
    # the blue team can start looking once the attack ran
    if t.red_status == PtRedStatus.executed and t.blue_status == PtBlueStatus.waiting:
        t.blue_status = PtBlueStatus.in_review


@router.put("/purple/test-cases/{test_case_id}/red")
def save_red(test_case_id: int, body: RedIn, user: Editor, db: DB) -> dict:
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    before = _snapshot(t, (*RED_FIELDS, "blue_status"))
    for f in RED_FIELDS:
        v = getattr(body, f)
        setattr(t, f, list(v) if isinstance(v, list) else v)
    if t.red_status == PtRedStatus.executed and t.attack_start is None:
        raise HTTPException(422, "Enter the time the attack started")
    after = _snapshot(t, (*RED_FIELDS, "blue_status"))
    changes = audit.diff(before, after)
    if changes:
        _red_saved(db, t, user)
        audit.record(db, user, "update_red", "pt_test_case", _case_key(t), changes)
    db.commit()
    return case_out(db, t)


@router.post("/purple/test-cases/{test_case_id}/start")
def start_attack(test_case_id: int, body: VersionIn, user: Editor, db: DB) -> dict:
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    t.attack_start, t.attack_stop = _now(), None
    t.red_status = PtRedStatus.in_progress
    if not t.red_assignee:
        t.red_assignee = user.username
    _red_saved(db, t, user)
    audit.record(db, user, "start", "pt_test_case", _case_key(t), {"attack_start": t.attack_start})
    db.commit()
    return case_out(db, t)


@router.post("/purple/test-cases/{test_case_id}/stop")
def stop_attack(test_case_id: int, body: VersionIn, user: Editor, db: DB) -> dict:
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    now = _now()
    if t.attack_start is None:
        t.attack_start = now
    t.attack_stop = now
    t.red_status = PtRedStatus.executed
    _red_saved(db, t, user)
    audit.record(db, user, "stop", "pt_test_case", _case_key(t), {"attack_stop": now})
    db.commit()
    return case_out(db, t)


@router.post("/purple/test-cases/{test_case_id}/pause")
def pause_attack(test_case_id: int, body: VersionIn, user: Editor, db: DB) -> dict:
    """Pause a running attack (VECTR "Paused"); the start time stays."""
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    if t.red_status != PtRedStatus.in_progress:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a running attack can be paused")
    t.red_status = PtRedStatus.paused
    _red_saved(db, t, user)
    audit.record(
        db, user, "pause", "pt_test_case", _case_key(t), {"red_status": ["in_progress", "paused"]}
    )
    db.commit()
    return case_out(db, t)


@router.post("/purple/test-cases/{test_case_id}/resume")
def resume_attack(test_case_id: int, body: VersionIn, user: Editor, db: DB) -> dict:
    """Continue a paused attack; the original start time stays."""
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    if t.red_status != PtRedStatus.paused:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a paused attack can be resumed")
    t.red_status = PtRedStatus.in_progress
    if t.attack_start is None:
        t.attack_start = _now()
    if not t.red_assignee:
        t.red_assignee = user.username
    _red_saved(db, t, user)
    audit.record(
        db, user, "resume", "pt_test_case", _case_key(t), {"red_status": ["paused", "in_progress"]}
    )
    db.commit()
    return case_out(db, t)


@router.post("/purple/test-cases/{test_case_id}/abandon")
def abandon_attack(test_case_id: int, body: VersionIn, user: Editor, db: DB) -> dict:
    """The test could not be run (VECTR "Abandon"); it counts as not executed."""
    t = _case(db, test_case_id)
    if body.expected_version != t.red_version:
        raise _stale(t.red_updated_by)
    if t.red_status == PtRedStatus.executed:
        raise HTTPException(status.HTTP_409_CONFLICT, "A completed test cannot be abandoned")
    old = t.red_status.value
    t.red_status = PtRedStatus.not_executed
    if t.attack_start is not None and t.attack_stop is None:
        t.attack_stop = _now()
    _red_saved(db, t, user)
    audit.record(
        db, user, "abandon", "pt_test_case", _case_key(t), {"red_status": [old, "not_executed"]}
    )
    db.commit()
    return case_out(db, t)


class AssigneeIn(BaseModel):
    side: Literal["red", "blue"]
    assignee: Username = ""


@router.put("/purple/test-cases/{test_case_id}/assignee")
def set_assignee(test_case_id: int, body: AssigneeIn, user: Editor, db: DB) -> dict:
    """Who works on the red or blue side of a test (from the campaign table). Only this field
    changes, so no version is needed; the side's version goes up so open forms reload it."""
    t = _case(db, test_case_id)
    field = f"{body.side}_assignee"
    old = getattr(t, field)
    if old != body.assignee:
        setattr(t, field, body.assignee)
        if body.side == "red":
            t.red_version += 1
            t.red_updated_by = user.username
        else:
            t.blue_version += 1
            t.blue_updated_by = user.username
        audit.record(
            db, user, "assign", "pt_test_case", _case_key(t), {field: [old, body.assignee]}
        )
        db.commit()
    return case_out(db, t)


@router.get("/purple/people")
def people(_: Reader, db: DB) -> list[dict]:
    """Active accounts that can work on tests (admins and analysts), for the assignee pickers."""
    q = (
        select(User)
        .where(User.active, User.role.in_([Role.admin, Role.analyst]))
        .order_by(User.username)
    )
    return [
        {"username": u.username, "display_name": u.display_name, "role": u.role.value}
        for u in db.scalars(q)
    ]


def _rule(db: Session, code: str) -> L3UseCase | None:
    return db.scalar(select(L3UseCase).where(L3UseCase.code == code.strip().upper()))


def _detection_snapshot(t: PtTestCase) -> list[dict]:
    return [
        {
            "kind": d.kind,
            "rule": d.l3.code if d.l3 is not None else d.rule_code,
            "tool": d.tool,
            "outcome": d.outcome.value,
            "alert": d.alert_name,
        }
        for d in t.detections
    ]


def _verify_rules(db: Session, t: PtTestCase, user: User) -> list[dict]:
    """Verify the L3 rules with a result in this test (best result per rule)."""
    from app.api.scores import record_verification

    best: dict[int, PtDetection] = {}
    for d in t.detections:
        if d.kind != "rule" or d.l3 is None or d.outcome.value not in pt.RESULT:
            continue
        cur = best.get(d.l3_id)
        if cur is None or pt.RANK[d.outcome.value] > pt.RANK[cur.outcome.value]:
            best[d.l3_id] = d
    when = min((t.attack_stop or t.attack_start or _now()).date(), date.today())
    done = []
    for d in best.values():
        ok = d.outcome.value in pt.SUCCESS
        note = f"Purple team: {_case_key(t)}: {pt.OUTCOME_LABEL[d.outcome.value]}" + (
            f" ({d.alert_name})" if d.alert_name else ""
        )
        _, tag = record_verification(
            db,
            user,
            "l3",
            d.l3,
            VerificationResult.ok if ok else VerificationResult.issues,
            note[:2000],
            when,
        )
        done.append({"rule": d.l3.code, "result": "ok" if ok else "issues", "config_tag": tag})
    return done


@router.put("/purple/test-cases/{test_case_id}/blue")
def save_blue(test_case_id: int, body: BlueIn, user: Editor, db: DB) -> dict:
    t = _case(db, test_case_id)
    if body.expected_version != t.blue_version:
        raise _stale(t.blue_updated_by)
    was_done = t.blue_status == PtBlueStatus.done
    before = _snapshot(t, BLUE_FIELDS) | {"detections": _detection_snapshot(t)}
    for f in BLUE_FIELDS:
        setattr(t, f, getattr(body, f))
    existing = {d.id: d for d in t.detections}
    new: list[PtDetection] = []
    for i, d in enumerate(body.detections):
        l3, code = None, ""
        if d.kind == "rule":
            l3 = _rule(db, d.rule_code)
            old = existing.get(d.id) if d.id else None
            if l3 is None:
                # a rule deleted since: keep the detection with the code it had
                if old is None or old.l3_id is not None or old.rule_code != d.rule_code:
                    raise HTTPException(422, f"Unknown L3 rule {d.rule_code}")
            code = l3.code if l3 else d.rule_code
        new.append(
            PtDetection(
                kind=d.kind,
                l3=l3,
                rule_code=code,
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
    t.detections.clear()
    db.flush()
    t.detections.extend(new)
    db.flush()
    after = _snapshot(t, BLUE_FIELDS) | {"detections": _detection_snapshot(t)}
    changes = audit.diff(before, after)
    verified: list[dict] = []
    if changes:
        t.blue_version += 1
        t.blue_updated_by = user.username
        if not t.blue_assignee and t.blue_status != PtBlueStatus.waiting:
            t.blue_assignee = user.username
        audit.record(db, user, "update_blue", "pt_test_case", _case_key(t), changes)
    if (
        body.record_verification
        and t.blue_status == PtBlueStatus.done
        and not was_done
        and t.red_status == PtRedStatus.executed
    ):
        verified = _verify_rules(db, t, user)
    db.commit()
    return case_out(db, t) | {"verified": verified}


@router.get("/purple/test-cases/{test_case_id}/suggested-rules")
def suggested_rules(test_case_id: int, _: Reader, db: DB) -> list[dict]:
    t = _case(db, test_case_id)
    return pt.suggest_rules(t.techniques or [], _rule_candidates(db))


@router.get("/purple/suggested-rules")
def suggested_rules_for(
    _: Reader, db: DB, technique: Annotated[list[str] | None, Query()] = None
) -> list[dict]:
    return pt.suggest_rules([x.upper() for x in technique or []], _rule_candidates(db))


def _rule_candidates(db: Session) -> list[pt.RuleCandidate]:
    return [
        pt.RuleCandidate(r.id, r.code, r.name, r.lifecycle_status.value, r.attack_techniques or [])
        for r in db.scalars(select(L3UseCase).order_by(L3UseCase.code))
    ]


# ---------------------------------------------------------------- queue, rule results


@router.get("/purple/queue")
def queue(user: Reader, db: DB) -> list[dict]:
    """Open work for the current user: red tests assigned to them that did not run yet, blue
    reviews assigned to them, and executed tests nobody reviews yet."""
    q = (
        select(PtTestCase)
        .join(PtCampaign)
        .join(PtAssessment)
        .where(PtAssessment.status != PtAssessmentStatus.completed)
        .options(selectinload(PtTestCase.detections))
    )
    me = user.username
    out = []
    for t in db.scalars(q):
        side = None
        red_open = t.red_status in (
            PtRedStatus.planned,
            PtRedStatus.in_progress,
            PtRedStatus.paused,
        )
        if t.red_assignee == me and red_open:
            side = "red"
        elif t.blue_status != PtBlueStatus.done and t.red_status == PtRedStatus.executed:
            if t.blue_assignee == me:
                side = "blue"
            elif not t.blue_assignee:
                side = "blue_unassigned"
        if side:
            a = t.campaign.assessment
            out.append(
                case_row(t)
                | {
                    "side": side,
                    "assessment_id": a.id,
                    "assessment_name": a.name,
                    "campaign_name": t.campaign.name,
                }
            )
    out.sort(key=lambda r: (r["side"] == "blue_unassigned", r["assessment_name"], r["id"]))
    return out


def last_rule_tests(db: Session) -> dict[int, dict]:
    """L3 id -> the latest result of the rule in an executed purple team test (Priorities)."""
    q = (
        select(PtDetection)
        .join(PtTestCase)
        .where(PtDetection.l3_id.is_not(None), PtTestCase.red_status == PtRedStatus.executed)
        .options(selectinload(PtDetection.test_case))
    )
    out: dict[int, dict] = {}
    for d in db.scalars(q):
        if d.outcome.value not in pt.RESULT:
            continue
        t = d.test_case
        when = t.attack_start or t.created_at
        cur = out.get(d.l3_id)
        if cur is None or when > cur["at"]:
            out[d.l3_id] = {"at": when, "outcome": d.outcome.value, "test_case_id": t.id}
    return out


@router.get("/purple/rules/{code}/tests")
def rule_tests(code: str, _: Reader, db: DB) -> list[dict]:
    """Purple team results of an L3 rule, newest first (shown on the rule page)."""
    l3 = _rule(db, code)
    if l3 is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "L3 rule not found")
    out = []
    for d in db.scalars(select(PtDetection).where(PtDetection.l3_id == l3.id)):
        t = d.test_case
        a = t.campaign.assessment
        out.append(
            {
                "test_case_id": t.id,
                "test_case": t.name,
                "assessment_id": a.id,
                "assessment": a.name,
                "attack_start": t.attack_start,
                "red_status": t.red_status.value,
                "blue_status": t.blue_status.value,
                "outcome": d.outcome.value,
                "test_outcome": outcome_of(t),
                "alert_name": d.alert_name,
                "expected": d.expected,
            }
        )
    out.sort(
        key=lambda r: (r["attack_start"] is not None, r["attack_start"] or _now()), reverse=True
    )
    return out


# ---------------------------------------------------------------- trends


@router.get("/purple/trends")
def trends(_: Reader, db: DB) -> dict:
    """Defense success per assessment over time and the resilience of each procedure that ran
    more than once (VECTR "resilience trending")."""
    # quick tests are single checks, not exercises: they stay out of the trends
    assessments = list(db.scalars(_assessment_query().where(PtAssessment.kind != QUICK)))
    assessments.sort(key=lambda a: (a.start_date or a.created_at.date(), a.id))
    series = []
    lineages: dict[str, list[tuple[PtAssessment, PtTestCase]]] = {}
    for a in assessments:
        cases = _all_cases(a)
        m = _metrics(cases)
        series.append(
            {
                "assessment_id": a.id,
                "name": a.name,
                "date": a.start_date or a.created_at.date(),
                "status": a.status.value,
                "metrics": m,
            }
        )
        for t in cases:
            lineages.setdefault(t.lineage_key, []).append((a, t))
    procedures = []
    for key, runs in lineages.items():
        executed = [(a, t) for a, t in runs if t.red_status == PtRedStatus.executed]
        if not executed:
            continue
        executed.sort(key=lambda x: (x[1].attack_start or _now(), x[1].id))
        outcomes = [outcome_of(t) for _, t in executed]
        latest = executed[-1][1]
        procedures.append(
            {
                "lineage_key": key,
                "name": latest.name,
                "techniques": latest.techniques or [],
                "runs": [
                    {
                        "assessment_id": a.id,
                        "assessment": a.name,
                        "test_case_id": t.id,
                        "date": t.attack_start,
                        "outcome": o,
                    }
                    for (a, t), o in zip(executed, outcomes, strict=True)
                ],
                "trend": pt.trend(outcomes),
                "latest": outcomes[-1],
            }
        )
    order = {"regressed": 0, "improved": 1, "unchanged": 2, "new": 3, "untested": 4}
    procedures.sort(key=lambda p: (order[p["trend"]], p["name"].lower()))
    counts = {k: sum(1 for p in procedures if p["trend"] == k) for k in order}
    return {"assessments": series, "procedures": procedures, "counts": counts}


# ---------------------------------------------------------------- exports


def _safe_file(name: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in name).strip("-")[:60] or "assessment"


@router.get("/purple/assessments/{assessment_id}/navigator.json")
def navigator(assessment_id: int, user: Reader, db: DB) -> Response:
    a = _assessment(db, assessment_id)
    layer = pt.navigator_layer(a.name, heatmap(_all_cases(a)), attack.data().get("version", ""))
    audit.record_access(db, user, "export", "pt_assessment", a.name, {"format": "navigator"})
    return Response(
        json.dumps(layer, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="purple-{_safe_file(a.name)}-layer.json"'
        },
    )


CSV_COLUMNS = (
    "Campaign",
    "Test case",
    "Techniques",
    "Tactic",
    "Red status",
    "Attack start",
    "Attack stop",
    "Targets",
    "Command",
    "Blue status",
    "Outcome",
    "Detections",
    "Findings",
    "Tags",
)


def _csv_cell(v: str) -> str:
    # no formula injection when the CSV is opened in a spreadsheet
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v


@router.get("/purple/assessments/{assessment_id}/export.csv")
def export_csv(assessment_id: int, user: Reader, db: DB) -> Response:
    a = _assessment(db, assessment_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    for c in a.campaigns:
        for t in c.test_cases:
            dets = "; ".join(
                f"{d.l3.code if d.l3 else (d.rule_code or d.tool)}: {d.outcome.value}"
                for d in t.detections
            )
            row = [
                c.name,
                t.name,
                " ".join(t.techniques or []),
                t.tactic,
                t.red_status.value,
                t.attack_start.isoformat() if t.attack_start else "",
                t.attack_stop.isoformat() if t.attack_stop else "",
                ", ".join(t.targets or []),
                t.command,
                t.blue_status.value,
                outcome_of(t),
                dets,
                t.blue_notes,
                ", ".join(t.tags or []),
            ]
            w.writerow([_csv_cell(str(x)) for x in row])
    audit.record_access(db, user, "export", "pt_assessment", a.name, {"format": "csv"})
    return Response(
        "﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="purple-{_safe_file(a.name)}.csv"'},
    )


@router.get("/purple/assessments/{assessment_id}/report.pdf")
def report_pdf(
    assessment_id: int,
    user: Reader,
    db: DB,
    settings: SettingsDep,
    lang: Literal["en", "de", "nl"] | None = None,
) -> Response:
    from app import purple_report

    a = _assessment(db, assessment_id)
    detail = _detail(db, a)
    cases = {t.id: case_out(db, t) for t in _all_cases(a)}
    language = lang or (user.locale if user.locale in ("en", "de", "nl") else "en")
    data = purple_report.build(detail, cases, language, settings.app_name)
    audit.record_access(db, user, "export", "pt_assessment", a.name, {"format": "pdf"})
    return Response(
        data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="purple-{_safe_file(a.name)}.pdf"'},
    )


# ---------------------------------------------------------------- evidence

# extension -> (content type, check, viewable in the app)
TYPES: dict[str, tuple[str, tuple[bytes, ...] | str, bool]] = {
    "pdf": ("application/pdf", (b"%PDF-",), True),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",), True),
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",), True),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",), True),
    "txt": ("text/plain", "text", False),
    "log": ("text/plain", "text", False),
    "csv": ("text/csv", "text", False),
    "json": ("application/json", "json", False),
    "xml": ("application/xml", "xml", False),
    "evtx": ("application/octet-stream", (b"ElfFile\x00",), False),
    "pcap": (
        "application/vnd.tcpdump.pcap",
        (b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4", b"\x4d\x3c\xb2\xa1", b"\xa1\xb2\x3c\x4d"),
        False,
    ),
    "pcapng": ("application/octet-stream", (b"\x0a\x0d\x0d\x0a",), False),
}


def _is_text(data: bytes) -> bool:
    head = data[:8192]
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        # a multi-byte character cut at the end of the sample is fine
        return e.start >= len(head) - 3
    return True


def _content_ok(ext: str, data: bytes) -> bool:
    check = TYPES[ext][1]
    if isinstance(check, tuple):
        return data.startswith(check)
    if check == "text":
        return _is_text(data)
    if check == "xml":
        return _is_text(data) and uploads.text_start(data).startswith("<")
    if check == "json":
        try:
            json.loads(data.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            return False
        return True
    return False  # pragma: no cover


@router.post("/purple/test-cases/{test_case_id}/attachments", status_code=201)
async def upload_attachment(
    test_case_id: int,
    user: Editor,
    db: DB,
    settings: SettingsDep,
    file: UploadFile = File(...),
    side: Literal["red", "blue"] = Query("red"),
) -> AttachmentOut:
    t = _case(db, test_case_id)
    name = uploads.safe_name(file.filename or "")
    ext = uploads.ext(name)
    if ext not in TYPES or not name[: -len(ext) - 1]:
        raise HTTPException(
            422,
            "This file type is not accepted. Allowed: PDF, JPG, PNG, text and log files "
            "(.txt, .log, .csv, .json, .xml), Windows event logs (.evtx) and packet captures "
            "(.pcap, .pcapng)",
        )
    data = await file.read(MAX_FILE + 1)
    if len(data) > MAX_FILE:
        raise HTTPException(413, "The file is larger than 20 MB")
    if not data:
        raise HTTPException(422, "The file is empty")
    if not _content_ok(ext, data):
        raise HTTPException(422, f"The file content does not match a .{ext} file")
    limit = settings.evidence_max_total_mb * 1024 * 1024
    if limit and uploads.used_bytes(db) + len(data) > limit:
        raise HTTPException(
            413,
            f"The evidence storage is full ({settings.evidence_max_total_mb} MB); "
            "ask an admin to remove old files or raise EVIDENCE_MAX_TOTAL_MB",
        )
    if len(t.attachments) >= MAX_FILES:
        raise HTTPException(422, f"A test case can have at most {MAX_FILES} files")
    a = PtAttachment(
        test_case_id=t.id,
        side=side,
        filename=name,
        content_type=TYPES[ext][0],
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
        uploaded_by=user.username,
    )
    db.add(a)
    audit.record(
        db,
        user,
        "upload",
        "pt_evidence",
        _case_key(t),
        {"file": name, "size": len(data), "side": side},
    )
    db.commit()
    return attachment_out(a)


def _attachment(db: Session, attachment_id: int) -> PtAttachment:
    a = db.get(PtAttachment, attachment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return a


@router.get("/purple/attachments/{attachment_id}/content")
def attachment_content(
    attachment_id: int, user: Reader, db: DB, download: bool = False
) -> Response:
    a = _attachment(db, attachment_id)
    viewable = TYPES.get(uploads.ext(a.filename), ("", "", False))[2]
    inline = viewable and not download
    audit.record_access(
        db,
        user,
        "view" if inline else "download",
        "pt_evidence",
        _case_key(a.test_case),
        {"file": a.filename},
    )
    return Response(
        a.data,
        media_type=a.content_type if viewable else "application/octet-stream",
        headers={"Content-Disposition": uploads.content_disposition(a.filename, inline)}
        | uploads.SAFE_HEADERS,
    )


@router.delete("/purple/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, user: Editor, db: DB) -> None:
    a = _attachment(db, attachment_id)
    audit.record(db, user, "delete", "pt_evidence", _case_key(a.test_case), {"file": a.filename})
    db.delete(a)
    db.commit()
