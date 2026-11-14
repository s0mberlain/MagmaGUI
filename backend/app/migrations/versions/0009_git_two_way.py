"""two-way git sync: commit source and import state

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-14 08:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("config_commits") as b:
        b.add_column(sa.Column("source", sa.String(length=8), server_default="app", nullable=False))
    with op.batch_alter_table("git_sync_state") as b:
        b.add_column(sa.Column("last_imported_sha", sa.String(length=64), nullable=True))
        b.add_column(sa.Column("last_import_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("import_notes", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("git_sync_state") as b:
        b.drop_column("import_notes")
        b.drop_column("last_import_at")
        b.drop_column("last_imported_sha")
    with op.batch_alter_table("config_commits") as b:
        b.drop_column("source")
