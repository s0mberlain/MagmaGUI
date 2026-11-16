"""Business owner interviews (#17): systems, interviews, system links, STRIDE mapping

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-16 12:00:00

The default STRIDE -> L2 mapping is not inserted here but at startup (app/interviews.py
ensure_default_mapping), once per installation, only for L2 codes that exist.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "systems",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_key", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("owner_name", sa.String(length=255), nullable=False),
        sa.Column("owner_department", sa.String(length=255), nullable=False),
        sa.Column("owner_email", sa.String(length=254), nullable=True),
        sa.Column("criticality", sa.Integer(), nullable=False),
        sa.Column("internet_facing", sa.Boolean(), nullable=False),
        sa.Column("data_classification", sa.String(length=16), nullable=False),
        sa.Column("review_interval_months", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_systems"),
        sa.UniqueConstraint("name_key", name="uq_systems_name_key"),
    )
    op.create_table(
        "interviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("system_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "completed",
                "confirmed",
                name="interview_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("interview_date", sa.Date(), nullable=False),
        sa.Column("participants", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("previous_id", sa.Integer(), nullable=True),
        sa.Column("analyst", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by", sa.String(length=64), nullable=True),
        sa.Column("confirmed_by", sa.String(length=255), nullable=True),
        sa.Column("confirmed_at", sa.Date(), nullable=True),
        sa.Column("confirmation_recorded_by", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["system_id"],
            ["systems.id"],
            name="fk_interviews_system_id_systems",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["previous_id"],
            ["interviews.id"],
            name="fk_interviews_previous_id_interviews",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_interviews"),
    )
    op.create_index("ix_interviews_system_id", "interviews", ["system_id"])
    op.create_table(
        "system_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("system_id", sa.Integer(), nullable=False),
        sa.Column("l2_id", sa.Integer(), nullable=False),
        sa.Column("interview_id", sa.Integer(), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["system_id"],
            ["systems.id"],
            name="fk_system_links_system_id_systems",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["l2_id"],
            ["l2_use_cases.id"],
            name="fk_system_links_l2_id_l2_use_cases",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["interview_id"],
            ["interviews.id"],
            name="fk_system_links_interview_id_interviews",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_system_links"),
        sa.UniqueConstraint("system_id", "l2_id", name="uq_system_links_system_id"),
    )
    op.create_index("ix_system_links_system_id", "system_links", ["system_id"])
    op.create_index("ix_system_links_l2_id", "system_links", ["l2_id"])
    op.create_table(
        "stride_mappings",
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("l2_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["l2_id"],
            ["l2_use_cases.id"],
            name="fk_stride_mappings_l2_id_l2_use_cases",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("category", "l2_id", name="pk_stride_mappings"),
    )


def downgrade() -> None:
    op.drop_table("stride_mappings")
    op.drop_index("ix_system_links_l2_id", table_name="system_links")
    op.drop_index("ix_system_links_system_id", table_name="system_links")
    op.drop_table("system_links")
    op.drop_index("ix_interviews_system_id", table_name="interviews")
    op.drop_table("interviews")
    op.drop_table("systems")
