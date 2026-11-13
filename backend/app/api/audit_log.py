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
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.id.desc())
    if entity:
        q = q.where(AuditLog.entity == entity)
    if key:
        q = q.where(AuditLog.entity_key == key)
    return list(db.scalars(q.limit(limit).offset(offset)))
