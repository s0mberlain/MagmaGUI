"""YAML configuration of L2 use cases and L3 rules with git-like history (PLAN section 4a)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit, configs
from app.api.deps import DB
from app.models import ConfigCommit, ConfigTag, L2UseCase, L3UseCase
from app.security import Admin, Editor, Reader

router = APIRouter(tags=["configuration"])

Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class TagOut(BaseModel):
    name: str
    created_by: str
    created_at: datetime


class CommitOut(BaseModel):
    rev: int
    sha: str
    short: str
    parent_sha: str | None
    message: str
    author: str
    created_at: datetime
    restored_from: str | None
    git_sha: str | None = None
    tags: list[TagOut]


class CommitWithContent(CommitOut):
    content: str


class ConfigOut(BaseModel):
    head: CommitOut | None
    content: str
    commits: int


class CommitIn(BaseModel):
    content: str
    message: Message
    base_sha: str | None = Field(
        None, description="Commit the edit started from; null for the first commit."
    )


class RestoreIn(BaseModel):
    message: str = ""


class TagIn(BaseModel):
    name: str
    ref: str | None = Field(None, description="sha, r<rev> or tag; default: latest commit")


class ValidateIn(BaseModel):
    content: str


class ValidateOut(BaseModel):
    valid: bool
    error: str | None
    line: int | None
    column: int | None


class RecentOut(CommitOut):
    level: str
    code: str
    name: str


def commit_out(c: ConfigCommit) -> CommitOut:
    return CommitOut(
        rev=c.rev,
        sha=c.sha,
        short=c.sha[:7],
        parent_sha=c.parent_sha,
        message=c.message,
        author=c.author,
        created_at=c.created_at,
        restored_from=c.restored_from,
        git_sha=c.git_sha,
        tags=[
            TagOut(name=t.name, created_by=t.created_by, created_at=t.created_at) for t in c.tags
        ],
    )


def _with_content(c: ConfigCommit) -> CommitWithContent:
    return CommitWithContent(**commit_out(c).model_dump(), content=c.content)


def _owner(db: Session, level: str, code: str):
    model = {"l2": L2UseCase, "l3": L3UseCase}[level]
    obj = db.scalar(select(model).where(model.code == code))
    if obj is None:
        raise HTTPException(404, f"{level.upper()} use case not found")
    return obj


def _commit_or_404(db: Session, obj, ref: str) -> ConfigCommit:
    c = configs.find(db, obj, ref)
    if c is None:
        raise HTTPException(404, f"No commit or tag '{ref}'")
    return c


def _check(content: str) -> None:
    res = configs.check_yaml(content)
    if not res.valid:
        where = f" (line {res.line}, column {res.column})" if res.line else ""
        raise HTTPException(422, f"Invalid YAML{where}: {res.error}")


@router.post("/config/validate", response_model=ValidateOut)
def validate(body: ValidateIn, _: Reader) -> ValidateOut:
    r = configs.check_yaml(body.content)
    return ValidateOut(valid=r.valid, error=r.error, line=r.line, column=r.column)


@router.get("/config/recent", response_model=list[RecentOut])
def recent(_: Reader, db: DB, limit: int = Query(6, ge=1, le=50)) -> list[RecentOut]:
    q = select(ConfigCommit).order_by(ConfigCommit.created_at.desc(), ConfigCommit.id.desc())
    out = []
    for c in db.scalars(q.limit(limit)):
        level = "l3" if c.l3_id else "l2"
        obj = db.get(L3UseCase if c.l3_id else L2UseCase, c.l3_id or c.l2_id)
        out.append(
            RecentOut(**commit_out(c).model_dump(), level=level, code=obj.code, name=obj.name)
        )
    return out


@router.get("/config/heads/{level}", response_model=dict[str, CommitOut])
def heads(level: str, _: Reader, db: DB, prefix: str = "") -> dict[str, CommitOut]:
    """Latest commit per use case code, optionally only codes starting with `prefix`."""
    model = {"l2": L2UseCase, "l3": L3UseCase}.get(level)
    if model is None:
        raise HTTPException(404, "Unknown level")
    rows = list(db.execute(select(model.id, model.code).where(model.code.startswith(prefix))))
    by_id = configs.heads_for(db, level, [r.id for r in rows])
    return {r.code: commit_out(by_id[r.id]) for r in rows if r.id in by_id}


for _level in ("l2", "l3"):

    def _make(level: str) -> None:
        base = f"/{level}/{{code}}/config"

        @router.get(base, response_model=ConfigOut)
        def get_config(code: str, _: Reader, db: DB) -> ConfigOut:
            obj = _owner(db, level, code)
            h = configs.head(db, obj)
            return ConfigOut(
                head=commit_out(h) if h else None,
                content=h.content if h else "",
                commits=h.rev if h else 0,
            )

        @router.put(base, response_model=CommitOut, status_code=201)
        def save_config(code: str, body: CommitIn, user: Editor, db: DB):
            obj = _owner(db, level, code)
            current = configs.head(db, obj)
            current_sha = current.sha if current else None
            if body.base_sha != current_sha:
                # Like a rejected git push: someone committed in between.
                return JSONResponse(
                    status_code=409,
                    content={
                        "detail": f"r{current.rev} by {current.author} was saved after you "
                        "started editing. Review the changes and merge by hand."
                        if current
                        else "The configuration was removed",
                        "head": commit_out(current).model_dump(mode="json") if current else None,
                        "diff": configs.diff_lines(
                            current.content if current else "", body.content
                        ),
                    },
                )
            _check(body.content)
            if current and current.content == body.content:
                raise HTTPException(422, "Nothing to commit: the content is unchanged")
            c = configs.make_commit(db, obj, body.content, body.message, user.username)
            audit.record(
                db,
                user,
                "config_commit",
                level,
                code,
                {"rev": c.rev, "sha": c.sha[:7], "message": c.message},
            )
            db.commit()
            return commit_out(c)

        @router.get(f"{base}/history", response_model=list[CommitOut])
        def config_history(code: str, _: Reader, db: DB) -> list[CommitOut]:
            return [commit_out(c) for c in configs.history(db, _owner(db, level, code))]

        @router.get(f"{base}/commits/{{ref}}", response_model=CommitWithContent)
        def config_commit(code: str, ref: str, _: Reader, db: DB) -> CommitWithContent:
            return _with_content(_commit_or_404(db, _owner(db, level, code), ref))

        @router.get(f"{base}/diff")
        def config_diff(
            code: str,
            _: Reader,
            db: DB,
            to: str,
            from_: str | None = Query(None, alias="from"),
        ) -> dict:
            """Diff between two commits. Without `from`, against the parent of `to`."""
            obj = _owner(db, level, code)
            new = _commit_or_404(db, obj, to)
            if from_:
                old = _commit_or_404(db, obj, from_)
            else:
                old = configs.find(db, obj, new.parent_sha) if new.parent_sha else None
            return {
                "from": commit_out(old).model_dump(mode="json") if old else None,
                "to": commit_out(new).model_dump(mode="json"),
                **configs.diff_lines(old.content if old else "", new.content),
            }

        @router.post(f"{base}/restore/{{ref}}", response_model=CommitOut, status_code=201)
        def config_restore(code: str, ref: str, body: RestoreIn, user: Editor, db: DB) -> CommitOut:
            obj = _owner(db, level, code)
            src = _commit_or_404(db, obj, ref)
            current = configs.head(db, obj)
            if current and current.content == src.content:
                raise HTTPException(422, f"r{src.rev} has the same content as the latest version")
            msg = body.message.strip() or f"Restore r{src.rev} ({src.sha[:7]})"
            c = configs.make_commit(
                db, obj, src.content, msg[:500], user.username, restored_from=src.sha
            )
            audit.record(
                db, user, "config_restore", level, code, {"rev": c.rev, "from_rev": src.rev}
            )
            db.commit()
            return commit_out(c)

        @router.post(f"{base}/tags", response_model=CommitOut, status_code=201)
        def config_tag(code: str, body: TagIn, user: Editor, db: DB) -> CommitOut:
            obj = _owner(db, level, code)
            if not configs.TAG_RE.fullmatch(body.name):
                raise HTTPException(
                    422, "Tag names use letters, digits, '.', '_' and '-' (up to 100 characters)"
                )
            if body.name in configs.tag_names(db, obj):
                raise HTTPException(409, f"Tag '{body.name}' already exists")
            target = _commit_or_404(db, obj, body.ref) if body.ref else configs.head(db, obj)
            if target is None:
                raise HTTPException(422, "There is no configuration to tag yet")
            configs.add_tag(db, obj, target, body.name, user.username)
            audit.record(db, user, "config_tag", level, code, {"tag": body.name, "rev": target.rev})
            db.commit()
            return commit_out(target)

        @router.delete(f"{base}/tags/{{name}}", status_code=204)
        def config_untag(code: str, name: str, user: Admin, db: DB) -> None:
            obj = _owner(db, level, code)
            tag = db.scalar(
                select(ConfigTag)
                .join(ConfigCommit)
                .where(configs.owner_filter(obj), ConfigTag.name == name)
            )
            if tag is None:
                raise HTTPException(404, "Tag not found")
            audit.record(db, user, "config_untag", level, code, {"tag": name})
            db.delete(tag)
            db.info["git_dirty"] = True
            db.commit()

        @router.get(f"{base}/download")
        def config_download(code: str, _: Reader, db: DB, ref: str | None = None) -> Response:
            obj = _owner(db, level, code)
            c = _commit_or_404(db, obj, ref) if ref else configs.head(db, obj)
            if c is None:
                raise HTTPException(404, "There is no configuration yet")
            suffix = "" if c.rev == configs.head(db, obj).rev else f"-r{c.rev}"
            return Response(
                c.content,
                media_type="application/yaml",
                headers={"Content-Disposition": f'attachment; filename="{code}{suffix}.yaml"'},
            )

    _make(_level)
