"""Remove the maturity self-assessment feature: drop its table

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-14 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Old snapshots keep a "maturity_level" key in their kpis JSON; nothing reads it any more.
    op.drop_table("maturity_assessments")


def downgrade() -> None:
    # Recreates the empty table only; dropped assessments cannot be restored.
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
