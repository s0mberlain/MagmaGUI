"""Admin view and manual trigger of the optional git repository sync."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from app import audit, gitsync
from app.api.deps import DB, SettingsDep
from app.models import ConfigCommit
from app.security import Admin

router = APIRouter(prefix="/admin/git", tags=["admin"])


class GitStatus(BaseModel):
    enabled: bool
    remote: str
    branch: str
    auth: str
    auto_sync: bool
    running: bool
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    head_sha: str | None
    commits_total: int
    commits_unsynced: int


def _status(db: DB, settings: SettingsDep) -> GitStatus:
    st = gitsync.state(db)
    total = db.scalar(select(func.count()).select_from(ConfigCommit)) or 0
    synced = (
        db.scalar(
            select(func.count()).select_from(ConfigCommit).where(ConfigCommit.git_sha.is_not(None))
        )
        or 0
    )
    auth = "token" if settings.git_token else "ssh key" if settings.git_ssh_key_file else "none"
    return GitStatus(
        enabled=settings.git_enabled,
        remote=gitsync.redact(settings.git_remote_url),
        branch=settings.git_branch,
        auth=auth,
        auto_sync=settings.git_auto_sync,
        running=gitsync.running(),
        last_attempt_at=st.last_attempt_at,
        last_success_at=st.last_success_at,
        last_error=st.last_error,
        head_sha=st.head_sha,
        commits_total=total,
        commits_unsynced=total - synced,
    )


@router.get("", response_model=GitStatus)
def git_status(_: Admin, db: DB, settings: SettingsDep) -> GitStatus:
    return _status(db, settings)


@router.post("/sync", response_model=GitStatus)
def git_sync(request: Request, user: Admin, db: DB, settings: SettingsDep) -> GitStatus:
    if not settings.git_enabled:
        raise HTTPException(409, "No git repository is configured (GIT_REMOTE_URL)")
    audit.record(db, user, "git_sync", "git", settings.git_branch, {})
    db.commit()
    gitsync.run(request.app.state.sessionmaker, settings)
    db.expire_all()
    return _status(db, settings)
