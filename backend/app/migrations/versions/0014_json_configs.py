"""Configurations are JSON (issue #28): convert the latest YAML version of each rule to JSON

For every L3 rule whose latest configuration is not valid JSON but parses as YAML, a new commit
with the same data as JSON is added (author "system"). Nothing is changed or deleted: the YAML
versions stay in the history and can be compared or restored. YAML comments are not carried over.
Configurations of L2 use cases (no longer used, issue #25) are left as they are.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-16 11:00:00
"""

import hashlib
import json
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
import yaml
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUTHOR = "system"
MESSAGE = "Convert YAML configuration to JSON"

commits = sa.table(
    "config_commits",
    sa.column("id", sa.Integer),
    sa.column("l3_id", sa.Integer),
    sa.column("rev", sa.Integer),
    sa.column("sha", sa.String),
    sa.column("parent_sha", sa.String),
    sa.column("content", sa.Text),
    sa.column("message", sa.String),
    sa.column("author", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("restored_from", sa.String),
    sa.column("source", sa.String),
)


def _sha(parent: str | None, author: str, at: datetime, message: str, content: str) -> str:
    # same formula as app/configs.py commit_sha (kept here so the migration does not change)
    payload = f"parent {parent or '-'}\nauthor {author}\ndate {at.isoformat()}\n\n{message}\n\0"
    return hashlib.sha256(payload.encode() + content.encode()).hexdigest()


def to_json(content: str) -> str | None:
    """The JSON text for a YAML configuration, or None when nothing needs to (or can) change."""
    if not content.strip():
        return None
    try:
        json.loads(content)
        return None  # already JSON
    except ValueError:
        pass
    try:
        docs = list(yaml.safe_load_all(content))
    except yaml.YAMLError:
        return None  # neither: leave it, the editor shows where it is broken
    docs = [d for d in docs if d is not None]
    if not docs:
        return None  # only comments
    data = docs[0] if len(docs) == 1 else docs
    # dates and other YAML-only types become strings
    return json.dumps(data, indent=2, ensure_ascii=False, default=str) + "\n"


def upgrade() -> None:
    conn = op.get_bind()
    latest = (
        sa.select(commits.c.l3_id, sa.func.max(commits.c.rev).label("rev"))
        .where(commits.c.l3_id.is_not(None))
        .group_by(commits.c.l3_id)
        .subquery()
    )
    heads = conn.execute(
        sa.select(commits.c.l3_id, commits.c.rev, commits.c.sha, commits.c.content).join(
            latest, (commits.c.l3_id == latest.c.l3_id) & (commits.c.rev == latest.c.rev)
        )
    ).all()
    at = datetime.now(UTC)
    for h in heads:
        new = to_json(h.content)
        if new is None:
            continue
        conn.execute(
            commits.insert().values(
                l3_id=h.l3_id,
                rev=h.rev + 1,
                sha=_sha(h.sha, AUTHOR, at, MESSAGE, new),
                parent_sha=h.sha,
                content=new,
                message=MESSAGE,
                author=AUTHOR,
                created_at=at,
                restored_from=None,
                source="app",
            )
        )


def downgrade() -> None:
    # The conversion commits are ordinary history entries; they stay (restore an older
    # revision in the app to go back to the YAML text).
    pass
