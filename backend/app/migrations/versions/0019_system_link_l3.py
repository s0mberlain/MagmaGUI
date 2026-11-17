"""System links to single L3 rules (threat modelling: select L2 or L3 use cases)

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-17 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("system_links") as batch:
        batch.add_column(sa.Column("l3_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_system_links_l3_id_l3_use_cases",
            "l3_use_cases",
            ["l3_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.drop_constraint("uq_system_links_system_id", type_="unique")
        batch.create_unique_constraint(
            "uq_system_links_system_l2_l3", ["system_id", "l2_id", "l3_id"]
        )
    op.create_index("ix_system_links_l3_id", "system_links", ["l3_id"])


def downgrade() -> None:
    op.execute("DELETE FROM system_links WHERE l3_id IS NOT NULL")
    op.drop_index("ix_system_links_l3_id", table_name="system_links")
    with op.batch_alter_table("system_links") as batch:
        batch.drop_constraint("uq_system_links_system_l2_l3", type_="unique")
        batch.create_unique_constraint("uq_system_links_system_id", ["system_id", "l2_id"])
        batch.drop_constraint("fk_system_links_l3_id_l3_use_cases", type_="foreignkey")
        batch.drop_column("l3_id")
