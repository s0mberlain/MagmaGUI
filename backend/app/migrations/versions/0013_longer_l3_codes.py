"""Allow extra identifiers in L3 rule IDs (XX-YYY-WIN-AD-01): widen l3_use_cases.code

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-16 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("l3_use_cases") as b:
        b.alter_column("code", existing_type=sa.String(length=16), type_=sa.String(length=64))


def downgrade() -> None:
    # Fails if a rule ID longer than 16 characters exists; rename those first.
    with op.batch_alter_table("l3_use_cases") as b:
        b.alter_column("code", existing_type=sa.String(length=64), type_=sa.String(length=16))
