"""Admin view and manual trigger of the optional git repository sync, plus the push webhook."""

import hashlib
import hmac
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from app import audit, gitsync
from app.api.deps import DB, SettingsDep
from app.models import ConfigCommit
from app.security import Admin

router = APIRouter(prefix="/admin/git", tags=["admin"])
hook = APIRouter(prefix="/git", tags=["integrations"])


class GitStatus(BaseModel):
    enabled: bool
    remote: str
    branch: str
    auth: str
    auto_sync: bool
    pull: bool
    pull_interval_minutes: int
    webhook: bool
    running: bool
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    head_sha: str | None
    commits_total: int
    commits_unsynced: int
    commits_from_git: int
    last_import_at: datetime | None
    last_imported_sha: str | None
    import_notes: list[str]


def _count(db: DB, *where) -> int:
    # only rule configurations are synced (L2 configurations are no longer used, issue #25)
    q = select(func.count()).select_from(ConfigCommit).where(ConfigCommit.l3_id.is_not(None))
    return db.scalar(q.where(*where)) or 0


def _status(db: DB, settings: SettingsDep) -> GitStatus:
    st = gitsync.state(db)
    total = _count(db)
    synced = _count(db, ConfigCommit.git_sha.is_not(None))
    auth = "token" if settings.git_token else "ssh key" if settings.git_ssh_key_file else "none"
    return GitStatus(
        enabled=settings.git_enabled,
        remote=gitsync.redact(settings.git_remote_url),
        branch=settings.git_branch,
        auth=auth,
        auto_sync=settings.git_auto_sync,
        pull=settings.git_pull,
        pull_interval_minutes=settings.git_pull_interval_minutes,
        webhook=bool(settings.git_webhook_secret),
        running=gitsync.running(),
        last_attempt_at=st.last_attempt_at,
        last_success_at=st.last_success_at,
        last_error=st.last_error,
        head_sha=st.head_sha,
        commits_total=total,
        commits_unsynced=total - synced,
        commits_from_git=_count(db, ConfigCommit.source == "git"),
        last_import_at=st.last_import_at,
        last_imported_sha=st.last_imported_sha,
        import_notes=list(st.import_notes or []),
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


def _signed(secret: str, body: bytes, request: Request) -> bool:
    """GitHub (X-Hub-Signature-256: sha256=<hex>), Gitea/Forgejo (X-Gitea-Signature: <hex>),
    GitLab (X-Gitlab-Token: <secret>) or any client with X-Magma-Token: <secret>."""
    mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    h = request.headers
    candidates = [
        (h.get("x-hub-signature-256", "").removeprefix("sha256="), mac),
        (h.get("x-gitea-signature", ""), mac),
        (h.get("x-forgejo-signature", ""), mac),
        (h.get("x-gitlab-token", ""), secret),
        (h.get("x-magma-token", ""), secret),
    ]
    return any(got and hmac.compare_digest(got, want) for got, want in candidates)


@hook.post("/webhook", status_code=202)
async def git_webhook(request: Request, settings: SettingsDep) -> dict[str, str]:
    """Push event from the git server: sync now instead of waiting for the next poll."""
    if not (settings.git_enabled and settings.git_webhook_secret):
        raise HTTPException(404, "Git webhook is not configured")
    body = await request.body()
    if not _signed(settings.git_webhook_secret, body, request):
        raise HTTPException(401, "Invalid webhook signature")
    gitsync.request(request.app.state.sessionmaker, settings)
    return {"status": "sync requested"}
