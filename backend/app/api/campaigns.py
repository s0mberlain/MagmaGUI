"""Purple team campaigns, test cases and the test library (PROJ-3, issue #63).

A campaign holds test cases, one ATT&CK technique each, linked to the L3 rules that should detect
it. An external red team (role `red_team`, see app/redteam.py) records how it ran each test; the
analysts record the outcome. Every outcome is written as a verification on the linked rules.

What a red team account may see is cut here, on the server: while a campaign is not closed it
gets no outcome, detection time, time to detect, blue team notes or linked rules; after close it
gets outcome, detection time and TTD. In a white box campaign it also gets the linked rules with
their definition and current configuration (no history).
"""

import statistics
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app import attack, audit, configs, redteam
from app.api.deps import DB
from app.api.scores import add_verification
from app.models import (
    Campaign,
    CampaignStatus,
    CampaignTest,
    ExecStatus,
    L2UseCase,
    L3UseCase,
    Lifecycle,
    RefKind,
    Role,
    TestOutcome,
    TestTemplate,
    User,
    VerificationResult,
    campaign_test_rules,
)
from app.security import Editor, Reader, require_roles

router = APIRouter(tags=["purple team"])

# Analysts, admins and red team accounts may write test cases (each its own fields).
TestWriter = Annotated[User, Depends(require_roles(Role.admin, Role.analyst, Role.red_team))]

FREE_TEXT_MAX = 10_000  # EC-11
FreeText = Annotated[str, StringConstraints(max_length=FREE_TEXT_MAX)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
TechniqueId = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^T\d{4}(\.\d{3})?$")
]

OUTCOME_LABEL = {
    TestOutcome.blocked: "Blocked",
    TestOutcome.alerted: "Alerted",
    TestOutcome.logged: "Logged",
    TestOutcome.not_detected: "Not detected",
}
DETECTED = (TestOutcome.blocked, TestOutcome.alerted)
# times may be at most this far ahead of the server clock (clock skew)
FUTURE_SLACK = timedelta(minutes=10)


# ---------------------------------------------------------------- helpers


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _technique(tid: str) -> str:
    """The current technique for an ID (revoked IDs are replaced), or 422."""
    current = attack.resolve(tid)
    if current is None:
        raise HTTPException(422, f"Unknown or deprecated ATT&CK technique: {tid}")
    return current


def ttd_seconds(t: CampaignTest) -> int | None:
    if t.outcome in DETECTED and t.executed_at and t.detected_at:
        return int((_utc(t.detected_at) - _utc(t.executed_at)).total_seconds())
    return None


def _is_red(user: User) -> bool:
    return user.role == Role.red_team


def _campaign(db: Session, campaign_id: int, user: User) -> Campaign:
    c = db.get(Campaign, campaign_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    if _is_red(user) and user not in c.red_team:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not assigned to this campaign")
    return c


def _test(db: Session, test_id: int, user: User) -> CampaignTest:
    t = db.get(CampaignTest, test_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test not found")
    _campaign(db, t.campaign_id, user)
    return t


def _not_closed(c: Campaign) -> None:
    if c.status == CampaignStatus.closed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The campaign is closed and read-only. Reopen it to change it.",
        )


def _running(c: Campaign) -> None:
    _not_closed(c)
    if c.status != CampaignStatus.running:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Results can only be entered while the campaign is running"
        )


def _rules(db: Session, ids: list[int]) -> list[L3UseCase]:
    ids = list(dict.fromkeys(ids))
    rules = list(db.scalars(select(L3UseCase).where(L3UseCase.id.in_(ids)))) if ids else []
    if len(rules) != len(ids):
        raise HTTPException(422, "Unknown L3 rule")
    return sorted(rules, key=lambda r: r.code)


def _rule_brief(r: L3UseCase) -> dict[str, Any]:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "l2_code": r.parent.code,
        "lifecycle_status": r.lifecycle_status,
        "attack_techniques": list(r.attack_techniques or []),
    }


def _white_box_rule(db: Session, r: L3UseCase) -> dict[str, Any]:
    """The read-only use case definition a white box red team sees: the current configuration
    only, no history, diffs or tags."""
    head = configs.head(db, r)
    refs = {k: [x.name for x in r.references if x.kind == k] for k in RefKind}
    return {
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "l2_code": r.parent.code,
        "l2_name": r.parent.name,
        "lifecycle_status": r.lifecycle_status,
        "log_sources": refs[RefKind.log_source],
        "detection_technologies": refs[RefKind.detection_technology],
        "attack_techniques": list(r.attack_techniques or []),
        "config": head.content if head else None,
    }


def test_out(db: Session, t: CampaignTest, c: Campaign, user: User) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": t.id,
        "campaign_id": t.campaign_id,
        "title": t.title,
        "technique": t.technique,
        "technique_name": attack.name(t.technique),
        "procedure": t.procedure,
        "tools": t.tools,
        "template_id": t.template_id,
        "exec_status": t.exec_status,
        "executed_at": _utc(t.executed_at),
        "red_notes": t.red_notes,
        "created_by": t.created_by,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
        "version": t.version,
    }
    red = _is_red(user)
    if not red or c.status == CampaignStatus.closed:
        out |= {
            "outcome": t.outcome,
            "detected_at": _utc(t.detected_at),
            "ttd_seconds": ttd_seconds(t),
        }
    if not red:
        out |= {
            "blue_notes": t.blue_notes,
            "outcome_by": t.outcome_by,
            "rules": [_rule_brief(r) for r in t.rules],
        }
    elif c.white_box:
        out["white_box_rules"] = [_white_box_rule(db, r) for r in t.rules]
    return out


def campaign_out(
    db: Session, c: Campaign, user: User, with_tests: bool = False, warnings: list | None = None
) -> dict[str, Any]:
    red = _is_red(user)
    results_visible = not red or c.status == CampaignStatus.closed
    tests = c.tests
    out: dict[str, Any] = {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "planned_start": c.planned_start,
        "planned_end": c.planned_end,
        "status": c.status,
        "white_box": c.white_box,
        "created_by": c.created_by,
        "created_at": c.created_at,
        "closed_at": c.closed_at,
        "red_team": [
            {"id": u.id, "username": u.username, "display_name": u.display_name} for u in c.red_team
        ],
        "test_count": len(tests),
        "exec_counts": {s.value: sum(1 for t in tests if t.exec_status == s) for s in ExecStatus},
    }
    if results_visible:
        ttds = [x for x in (ttd_seconds(t) for t in tests) if x is not None]
        out |= {
            "outcome_counts": {
                o.value: sum(1 for t in tests if t.outcome == o) for o in TestOutcome
            },
            "median_ttd_seconds": int(statistics.median(ttds)) if ttds else None,
        }
    if with_tests:
        out["tests"] = [test_out(db, t, c, user) for t in tests]
    if warnings:
        out["warnings"] = warnings
    return out


def _verify_rules(
    db: Session, user: User, c: Campaign, t: CampaignTest, rules: list[L3UseCase]
) -> None:
    """One verification per rule for the test's outcome (spec 21): OK for Blocked/Alerted,
    Issues found for Logged/Not detected."""
    if t.outcome is None or not rules:
        return
    result = VerificationResult.ok if t.outcome in DETECTED else VerificationResult.issues
    when_dt = _utc(t.detected_at) or _utc(t.executed_at)
    when = when_dt.date() if when_dt else date.today()
    note = f"Purple team: {c.name} / {t.title} ({OUTCOME_LABEL[t.outcome]})"
    for r in rules:
        add_verification(db, "l3", r, when, user.username, result, note[:2000])
        audit.record(
            db,
            user,
            "verify",
            "l3",
            r.code,
            {"result": result.value, "verified_at": when, "note": note, "campaign_test": t.id},
        )


def _expiry_warnings(users: list[User]) -> list[str]:
    """EC-5: assigning to a campaign whose planned end is long over leaves the account
    already expired."""
    return [
        f"The expiry date of {u.username} is already over"
        for u in users
        if u.role == Role.red_team and u.expires_on and redteam.is_expired(u)
    ]


# ---------------------------------------------------------------- schemas


class CampaignIn(BaseModel):
    name: Title
    description: FreeText = ""
    planned_start: date
    planned_end: date
    white_box: bool = False
    red_team_ids: list[int] = []

    @model_validator(mode="after")
    def _dates(self):
        if self.planned_end < self.planned_start:
            raise ValueError("The planned end cannot be before the planned start")
        return self


class CampaignPatch(BaseModel):
    name: Title | None = None
    description: FreeText | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    white_box: bool | None = None
    red_team_ids: list[int] | None = None


class StatusIn(BaseModel):
    action: Literal["start", "close", "reopen"]


class TestIn(BaseModel):
    title: Title
    technique: TechniqueId
    procedure: FreeText = ""
    tools: FreeText = ""
    rule_ids: list[int] = []
    template_id: int | None = None


class AddRules(BaseModel):
    test_id: int
    rule_ids: list[int]


class BulkIn(BaseModel):
    tests: list[TestIn] = Field(default=[], max_length=1000)
    add_rules: list[AddRules] = Field(default=[], max_length=1000)


class TestPatch(BaseModel):
    version: int
    title: Title | None = None
    technique: TechniqueId | None = None
    procedure: FreeText | None = None
    tools: FreeText | None = None
    rule_ids: list[int] | None = None
    exec_status: ExecStatus | None = None
    executed_at: datetime | None = None
    red_notes: FreeText | None = None
    outcome: TestOutcome | None = None
    detected_at: datetime | None = None
    blue_notes: FreeText | None = None

    @field_validator("executed_at", "detected_at")
    @classmethod
    def _not_future(cls, v: datetime | None) -> datetime | None:
        v = _utc(v)
        if v is not None and v > datetime.now(UTC) + FUTURE_SLACK:
            raise ValueError("cannot be in the future")
        return v


class ProposalIn(BaseModel):
    l2_ids: list[int] = []
    l3_ids: list[int] = []


class TemplateIn(BaseModel):
    title: Title
    technique: TechniqueId
    procedure: FreeText = ""
    tools: FreeText = ""


class TemplatePatch(BaseModel):
    title: Title | None = None
    technique: TechniqueId | None = None
    procedure: FreeText | None = None
    tools: FreeText | None = None


RED_FIELDS = {"exec_status", "executed_at", "red_notes"}
BLUE_FIELDS = {"outcome", "detected_at", "blue_notes"}
DEFINITION_FIELDS = {"title", "technique", "procedure", "tools", "rule_ids"}


# ---------------------------------------------------------------- campaigns


@router.get("/campaigns")
def list_campaigns(user: Reader, db: DB) -> list[dict[str, Any]]:
    q = select(Campaign).options(selectinload(Campaign.tests), selectinload(Campaign.red_team))
    if _is_red(user):
        q = q.where(Campaign.red_team.any(User.id == user.id))
    campaigns = db.scalars(q.order_by(Campaign.planned_start.desc(), Campaign.id.desc()))
    return [campaign_out(db, c, user) for c in campaigns]


@router.get("/campaigns/red-team-accounts")
def red_team_accounts(_: Editor, db: DB) -> list[dict[str, Any]]:
    """Red team accounts an analyst can assign to a campaign."""
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "active": u.active,
            "expires_on": u.expires_on,
        }
        for u in db.scalars(select(User).where(User.role == Role.red_team).order_by(User.username))
    ]


@router.get("/campaigns/techniques")
def campaign_techniques(_: Reader) -> list[dict[str, str]]:
    """Current ATT&CK techniques for the technique picker (also for red team accounts)."""
    return [{"id": k, "name": v["name"]} for k, v in sorted(attack.data()["techniques"].items())]


def _red_team_users(db: Session, ids: list[int]) -> list[User]:
    ids = list(dict.fromkeys(ids))
    users = list(db.scalars(select(User).where(User.id.in_(ids)))) if ids else []
    if len(users) != len(ids) or any(u.role != Role.red_team for u in users):
        raise HTTPException(422, "Only red team accounts can be assigned to a campaign")
    return users


def _unique_name(db: Session, name: str, own_id: int | None = None) -> None:
    q = select(Campaign.id).where(Campaign.name_key == name.lower())
    if own_id is not None:
        q = q.where(Campaign.id != own_id)
    if db.scalar(q) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A campaign with this name already exists")


@router.post("/campaigns", status_code=201)
def create_campaign(body: CampaignIn, user: Editor, db: DB) -> dict[str, Any]:
    _unique_name(db, body.name)
    team = _red_team_users(db, body.red_team_ids)
    c = Campaign(
        name=body.name,
        name_key=body.name.lower(),
        description=body.description,
        planned_start=body.planned_start,
        planned_end=body.planned_end,
        white_box=body.white_box,
        status=CampaignStatus.planned,
        created_by=user.username,
        red_team=team,
    )
    db.add(c)
    audit.record(
        db,
        user,
        "create",
        "campaign",
        c.name,
        body.model_dump(exclude={"red_team_ids"}) | {"red_team": [u.username for u in team]},
    )
    redteam.recompute(db, user, team)
    db.commit()
    return campaign_out(db, c, user, True, _expiry_warnings(team))


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, user: Reader, db: DB) -> dict[str, Any]:
    return campaign_out(db, _campaign(db, campaign_id, user), user, True)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignPatch, user: Editor, db: DB) -> dict[str, Any]:
    c = _campaign(db, campaign_id, user)
    _not_closed(c)
    data = body.model_dump(exclude_unset=True)
    for k in ("name", "planned_start", "planned_end", "white_box", "red_team_ids"):
        if k in data and data[k] is None:
            raise HTTPException(422, f"{k} cannot be empty")
    if "name" in data:
        _unique_name(db, data["name"], c.id)
    start = data.get("planned_start", c.planned_start)
    end = data.get("planned_end", c.planned_end)
    if end < start:
        raise HTTPException(422, "The planned end cannot be before the planned start")

    affected = list(c.red_team)
    team_ids = data.pop("red_team_ids", None)
    before = {k: getattr(c, k) for k in data}
    for k, v in data.items():
        setattr(c, k, v)
    if "name" in data:
        c.name_key = c.name.lower()
    changes = audit.diff(before, data)
    added: list[User] = []
    if team_ids is not None:
        team = _red_team_users(db, team_ids)
        old = {u.username for u in c.red_team}
        new = {u.username for u in team}
        if old != new:
            changes["red_team"] = [sorted(old), sorted(new)]
            c.red_team = team
            affected = list({u.id: u for u in affected + team}.values())
            added = [u for u in team if u.username not in old]
    if changes:
        audit.record(db, user, "update", "campaign", c.name, changes)
    redteam.recompute(db, user, affected)
    warnings = _expiry_warnings(added)
    db.commit()
    return campaign_out(db, c, user, True, warnings)


@router.post("/campaigns/{campaign_id}/status", response_model=None)
def change_status(
    campaign_id: int, body: StatusIn, user: Editor, db: DB
) -> dict[str, Any] | JSONResponse:
    c = _campaign(db, campaign_id, user)
    old = c.status
    allowed = {
        "start": (CampaignStatus.planned, CampaignStatus.running),
        "close": (CampaignStatus.running, CampaignStatus.closed),
        "reopen": (CampaignStatus.closed, CampaignStatus.running),
    }
    frm, to = allowed[body.action]
    if c.status != frm:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {c.status.value} campaign cannot be changed this way"
        )
    if body.action == "close":
        incomplete = [
            {"id": t.id, "title": t.title, "technique": t.technique, "reason": reason}
            for t in c.tests
            for reason in [
                "not_run"
                if t.exec_status == ExecStatus.not_run
                else "no_outcome"
                if t.exec_status == ExecStatus.executed and t.outcome is None
                else None
            ]
            if reason
        ]
        if incomplete:
            return JSONResponse(
                {
                    "detail": "Some tests are not complete: every test needs an execution status "
                    "and every executed test an outcome",
                    "incomplete": incomplete,
                },
                status_code=status.HTTP_409_CONFLICT,
            )
        c.closed_at = datetime.now(UTC)
    else:
        c.closed_at = None
    c.status = to
    audit.record(db, user, body.action, "campaign", c.name, {"status": [old, to]})
    db.commit()
    return campaign_out(db, c, user, True)


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(
    campaign_id: int, user: Annotated[User, Depends(require_roles(Role.admin))], db: DB
) -> None:
    c = _campaign(db, campaign_id, user)
    if c.status != CampaignStatus.planned and any(t.outcome is not None for t in c.tests):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A campaign with test outcomes cannot be deleted"
        )
    team = list(c.red_team)
    audit.record(db, user, "delete", "campaign", c.name, {"tests": len(c.tests)})
    db.delete(c)
    redteam.recompute(db, user, team)
    db.commit()


# ---------------------------------------------------------------- proposals


def _chosen_rules(db: Session, body: ProposalIn) -> list[L3UseCase]:
    rules: dict[int, L3UseCase] = {}
    if body.l2_ids:
        l2s = list(db.scalars(select(L2UseCase).where(L2UseCase.id.in_(set(body.l2_ids)))))
        if len(l2s) != len(set(body.l2_ids)):
            raise HTTPException(422, "Unknown L2 use case")
        for l2 in l2s:
            for r in l2.children:
                if r.lifecycle_status != Lifecycle.retired:  # spec 6, AK-15
                    rules[r.id] = r
    for r in _rules(db, body.l3_ids):
        rules[r.id] = r
    return sorted(rules.values(), key=lambda r: r.code)


@router.post("/campaigns/{campaign_id}/proposals")
def propose_tests(campaign_id: int, body: ProposalIn, user: Editor, db: DB) -> dict[str, Any]:
    """One proposed test per distinct current ATT&CK technique of the chosen rules (spec 7-10).
    Nothing is saved: the analyst accepts, edits or drops each proposal."""
    c = _campaign(db, campaign_id, user)
    _not_closed(c)
    rules = _chosen_rules(db, body)
    by_tech: dict[str, list[L3UseCase]] = {}
    revoked: dict[str, set[str]] = {}
    skipped: dict[str, dict[str, Any]] = {}
    no_technique = []
    for r in rules:
        techs = list(dict.fromkeys(r.attack_techniques or []))
        if not techs:
            no_technique.append(_rule_brief(r))
            continue
        for tid in techs:
            st, current = attack.status(tid)
            if current is None:
                s = skipped.setdefault(tid, {"technique": tid, "status": st, "rules": []})
                s["rules"].append(r.code)
                continue
            if st == "revoked":
                revoked.setdefault(current, set()).add(tid)
            lst = by_tech.setdefault(current, [])
            if r not in lst:
                lst.append(r)
    templates: dict[str, list[TestTemplate]] = {}
    for tpl in db.scalars(
        select(TestTemplate)
        .where(TestTemplate.technique.in_(list(by_tech)))
        .order_by(TestTemplate.id)
    ):
        templates.setdefault(tpl.technique, []).append(tpl)
    existing: dict[str, list[CampaignTest]] = {}
    for t in c.tests:
        existing.setdefault(t.technique, []).append(t)
    proposals = [
        {
            "technique": tid,
            "technique_name": attack.name(tid),
            "replaces": sorted(revoked.get(tid, [])),
            "rules": [_rule_brief(r) for r in by_tech[tid]],
            "templates": [
                {"id": x.id, "title": x.title, "procedure": x.procedure, "tools": x.tools}
                for x in templates.get(tid, [])
            ],
            "existing_tests": [
                {"id": t.id, "title": t.title, "rule_ids": [r.id for r in t.rules]}
                for t in existing.get(tid, [])
            ],
        }
        for tid in sorted(by_tech)
    ]
    return {
        "proposals": proposals,
        "skipped_techniques": sorted(skipped.values(), key=lambda s: s["technique"]),
        "no_technique": no_technique,
    }


# ---------------------------------------------------------------- tests


def _new_test(db: Session, c: Campaign, body: TestIn, user: User) -> CampaignTest:
    if body.template_id is not None and db.get(TestTemplate, body.template_id) is None:
        raise HTTPException(422, "Unknown test library template")
    t = CampaignTest(
        campaign=c,
        title=body.title,
        technique=_technique(body.technique),
        procedure=body.procedure,
        tools=body.tools,
        template_id=body.template_id,
        exec_status=ExecStatus.not_run,
        red_notes="",
        blue_notes="",
        created_by=user.username,
        rules=[] if _is_red(user) else _rules(db, body.rule_ids),
        version=1,
    )
    db.add(t)
    return t


@router.post("/campaigns/{campaign_id}/tests", status_code=201)
def create_test(campaign_id: int, body: TestIn, user: TestWriter, db: DB) -> dict[str, Any]:
    c = _campaign(db, campaign_id, user)
    _not_closed(c)
    if _is_red(user):
        # spec 16a: ad-hoc tests by the red team, without rules, while the campaign runs
        if c.status != CampaignStatus.running:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Tests can be added while the campaign is running"
            )
        if body.rule_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not allow this action")
    t = _new_test(db, c, body, user)
    db.flush()
    audit.record(
        db,
        user,
        "create",
        "campaign_test",
        f"{c.name} #{t.id}",
        {"title": t.title, "technique": t.technique, "rules": [r.code for r in t.rules]},
    )
    db.commit()
    return test_out(db, t, c, user)


@router.post("/campaigns/{campaign_id}/tests/bulk", status_code=201)
def create_tests(campaign_id: int, body: BulkIn, user: Editor, db: DB) -> dict[str, Any]:
    """Accept proposals: new tests, and rules added to tests already in the campaign."""
    c = _campaign(db, campaign_id, user)
    _not_closed(c)
    created = [_new_test(db, c, x, user) for x in body.tests]
    for add in body.add_rules:
        t = db.get(CampaignTest, add.test_id)
        if t is None or t.campaign_id != c.id:
            raise HTTPException(422, "Unknown test")
        new = [r for r in _rules(db, add.rule_ids) if r not in t.rules]
        if new:
            t.rules = sorted(t.rules + new, key=lambda r: r.code)
            t.version += 1
            _verify_rules(db, user, c, t, new)  # spec 23
            audit.record(
                db,
                user,
                "update",
                "campaign_test",
                f"{c.name} #{t.id}",
                {"rules_added": [r.code for r in new]},
            )
    db.flush()
    if created:
        audit.record(
            db,
            user,
            "create",
            "campaign_test",
            c.name,
            {"tests": [{"id": t.id, "title": t.title, "technique": t.technique} for t in created]},
        )
    db.commit()
    db.refresh(c)
    return campaign_out(db, c, user, True)


@router.patch("/campaign-tests/{test_id}")
def update_test(test_id: int, body: TestPatch, user: TestWriter, db: DB) -> dict[str, Any]:
    t = _test(db, test_id, user)
    c = t.campaign
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version")
    fields = set(data)
    _not_closed(c)
    if _is_red(user) and fields - RED_FIELDS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not allow this action")
    if fields & (RED_FIELDS | BLUE_FIELDS):
        _running(c)
    for k in ("title", "technique", "exec_status", "procedure", "tools", "red_notes", "blue_notes"):
        if k in data and data[k] is None:
            raise HTTPException(422, f"{k} cannot be empty")

    # optimistic locking (EC-6): only one of two parallel saves goes through
    claimed = db.execute(
        update(CampaignTest)
        .where(CampaignTest.id == t.id, CampaignTest.version == version)
        .values(version=version + 1)
        .execution_options(synchronize_session=False)
    ).rowcount
    if claimed != 1:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This test was changed by someone else in the meantime. Reload and retry.",
        )
    db.refresh(t)

    old_outcome = t.outcome
    old_rules = list(t.rules)
    before = {
        "title": t.title,
        "technique": t.technique,
        "procedure": t.procedure,
        "tools": t.tools,
        "exec_status": t.exec_status,
        "executed_at": _utc(t.executed_at),
        "red_notes": t.red_notes,
        "outcome": t.outcome,
        "detected_at": _utc(t.detected_at),
        "blue_notes": t.blue_notes,
    }
    if "technique" in data:
        data["technique"] = _technique(data["technique"])
    if "outcome" in data and data["outcome"] is None:
        data["detected_at"] = None  # clearing the outcome clears its detection time
    new = before | {k: v for k, v in data.items() if k != "rule_ids"}

    if new["exec_status"] == ExecStatus.not_executed and (new["outcome"] or new["detected_at"]):
        raise HTTPException(422, "A test that could not be executed has no outcome")
    if new["outcome"] in DETECTED and new["detected_at"] is None:
        raise HTTPException(422, "Blocked and Alerted need the detection time")
    if new["outcome"] == TestOutcome.not_detected and new["detected_at"] is not None:
        raise HTTPException(422, "Not detected cannot have a detection time")
    if new["outcome"] is None and new["detected_at"] is not None:
        raise HTTPException(422, "A detection time needs an outcome")
    if new["executed_at"] and new["detected_at"] and new["detected_at"] < new["executed_at"]:
        raise HTTPException(422, "The detection time cannot be before the execution time")

    for k, v in data.items():
        if k != "rule_ids":
            setattr(t, k, v)
    if "rule_ids" in data:
        t.rules = _rules(db, data["rule_ids"])
    if "outcome" in data and data["outcome"] != old_outcome:
        t.outcome_by = user.username if data["outcome"] else None

    changes = audit.diff(before, {k: v for k, v in new.items() if k in data})
    added = [r for r in t.rules if r not in old_rules]
    removed = [r for r in old_rules if r not in t.rules]
    if added or removed:
        changes["rules"] = [[r.code for r in old_rules], [r.code for r in t.rules]]
    db.flush()
    # spec 21-23: a new or changed outcome is a verification on every linked rule; a rule linked
    # to a test that already has an outcome gets one too. Clearing writes nothing.
    if t.outcome is not None and t.outcome != old_outcome:
        _verify_rules(db, user, c, t, list(t.rules))
    elif t.outcome is not None and added:
        _verify_rules(db, user, c, t, added)
    if changes:
        audit.record(db, user, "update", "campaign_test", f"{c.name} #{t.id}", changes)
    db.commit()
    db.refresh(t)
    return test_out(db, t, c, user)


@router.delete("/campaign-tests/{test_id}", status_code=204)
def delete_test(test_id: int, user: Editor, db: DB) -> None:
    t = _test(db, test_id, user)
    _not_closed(t.campaign)
    if t.outcome is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A test with an outcome cannot be deleted")
    audit.record(
        db, user, "delete", "campaign_test", f"{t.campaign.name} #{t.id}", {"title": t.title}
    )
    db.delete(t)
    db.commit()


@router.post("/campaign-tests/{test_id}/to-library", status_code=201)
def save_to_library(test_id: int, user: Editor, db: DB) -> dict[str, Any]:
    t = _test(db, test_id, user)
    tpl = TestTemplate(
        title=t.title,
        technique=t.technique,
        procedure=t.procedure,
        tools=t.tools,
        created_by=user.username,
    )
    db.add(tpl)
    db.flush()
    audit.record(db, user, "create", "test_template", f"#{tpl.id}", {"from_test": t.id})
    db.commit()
    return template_out(tpl)


@router.get("/l3/{code}/campaign-tests")
def rule_tests(code: str, _: Reader, db: DB) -> list[dict[str, Any]]:
    """Every test linked to a rule, newest first (spec 25)."""
    rule = db.scalar(select(L3UseCase).where(L3UseCase.code == code))
    if rule is None:
        raise HTTPException(404, "L3 rule not found")
    tests = db.scalars(
        select(CampaignTest)
        .join(campaign_test_rules, campaign_test_rules.c.test_id == CampaignTest.id)
        .where(campaign_test_rules.c.l3_id == rule.id)
        .order_by(
            func.coalesce(CampaignTest.executed_at, CampaignTest.created_at).desc(),
            CampaignTest.id.desc(),
        )
    )
    return [
        {
            "id": t.id,
            "campaign_id": t.campaign_id,
            "campaign_name": t.campaign.name,
            "campaign_status": t.campaign.status,
            "title": t.title,
            "technique": t.technique,
            "technique_name": attack.name(t.technique),
            "exec_status": t.exec_status,
            "executed_at": _utc(t.executed_at),
            "outcome": t.outcome,
            "detected_at": _utc(t.detected_at),
            "ttd_seconds": ttd_seconds(t),
        }
        for t in tests
    ]


# ---------------------------------------------------------------- test library


def template_out(x: TestTemplate) -> dict[str, Any]:
    return {
        "id": x.id,
        "title": x.title,
        "technique": x.technique,
        "technique_name": attack.name(x.technique),
        "procedure": x.procedure,
        "tools": x.tools,
        "created_by": x.created_by,
        "created_at": x.created_at,
        "updated_at": x.updated_at,
    }


@router.get("/test-library")
def list_templates(
    _: Reader,
    db: DB,
    technique: Annotated[str | None, Query(max_length=16)] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> list[dict[str, Any]]:
    stmt = select(TestTemplate)
    if technique:
        stmt = stmt.where(
            or_(
                TestTemplate.technique == technique,
                TestTemplate.technique.startswith(technique + "."),
            )
        )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(TestTemplate.title).like(like),
                func.lower(TestTemplate.procedure).like(like),
                func.lower(TestTemplate.tools).like(like),
                func.lower(TestTemplate.technique).like(like),
            )
        )
    return [
        template_out(x) for x in db.scalars(stmt.order_by(TestTemplate.technique, TestTemplate.id))
    ]


@router.post("/test-library", status_code=201)
def create_template(body: TemplateIn, user: Editor, db: DB) -> dict[str, Any]:
    tpl = TestTemplate(
        title=body.title,
        technique=_technique(body.technique),
        procedure=body.procedure,
        tools=body.tools,
        created_by=user.username,
    )
    db.add(tpl)
    db.flush()
    audit.record(db, user, "create", "test_template", f"#{tpl.id}", body.model_dump())
    db.commit()
    return template_out(tpl)


def _template(db: Session, template_id: int) -> TestTemplate:
    tpl = db.get(TestTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "Template not found")
    return tpl


@router.patch("/test-library/{template_id}")
def update_template(template_id: int, body: TemplatePatch, user: Editor, db: DB) -> dict[str, Any]:
    tpl = _template(db, template_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is None:
            raise HTTPException(422, f"{k} cannot be empty")
    if "technique" in data:
        data["technique"] = _technique(data["technique"])
    before = {k: getattr(tpl, k) for k in data}
    for k, v in data.items():
        setattr(tpl, k, v)
    audit.record(db, user, "update", "test_template", f"#{tpl.id}", audit.diff(before, data))
    db.commit()
    return template_out(tpl)


@router.delete("/test-library/{template_id}", status_code=204)
def delete_template(template_id: int, user: Editor, db: DB) -> None:
    """Tests made from the template keep their copy (AK-22)."""
    tpl = _template(db, template_id)
    audit.record(db, user, "delete", "test_template", f"#{tpl.id}", {"title": tpl.title})
    db.delete(tpl)
    db.commit()
