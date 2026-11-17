"""Owner sign-off files on interviews (#42) and at most one draft interview per system (#45)

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-17 08:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("interview_attachments") as batch:
        batch.add_column(
            sa.Column("signoff", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # Two drafts of one system could exist before (#45); keep the newest one only.
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, system_id FROM interviews WHERE status = 'draft' ORDER BY id DESC")
    ).all()
    seen: set[int] = set()
    for interview_id, system_id in rows:
        if system_id in seen:
            conn.execute(sa.text("DELETE FROM interviews WHERE id = :id"), {"id": interview_id})
        seen.add(system_id)
    op.create_index(
        "uq_interviews_one_draft",
        "interviews",
        ["system_id"],
        unique=True,
        sqlite_where=sa.text("status = 'draft'"),
        postgresql_where=sa.text("status = 'draft'"),
    )


def downgrade() -> None:
    op.drop_index("uq_interviews_one_draft", table_name="interviews")
    with op.batch_alter_table("interview_attachments") as batch:
        batch.drop_column("signoff")
