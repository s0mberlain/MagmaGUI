from contextvars import ContextVar
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User

# Set per request by app/middleware.py; None in background jobs.
client_ip: ContextVar[str | None] = ContextVar("client_ip", default=None)


def record(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    key: str,
    changes: dict[str, Any] | None = None,
) -> None:
    """Add an audit entry to the current transaction (committed together with the change)."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else "system",
            action=action,
            entity=entity,
            entity_key=key,
            changes=_jsonable(changes or {}),
            ip=client_ip.get(),
        )
    )


def record_access(
    db: Session, user: User, action: str, entity: str, key: str, changes: dict[str, Any]
) -> None:
    """Record reading something sensitive (#46) at most once per user, item and hour, so viewing
    a file repeatedly does not flood the log."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    since = datetime.now(UTC) - timedelta(hours=1)
    seen = db.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.user_id == user.id,
            AuditLog.action == action,
            AuditLog.entity == entity,
            AuditLog.entity_key == key,
            AuditLog.at >= since,
        )
        .limit(1)
    )
    if seen is None:
        record(db, user, action, entity, key, changes)
        db.commit()


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """{field: [old, new]} for fields that changed."""
    return {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)
