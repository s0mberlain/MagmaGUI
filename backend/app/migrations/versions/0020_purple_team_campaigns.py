"""Purple team campaigns, test cases, test library and red team accounts (PROJ-3, issue #63)

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-18 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("expires_on", sa.Date(), nullable=True))
        batch.add_column(
            sa.Column("expiry_manual", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    op.create_table(
        "test_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("technique", sa.String(16), nullable=False),
        sa.Column("procedure", sa.Text(), nullable=False),
        sa.Column("tools", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_test_templates_technique", "test_templates", ["technique"])

    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("name_key", sa.String(255), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("planned_start", sa.Date(), nullable=False),
        sa.Column("planned_end", sa.Date(), nullable=False),
        sa.Column(
            "status", _enum("campaign_status", "planned", "running", "closed"), nullable=False
        ),
        sa.Column("white_box", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "campaign_red_team",
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("campaigns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
    )
    op.create_table(
        "campaign_tests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("technique", sa.String(16), nullable=False),
        sa.Column("procedure", sa.Text(), nullable=False),
        sa.Column("tools", sa.Text(), nullable=False),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("test_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "exec_status",
            _enum("exec_status", "not_run", "executed", "not_executed"),
            nullable=False,
        ),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("red_notes", sa.Text(), nullable=False),
        sa.Column(
            "outcome",
            _enum("test_outcome", "blocked", "alerted", "logged", "not_detected"),
            nullable=True,
        ),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("blue_notes", sa.Text(), nullable=False),
        sa.Column("outcome_by", sa.String(64), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index("ix_campaign_tests_campaign_id", "campaign_tests", ["campaign_id"])
    op.create_index("ix_campaign_tests_technique", "campaign_tests", ["technique"])
    op.create_table(
        "campaign_test_rules",
        sa.Column(
            "test_id",
            sa.Integer(),
            sa.ForeignKey("campaign_tests.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "l3_id",
            sa.Integer(),
            sa.ForeignKey("l3_use_cases.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_campaign_test_rules_l3_id", "campaign_test_rules", ["l3_id"])


def downgrade() -> None:
    op.drop_index("ix_campaign_test_rules_l3_id", table_name="campaign_test_rules")
    op.drop_table("campaign_test_rules")
    op.drop_index("ix_campaign_tests_technique", table_name="campaign_tests")
    op.drop_index("ix_campaign_tests_campaign_id", table_name="campaign_tests")
    op.drop_table("campaign_tests")
    op.drop_table("campaign_red_team")
    op.drop_table("campaigns")
    op.drop_index("ix_test_templates_technique", table_name="test_templates")
    op.drop_table("test_templates")
    op.execute("DELETE FROM users WHERE role = 'red_team'")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("expiry_manual")
        batch.drop_column("expires_on")
