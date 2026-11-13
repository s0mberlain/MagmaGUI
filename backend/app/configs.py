"""YAML configuration history: commits, diffs and tags (docs/PLAN.md section 4a).

Works like git without exposing git: every save is an immutable commit with the full text,
a restore is a new commit with old content, and a save based on an outdated commit is refused.
"""

import difflib
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ConfigCommit, ConfigTag, L2UseCase, L3UseCase

MAX_CONFIG_BYTES = 256 * 1024
TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


@dataclass
class YamlCheck:
    valid: bool
    error: str | None = None
    line: int | None = None
    column: int | None = None


def check_yaml(content: str) -> YamlCheck:
    """Free-form YAML: the only rule is that it parses (all documents of a stream)."""
    if len(content.encode()) > MAX_CONFIG_BYTES:
        return YamlCheck(False, f"Configuration is larger than {MAX_CONFIG_BYTES // 1024} KB")
    try:
        for _ in yaml.safe_load_all(content):
            pass
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None) or getattr(e, "context_mark", None)
        problem = getattr(e, "problem", None) or str(e)
        return YamlCheck(
            False,
            problem,
            mark.line + 1 if mark else None,
            mark.column + 1 if mark else None,
        )
    return YamlCheck(True)


def commit_sha(parent: str | None, author: str, at: datetime, message: str, content: str) -> str:
    payload = f"parent {parent or '-'}\nauthor {author}\ndate {at.isoformat()}\n\n{message}\n\0"
    return hashlib.sha256(payload.encode() + content.encode()).hexdigest()


def owner_filter(obj: L2UseCase | L3UseCase):
    col = ConfigCommit.l2_id if isinstance(obj, L2UseCase) else ConfigCommit.l3_id
    return col == obj.id


def head(db: Session, obj) -> ConfigCommit | None:
    q = select(ConfigCommit).where(owner_filter(obj)).order_by(ConfigCommit.rev.desc()).limit(1)
    return db.scalar(q)


def history(db: Session, obj) -> list[ConfigCommit]:
    q = select(ConfigCommit).where(owner_filter(obj)).order_by(ConfigCommit.rev.desc())
    return list(db.scalars(q))


def find(db: Session, obj, ref: str) -> ConfigCommit | None:
    """A commit by full or abbreviated sha (at least 4 characters), `r<rev>` or a tag name."""
    base = select(ConfigCommit).where(owner_filter(obj))
    if m := re.fullmatch(r"r(\d+)", ref):
        return db.scalar(base.where(ConfigCommit.rev == int(m.group(1))))
    if re.fullmatch(r"[0-9a-f]{4,64}", ref):
        found = list(db.scalars(base.where(ConfigCommit.sha.startswith(ref)).limit(2)))
        if len(found) == 1:
            return found[0]
    return db.scalar(base.join(ConfigTag).where(ConfigTag.name == ref))


def make_commit(
    db: Session,
    obj,
    content: str,
    message: str,
    author: str,
    at: datetime | None = None,
    restored_from: str | None = None,
) -> ConfigCommit:
    parent = head(db, obj)
    at = at or datetime.now(UTC)
    c = ConfigCommit(
        rev=(parent.rev + 1) if parent else 1,
        parent_sha=parent.sha if parent else None,
        content=content,
        message=message,
        author=author,
        created_at=at,
        restored_from=restored_from,
        sha=commit_sha(parent.sha if parent else None, author, at, message, content),
    )
    if isinstance(obj, L2UseCase):
        c.l2_id = obj.id
    else:
        c.l3_id = obj.id
    db.add(c)
    db.flush()
    return c


def tag_names(db: Session, obj) -> set[str]:
    q = select(ConfigTag.name).join(ConfigCommit).where(owner_filter(obj))
    return set(db.scalars(q))


def add_tag(db: Session, obj, commit: ConfigCommit, name: str, user: str) -> ConfigTag:
    tag = ConfigTag(commit_id=commit.id, name=name, created_by=user)
    db.add(tag)
    db.flush()
    db.refresh(commit)
    return tag


def tag_verified(db: Session, obj, when: date, user: str) -> str | None:
    """Tag the current config version when a use case is verified, so you can see what ran."""
    current = head(db, obj)
    if current is None:
        return None
    existing = tag_names(db, obj)
    name, n = f"verified-{when.isoformat()}", 2
    while name in existing:
        name, n = f"verified-{when.isoformat()}-{n}", n + 1
    add_tag(db, obj, current, name, user)
    return name


def diff_lines(old: str, new: str, context: int = 3) -> dict:
    """Unified diff as text plus structured lines for rendering."""
    a, b = old.splitlines(), new.splitlines()
    lines: list[dict] = []
    added = removed = 0
    for group in difflib.SequenceMatcher(None, a, b, autojunk=False).get_grouped_opcodes(context):
        i1, i2, j1, j2 = group[0][1], group[-1][2], group[0][3], group[-1][4]
        lines.append({"kind": "hunk", "text": f"@@ -{i1 + 1},{i2 - i1} +{j1 + 1},{j2 - j1} @@"})
        for tag, a1, a2, b1, b2 in group:
            if tag == "equal":
                for k in range(a2 - a1):
                    lines.append(
                        {"kind": "ctx", "text": a[a1 + k], "old": a1 + k + 1, "new": b1 + k + 1}
                    )
                continue
            for k in range(a1, a2):
                lines.append({"kind": "del", "text": a[k], "old": k + 1, "new": None})
                removed += 1
            for k in range(b1, b2):
                lines.append({"kind": "add", "text": b[k], "old": None, "new": k + 1})
                added += 1
    unified = "\n".join(difflib.unified_diff(a, b, "a", "b", lineterm=""))
    return {"lines": lines, "unified": unified, "added": added, "removed": removed}


def heads_for(db: Session, level: str, ids: list[int]) -> dict[int, ConfigCommit]:
    """Latest commit per use case id, for list views."""
    col = ConfigCommit.l2_id if level == "l2" else ConfigCommit.l3_id
    if not ids:
        return {}
    latest = (
        select(col.label("oid"), func.max(ConfigCommit.rev).label("rev"))
        .where(col.in_(ids))
        .group_by(col)
        .subquery()
    )
    q = select(ConfigCommit).join(
        latest, (col == latest.c.oid) & (ConfigCommit.rev == latest.c.rev)
    )
    return {getattr(c, f"{level}_id"): c for c in db.scalars(q)}
