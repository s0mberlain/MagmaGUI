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
