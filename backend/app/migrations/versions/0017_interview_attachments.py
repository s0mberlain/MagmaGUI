"""Evidence files on business owner interviews (#34): interview_attachments table

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-16 17:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "interview_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("interview_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["interview_id"],
            ["interviews.id"],
            name="fk_interview_attachments_interview_id_interviews",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_interview_attachments"),
    )
    op.create_index(
        "ix_interview_attachments_interview_id", "interview_attachments", ["interview_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_interview_attachments_interview_id", table_name="interview_attachments")
    op.drop_table("interview_attachments")
