"""growth: rule risk/target, maturity assessments, TOTP

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-13 21:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "maturity_assessments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("target_level", sa.Integer(), nullable=True),
        sa.Column("aspects", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("assessed_by", sa.String(length=64), nullable=False),
        sa.Column("assessed_at", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_maturity_assessments")),
    )
    # plain ADD COLUMN: a batch table rebuild would break foreign keys on SQLite
    op.add_column("l3_use_cases", sa.Column("risk_level", sa.Integer(), nullable=True))
    op.add_column("l3_use_cases", sa.Column("target_implementation", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("totp_secret", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("totp_last_step", sa.Integer(), nullable=True))
    op.add_column(
        "users",
        sa.Column("recovery_codes", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        for c in ("recovery_codes", "totp_last_step", "totp_enabled", "totp_secret"):
            b.drop_column(c)
    with op.batch_alter_table("l3_use_cases") as b:
        b.drop_column("target_implementation")
        b.drop_column("risk_level")
    op.drop_table("maturity_assessments")
