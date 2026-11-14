"""Integrations: API tokens for service accounts and the SIEM push API (app/siem.py)."""

import re
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import select

from app import audit, siem
from app.api.deps import DB
from app.api.output import parse_period
from app.models import ApiToken, AuthSource, Role, User
from app.schemas import AttackId
from app.security import Admin, Editor, Reader, _token_hash, new_api_token

router = APIRouter(prefix="/integrations", tags=["integrations"])

SourceName = Annotated[str, Path(pattern=siem.SOURCE_RE, description="e.g. splunk, sentinel")]
Count = Annotated[int, Field(ge=0, le=10_000_000)]
Text255 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]


# ---------------------------------------------------------------- API tokens


class TokenIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=48)]
    role: Literal["analyst", "auditor"] = "analyst"
    scopes: Annotated[list[Literal["siem", "read"]], Field(min_length=1)] = ["siem"]
    expires_days: Annotated[int, Field(ge=1, le=3650)] | None = 365


class TokenOut(BaseModel):
    id: int
    name: str
    prefix: str
    role: Role
    scopes: list[str]
    username: str
    created_by: str
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None


class TokenCreated(TokenOut):
    token: str = Field(description="Shown once. Send it as `Authorization: Bearer <token>`.")


def _token_out(t: ApiToken, cls=TokenOut, **extra) -> TokenOut:
    return cls(
        id=t.id,
        name=t.name,
        prefix=t.prefix,
        role=t.user.role,
        scopes=list(t.scopes or []),
        username=t.user.username,
        created_by=t.created_by,
        created_at=t.created_at,
        expires_at=t.expires_at,
        last_used_at=t.last_used_at,
        **extra,
    )


@router.get("/tokens", response_model=list[TokenOut])
def list_tokens(_: Admin, db: DB) -> list[TokenOut]:
    return [_token_out(t) for t in db.scalars(select(ApiToken).order_by(ApiToken.id))]


@router.post("/tokens", response_model=TokenCreated, status_code=201)
def create_token(body: TokenIn, user: Admin, db: DB) -> TokenCreated:
    slug = re.sub(r"[^a-z0-9._-]+", "-", body.name.lower()).strip("-")[:40] or "token"
    username, n = f"svc-{slug}", 2
    while db.scalar(select(User.id).where(User.username == username)):
        username, n = f"svc-{slug}-{n}", n + 1
    svc = User(
        username=username,
        display_name=body.name,
        role=Role(body.role),
        auth_source=AuthSource.service,
        password_hash=None,
    )
    db.add(svc)
    token = new_api_token()
    now = datetime.now(UTC)
    t = ApiToken(
        user=svc,
        name=body.name,
        prefix=token[:10],
        token_hash=_token_hash(token),
        created_by=user.username,
        created_at=now,
        scopes=list(dict.fromkeys(body.scopes)),
        expires_at=now + timedelta(days=body.expires_days) if body.expires_days else None,
    )
    db.add(t)
    db.flush()
    audit.record(
        db,
        user,
        "create",
        "api_token",
        body.name,
        {"role": body.role, "scopes": body.scopes, "user": username},
    )
    db.commit()
    return _token_out(t, TokenCreated, token=token)


@router.delete("/tokens/{token_id}", status_code=204)
def revoke_token(token_id: int, user: Admin, db: DB) -> None:
    t = db.get(ApiToken, token_id)
    if t is None:
        raise HTTPException(404, "Token not found")
    audit.record(db, user, "delete", "api_token", t.name, {"user": t.user.username})
    t.user.active = False  # keeps the audit trail of what the token did
    db.delete(t)
    db.commit()


# ---------------------------------------------------------------- SIEM rule inventory


class SiemRuleIn(BaseModel):
    id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    name: Text255 = ""
    enabled: bool = True
    severity: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)] = ""
    techniques: list[AttackId] = []


class InventoryIn(BaseModel):
    rules: Annotated[list[SiemRuleIn], Field(max_length=20_000)]


class UnlinkedOut(BaseModel):
    rule_id: str
    name: str
    enabled: bool
    severity: str
    techniques: list[str]
    suggestions: list[str]


class LinkOut(BaseModel):
    rule_id: str
    name: str
    code: str


class MissingOut(BaseModel):
    code: str
    name: str
    rule_id: str
    status: str


class SourceOut(BaseModel):
    name: str
    inventory_at: datetime | None
    inventory_by: str | None
    alerts_at: datetime | None
    alerts_by: str | None
    alerts_report: dict
    rules_total: int
    enabled: int
    linked: int
    unlinked: list[UnlinkedOut]
    disabled_but_operational: list[LinkOut]


class SiemOverview(BaseModel):
    sources: list[SourceOut]
    missing_in_siem: list[MissingOut]
    linked_rules: int


def _overview(db) -> SiemOverview:
    recs, missing = siem.reconcile(db)
    srcs = {s.name: s for s in db.scalars(select(siem.SiemSource))}
    out = []
    for r in recs:
        s = srcs[r.source]
        out.append(
            SourceOut(
                name=s.name,
                inventory_at=s.inventory_at,
                inventory_by=s.inventory_by,
                alerts_at=s.alerts_at,
                alerts_by=s.alerts_by,
                alerts_report=s.alerts_report or {},
                rules_total=r.rules_total,
                enabled=r.enabled,
                linked=r.linked,
                unlinked=[UnlinkedOut(**u) for u in r.unlinked],
                disabled_but_operational=[LinkOut(**d) for d in r.disabled_but_operational],
            )
        )
    linked = sum(1 for r in db.scalars(select(siem.L3UseCase)) if r.siem_rule_ids)
    return SiemOverview(
        sources=out, missing_in_siem=[MissingOut(**m) for m in missing], linked_rules=linked
    )


@router.get("/siem", response_model=SiemOverview)
def siem_overview(_: Reader, db: DB) -> SiemOverview:
    """All SIEM sources with their reconciliation against the use cases."""
    return _overview(db)


@router.put("/siem/{source}/rules", response_model=SourceOut)
def push_inventory(source: SourceName, body: InventoryIn, user: Editor, db: DB) -> SourceOut:
    """Full rule inventory of one SIEM; rules not in the list are dropped from the inventory."""
    src = siem.source(db, source)
    n = siem.replace_inventory(db, src, [r.model_dump() for r in body.rules], user.username)
    audit.record(db, user, "siem_inventory", "siem", source, {"rules": n})
    db.commit()
    return next(s for s in _overview(db).sources if s.name == source)


@router.delete("/siem/{source}", status_code=204)
def delete_source(source: SourceName, user: Admin, db: DB) -> None:
    src = siem.source(db, source, create=False)
    if src is None:
        raise HTTPException(404, "Unknown SIEM source")
    audit.record(db, user, "delete", "siem", source)
    db.delete(src)
    db.commit()


# ---------------------------------------------------------------- alert counts


class AlertItem(BaseModel):
    rule: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    period: date = Field(description="Month as YYYY-MM (a full date is cut to its month)")
    alerts: Count = 0
    incidents: Count = 0
    false_positives: Count = 0
    false_negatives: Count | None = None

    @field_validator("period", mode="before")
    @classmethod
    def _month(cls, v):
        if isinstance(v, date):
            p = v.replace(day=1)
        else:
            try:
                p = parse_period(str(v))
            except ValueError as e:
                raise ValueError(str(e)) from e
        if p > date.today().replace(day=1):
            raise ValueError(f"period {p:%Y-%m} is in the future")
        return p


class AlertsIn(BaseModel):
    mode: Literal["replace", "add"] = Field(
        "replace",
        description="replace: the counts are the month's totals; add: add them to what is "
        "stored (for daily pushes)",
    )
    batch_id: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=128),
    ] = Field(
        None,
        description="Optional id of this push, e.g. the SIEM search job id or the date. A push "
        "with an id that was already applied for this source is skipped (safe retries in add "
        "mode).",
    )
    items: Annotated[list[AlertItem], Field(max_length=50_000)]


class AlertsOut(BaseModel):
    dry_run: bool
    duplicate: bool = False
    created: int
    updated: int
    matched: list[str]
    unmatched: list[str]
    errors: list[str]


@router.post("/siem/{source}/alerts", response_model=AlertsOut)
def push_alerts(
    source: SourceName, body: AlertsIn, user: Editor, db: DB, dry_run: bool = False
) -> AlertsOut | JSONResponse:
    """Alert, incident and false positive counts per SIEM rule and month -> output metrics."""
    src = siem.source(db, source)
    if body.batch_id and siem.batch_applied(db, src, body.batch_id):
        db.rollback()
        return AlertsOut(
            dry_run=dry_run,
            duplicate=True,
            created=0,
            updated=0,
            matched=[],
            unmatched=[],
            errors=[],
        )
    rep = siem.push_alerts(
        db, src, [i.model_dump() for i in body.items], body.mode, user.username, dry_run
    )
    out = AlertsOut(dry_run=dry_run, **rep.__dict__)
    if rep.errors:
        db.rollback()
        return JSONResponse(status_code=422, content=out.model_dump())
    if dry_run:
        db.rollback()
        return out
    if body.batch_id:
        siem.mark_batch(db, src, body.batch_id, user.username)
    audit.record(
        db,
        user,
        "siem_alerts",
        "siem",
        source,
        {
            "mode": body.mode,
            "batch_id": body.batch_id,
            "created": rep.created,
            "updated": rep.updated,
        },
    )
    db.commit()
    return out
