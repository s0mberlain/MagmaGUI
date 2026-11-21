from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DB
from app.models import AuditLog
from app.schemas import AuditOut
from app.security import AuditReader

router = APIRouter(tags=["audit"])


@router.get("/audit", response_model=list[AuditOut])
def list_audit(
    _: AuditReader,
    db: DB,
    entity: str | None = None,
    key: str | None = None,
    user: str | None = Query(None, max_length=64),
    action: str | None = Query(None, max_length=32),
    search: str | None = Query(None, max_length=128, description="part of the object key"),
    since: date | None = Query(None, description="first day (UTC), inclusive"),
    until: date | None = Query(None, description="last day (UTC), inclusive"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[AuditLog]:
    """Newest first. Filters combine (an auditor narrows to a user, an object and a period)."""
    q = select(AuditLog).order_by(AuditLog.id.desc())
    if entity:
        q = q.where(AuditLog.entity == entity)
    if key:
        q = q.where(AuditLog.entity_key == key)
    if user:
        q = q.where(AuditLog.username == user)
    if action:
        q = q.where(AuditLog.action == action)
    if search:
        q = q.where(AuditLog.entity_key.icontains(search.strip(), autoescape=True))
    if since:
        q = q.where(AuditLog.at >= datetime.combine(since, time.min, UTC))
    if until:
        end = datetime.combine(until + timedelta(days=1), time.min, UTC)
        q = q.where(AuditLog.at < end)
    return list(db.scalars(q.limit(limit).offset(offset)))


@router.get("/audit/facets")
def audit_facets(_: AuditReader, db: DB) -> dict[str, list[str]]:
    """Values for the filter lists of the audit log page."""
    return {
        "users": sorted(x for x in db.scalars(select(AuditLog.username).distinct()) if x),
        "actions": sorted(x for x in db.scalars(select(AuditLog.action).distinct()) if x),
        "entities": sorted(x for x in db.scalars(select(AuditLog.entity).distinct()) if x),
    }
