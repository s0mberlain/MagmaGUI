"""Security review fixes: API token scopes, client IP in the audit log, SIEM alert batch ids

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-14 11:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Tokens made before scopes existed keep what a SIEM script needs plus read access.
    with op.batch_alter_table("api_tokens") as b:
        b.add_column(
            sa.Column("scopes", sa.JSON(), server_default='["siem", "read"]', nullable=False)
        )
    with op.batch_alter_table("audit_log") as b:
        b.add_column(sa.Column("ip", sa.String(length=64), nullable=True))
    op.create_table(
        "siem_alert_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.String(length=128), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_by", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["siem_sources.id"],
            name="fk_siem_alert_batches_source_id_siem_sources",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_siem_alert_batches"),
        sa.UniqueConstraint("source_id", "batch_id", name="uq_siem_alert_batches_source_id"),
    )
    op.create_index("ix_siem_alert_batches_source_id", "siem_alert_batches", ["source_id"])


def downgrade() -> None:
    op.drop_table("siem_alert_batches")
    with op.batch_alter_table("audit_log") as b:
        b.drop_column("ip")
    with op.batch_alter_table("api_tokens") as b:
        b.drop_column("scopes")
