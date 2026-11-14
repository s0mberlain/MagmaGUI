"""SIEM integration: API tokens, SIEM rule ids on L3, SIEM rule inventory

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-14 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("l3_use_cases") as b:
        b.add_column(sa.Column("siem_rule_ids", sa.JSON(), server_default="[]", nullable=False))
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("prefix", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_api_tokens_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_api_tokens"),
        sa.UniqueConstraint("token_hash", name="uq_api_tokens_token_hash"),
    )
    op.create_index("ix_api_tokens_user_id", "api_tokens", ["user_id"])
    op.create_table(
        "siem_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("inventory_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("inventory_by", sa.String(length=64), nullable=True),
        sa.Column("alerts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("alerts_by", sa.String(length=64), nullable=True),
        sa.Column("alerts_report", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_siem_sources"),
        sa.UniqueConstraint("name", name="uq_siem_sources_name"),
    )
    op.create_table(
        "siem_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("rule_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("techniques", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["siem_sources.id"],
            name="fk_siem_rules_source_id_siem_sources",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_siem_rules"),
        sa.UniqueConstraint("source_id", "rule_id", name="uq_siem_rules_source_id"),
    )
    op.create_index("ix_siem_rules_source_id", "siem_rules", ["source_id"])


def downgrade() -> None:
    op.drop_table("siem_rules")
    op.drop_table("siem_sources")
    op.drop_table("api_tokens")
    with op.batch_alter_table("l3_use_cases") as b:
        b.drop_column("siem_rule_ids")
