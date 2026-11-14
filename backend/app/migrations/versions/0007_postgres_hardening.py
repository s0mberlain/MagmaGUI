"""unique revision per use case for config commits

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-14 06:30:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("config_commits") as b:
        b.create_unique_constraint("uq_config_commits_l2_rev", ["l2_id", "rev"])
        b.create_unique_constraint("uq_config_commits_l3_rev", ["l3_id", "rev"])


def downgrade() -> None:
    with op.batch_alter_table("config_commits") as b:
        b.drop_constraint("uq_config_commits_l3_rev", type_="unique")
        b.drop_constraint("uq_config_commits_l2_rev", type_="unique")
