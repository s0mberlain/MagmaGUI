"""output metrics per rule and month

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-13 21:55:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "output_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("l3_id", sa.Integer(), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("alerts", sa.Integer(), nullable=False),
        sa.Column("incidents", sa.Integer(), nullable=False),
        sa.Column("false_positives", sa.Integer(), nullable=False),
        sa.Column("false_negatives", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["l3_id"],
            ["l3_use_cases.id"],
            name=op.f("fk_output_metrics_l3_id_l3_use_cases"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_output_metrics")),
        sa.UniqueConstraint("l3_id", "period", name=op.f("uq_output_metrics_l3_id")),
    )
    op.create_index(op.f("ix_output_metrics_l3_id"), "output_metrics", ["l3_id"])
    op.create_index(op.f("ix_output_metrics_period"), "output_metrics", ["period"])


def downgrade() -> None:
    op.drop_table("output_metrics")
