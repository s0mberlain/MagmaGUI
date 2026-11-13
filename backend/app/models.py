"""Database models for the MaGMa Use Case Framework.

Layers (see docs/PLAN.md section 4):
- business layer: business drivers, compliance sources and drivers
- threat layer: L1 and L2 use cases
- implementation layer: L3 rules and the reference lists (log sources, detection
  technologies, scopes) plus threat actors used on L2
"""

import enum
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(enum.StrEnum):
    admin = "admin"
    analyst = "analyst"
    auditor = "auditor"


class AuthSource(enum.StrEnum):
    local = "local"
    sso = "sso"


class Lifecycle(enum.StrEnum):
    onboarding = "onboarding"
    operational = "operational"
    maintenance = "maintenance"
    offloading = "offloading"
    retired = "retired"


class RefKind(enum.StrEnum):
    threat_actor = "threat_actor"
    detection_technology = "detection_technology"
    log_source = "log_source"
    scope = "scope"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    # Store as plain strings (no native DB enum) so new values need no type migration.
    return Enum(e, name=name, native_enum=False, length=32, validate_strings=True)


# ---------------------------------------------------------------- users & auth


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    email: Mapped[str | None] = mapped_column(String(254))
    role: Mapped[Role] = mapped_column(_enum(Role, "role"))
    auth_source: Mapped[AuthSource] = mapped_column(
        _enum(AuthSource, "auth_source"), default=AuthSource.local
    )
    password_hash: Mapped[str | None] = mapped_column(String(255))
    sso_subject: Mapped[str | None] = mapped_column(String(255), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    username: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))  # create | update | delete | login ...
    entity: Mapped[str] = mapped_column(String(32), index=True)
    entity_key: Mapped[str] = mapped_column(String(128))
    changes: Mapped[dict] = mapped_column(JSON, default=dict)


# ---------------------------------------------------------------- business layer


class BusinessDriver(Base):
    __tablename__ = "business_drivers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")


class ComplianceSource(Base):
    __tablename__ = "compliance_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)

    drivers: Mapped[list["ComplianceDriver"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class ComplianceDriver(Base):
    __tablename__ = "compliance_drivers"
    __table_args__ = (UniqueConstraint("source_id", "ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("compliance_sources.id", ondelete="CASCADE"))
    ref: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")

    source: Mapped[ComplianceSource] = relationship(back_populates="drivers")


class ReferenceItem(Base):
    """Threat actors, detection technologies, log sources and scopes."""

    __tablename__ = "reference_items"
    __table_args__ = (UniqueConstraint("kind", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[RefKind] = mapped_column(_enum(RefKind, "ref_kind"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------- threat layer

l2_actors = Table(
    "l2_actors",
    Base.metadata,
    Column("l2_id", ForeignKey("l2_use_cases.id", ondelete="CASCADE"), primary_key=True),
    Column("item_id", ForeignKey("reference_items.id", ondelete="CASCADE"), primary_key=True),
)
l2_business_drivers = Table(
    "l2_business_drivers",
    Base.metadata,
    Column("l2_id", ForeignKey("l2_use_cases.id", ondelete="CASCADE"), primary_key=True),
    Column("driver_id", ForeignKey("business_drivers.id", ondelete="CASCADE"), primary_key=True),
)
l2_compliance_drivers = Table(
    "l2_compliance_drivers",
    Base.metadata,
    Column("l2_id", ForeignKey("l2_use_cases.id", ondelete="CASCADE"), primary_key=True),
    Column("driver_id", ForeignKey("compliance_drivers.id", ondelete="CASCADE"), primary_key=True),
)
l3_references = Table(
    "l3_references",
    Base.metadata,
    Column("l3_id", ForeignKey("l3_use_cases.id", ondelete="CASCADE"), primary_key=True),
    Column("item_id", ForeignKey("reference_items.id", ondelete="CASCADE"), primary_key=True),
)


class L1UseCase(Base):
    __tablename__ = "l1_use_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(2), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    threat_category: Mapped[str] = mapped_column(String(128), default="")
    purpose: Mapped[str] = mapped_column(Text, default="")
    stakeholders: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    applicable: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    children: Mapped[list["L2UseCase"]] = relationship(
        back_populates="parent", order_by="L2UseCase.code"
    )


class L2UseCase(Base):
    __tablename__ = "l2_use_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    l1_id: Mapped[int] = mapped_column(
        ForeignKey("l1_use_cases.id", ondelete="RESTRICT"), index=True
    )
    code: Mapped[str] = mapped_column(String(6), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    lifecycle_status: Mapped[Lifecycle] = mapped_column(
        _enum(Lifecycle, "lifecycle"), default=Lifecycle.onboarding
    )
    risk_level: Mapped[int | None] = mapped_column(Integer)
    target_implementation: Mapped[float | None] = mapped_column(Float)
    onboarded_at: Mapped[date | None] = mapped_column(Date)
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    last_verified_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    parent: Mapped[L1UseCase] = relationship(back_populates="children")
    children: Mapped[list["L3UseCase"]] = relationship(
        back_populates="parent", order_by="L3UseCase.code"
    )
    actors: Mapped[list[ReferenceItem]] = relationship(secondary=l2_actors)
    business_drivers: Mapped[list[BusinessDriver]] = relationship(secondary=l2_business_drivers)
    compliance_drivers: Mapped[list[ComplianceDriver]] = relationship(
        secondary=l2_compliance_drivers
    )


class L3UseCase(Base):
    __tablename__ = "l3_use_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    l2_id: Mapped[int] = mapped_column(
        ForeignKey("l2_use_cases.id", ondelete="RESTRICT"), index=True
    )
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # Metrics are fractions 0..1; NULL = not assessed (see PLAN 2.5).
    effectiveness: Mapped[float | None] = mapped_column(Float)
    implementation: Mapped[float | None] = mapped_column(Float)
    coverage: Mapped[float | None] = mapped_column(Float)
    lifecycle_status: Mapped[Lifecycle] = mapped_column(
        _enum(Lifecycle, "lifecycle"), default=Lifecycle.onboarding
    )
    comments: Mapped[str] = mapped_column(Text, default="")
    attack_techniques: Mapped[list[str]] = mapped_column(JSON, default=list)
    onboarded_at: Mapped[date | None] = mapped_column(Date)
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    last_verified_by: Mapped[str | None] = mapped_column(String(64))
    verification_interval_days: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    parent: Mapped[L2UseCase] = relationship(back_populates="children")
    references: Mapped[list[ReferenceItem]] = relationship(secondary=l3_references)
