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
    service = "service"  # API token account for integrations (no interactive login)


class Lifecycle(enum.StrEnum):
    onboarding = "onboarding"
    operational = "operational"
    maintenance = "maintenance"
    offloading = "offloading"
    retired = "retired"


class VerificationResult(enum.StrEnum):
    ok = "ok"
    issues = "issues"


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
    # TOTP second factor for local accounts (app/totp.py). The secret is encrypted with SECRET_KEY.
    totp_secret: Mapped[str | None] = mapped_column(String(255))
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # UI language (en, de, nl); None = follow the browser
    locale: Mapped[str | None] = mapped_column(String(8))
    totp_last_step: Mapped[int | None] = mapped_column(Integer)
    # sha256 hashes of unused one-time recovery codes
    recovery_codes: Mapped[list[str]] = mapped_column(JSON, default=list)


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
    # "Operational" definition of done: {item_key: {"by": user, "at": iso date}} (app/lifecycle.py)
    dod: Mapped[dict] = mapped_column(JSON, default=dict)
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
    # ids of the rule in the SIEM (saved search name, analytics rule id ...), see app/siem.py
    siem_rule_ids: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    onboarded_at: Mapped[date | None] = mapped_column(Date)
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    last_verified_by: Mapped[str | None] = mapped_column(String(64))
    verification_interval_days: Mapped[int | None] = mapped_column(Integer)
    # Risk-based prioritisation (PLAN 2.11); NULL = inherit from the L2 use case.
    risk_level: Mapped[int | None] = mapped_column(Integer)
    target_implementation: Mapped[float | None] = mapped_column(Float)
    dod: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    parent: Mapped[L2UseCase] = relationship(back_populates="children")
    references: Mapped[list[ReferenceItem]] = relationship(secondary=l3_references)


class Verification(Base):
    """History behind last_verified_at on L2 use cases and L3 rules."""

    __tablename__ = "verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    l2_id: Mapped[int | None] = mapped_column(
        ForeignKey("l2_use_cases.id", ondelete="CASCADE"), index=True
    )
    l3_id: Mapped[int | None] = mapped_column(
        ForeignKey("l3_use_cases.id", ondelete="CASCADE"), index=True
    )
    verified_at: Mapped[date] = mapped_column(Date)
    username: Mapped[str] = mapped_column(String(64))
    result: Mapped[VerificationResult] = mapped_column(
        _enum(VerificationResult, "verification_result")
    )
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ConfigCommit(Base):
    """One immutable version of the free-form YAML configuration of an L2 use case or L3 rule.

    Commits are never changed or deleted (docs/PLAN.md section 4a). `sha` is a SHA-256 over the
    parent, author, time, message and content, like a git commit id.
    """

    __tablename__ = "config_commits"
    # one revision number per use case, also when two people save at the same moment
    __table_args__ = (
        UniqueConstraint("l2_id", "rev", name="uq_config_commits_l2_rev"),
        UniqueConstraint("l3_id", "rev", name="uq_config_commits_l3_rev"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    l2_id: Mapped[int | None] = mapped_column(
        ForeignKey("l2_use_cases.id", ondelete="CASCADE"), index=True
    )
    l3_id: Mapped[int | None] = mapped_column(
        ForeignKey("l3_use_cases.id", ondelete="CASCADE"), index=True
    )
    rev: Mapped[int] = mapped_column(Integer)
    sha: Mapped[str] = mapped_column(String(64), unique=True)
    parent_sha: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(String(500))
    author: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    restored_from: Mapped[str | None] = mapped_column(String(64))
    # optional git repository sync (app/gitsync.py): commit id in the connected repo
    git_sha: Mapped[str | None] = mapped_column(String(64))
    # "app" = saved in the app, "git" = imported from a commit made directly in the repository
    source: Mapped[str] = mapped_column(String(8), default="app", server_default="app")

    tags: Mapped[list["ConfigTag"]] = relationship(
        back_populates="commit", cascade="all, delete-orphan", order_by="ConfigTag.id"
    )


class ConfigTag(Base):
    """A named marker on a commit, e.g. `prod` or `verified-2026-11-13`."""

    __tablename__ = "config_tags"
    __table_args__ = (UniqueConstraint("commit_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    commit_id: Mapped[int] = mapped_column(
        ForeignKey("config_commits.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    commit: Mapped[ConfigCommit] = relationship(back_populates="tags")


class LifecycleEvent(Base):
    """A lifecycle status change with the reason (change driver) behind it (PLAN 2.4)."""

    __tablename__ = "lifecycle_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    l2_id: Mapped[int | None] = mapped_column(
        ForeignKey("l2_use_cases.id", ondelete="CASCADE"), index=True
    )
    l3_id: Mapped[int | None] = mapped_column(
        ForeignKey("l3_use_cases.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[Lifecycle | None] = mapped_column(_enum(Lifecycle, "lifecycle"))
    to_status: Mapped[Lifecycle] = mapped_column(_enum(Lifecycle, "lifecycle"))
    driver_type: Mapped[str] = mapped_column(String(32), default="unspecified")
    driver: Mapped[str] = mapped_column(String(64), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    dod_override: Mapped[bool] = mapped_column(Boolean, default=False)
    username: Mapped[str] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Snapshot(Base):
    """Frozen copy of all computed scores and counts, for trends and comparisons."""

    __tablename__ = "snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(16), default="manual")  # manual|scheduled|demo
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    taken_by: Mapped[str] = mapped_column(String(64), default="system")
    data: Mapped[dict] = mapped_column(JSON)


class GitSyncState(Base):
    """Single row with the state of the optional git repository sync."""

    __tablename__ = "git_sync_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    head_sha: Mapped[str | None] = mapped_column(String(64))
    # two-way sync: remote commits up to this one have been read back into the app
    last_imported_sha: Mapped[str | None] = mapped_column(String(64))
    last_import_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # what the last import did not take over (conflicts, invalid YAML, unknown paths)
    import_notes: Mapped[list | None] = mapped_column(JSON, default=list)


class MaturityAssessment(Base):
    """SOC maturity self-assessment on the CMMI scale 1..5 (PLAN 2.12)."""

    __tablename__ = "maturity_assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    level: Mapped[int] = mapped_column(Integer)
    target_level: Mapped[int | None] = mapped_column(Integer)
    # optional level per aspect, e.g. {"people": 2, "process": 3, "technology": 3}
    aspects: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str] = mapped_column(Text, default="")
    assessed_by: Mapped[str] = mapped_column(String(64))
    assessed_at: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OutputMetric(Base):
    """Output metrics of an L3 rule for one month (PLAN 2.13)."""

    __tablename__ = "output_metrics"
    __table_args__ = (UniqueConstraint("l3_id", "period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    l3_id: Mapped[int] = mapped_column(
        ForeignKey("l3_use_cases.id", ondelete="CASCADE"), index=True
    )
    period: Mapped[date] = mapped_column(Date, index=True)  # first day of the month
    alerts: Mapped[int] = mapped_column(Integer, default=0)
    incidents: Mapped[int] = mapped_column(Integer, default=0)
    false_positives: Mapped[int] = mapped_column(Integer, default=0)
    false_negatives: Mapped[int | None] = mapped_column(Integer)  # often unknown
    note: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | csv | demo
    updated_by: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


# ---------------------------------------------------------------- integrations (M7)


class ApiToken(Base):
    """Bearer token of a service account, for scripts and SIEM integrations."""

    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    prefix: Mapped[str] = mapped_column(String(16))  # shown in the list to recognise a token
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class SiemSource(Base):
    """A SIEM that pushes its rule inventory or alert counts (Splunk, Sentinel, QRadar ...)."""

    __tablename__ = "siem_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True)
    inventory_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    inventory_by: Mapped[str | None] = mapped_column(String(64))
    alerts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    alerts_by: Mapped[str | None] = mapped_column(String(64))
    # outcome of the last alert push: counts and SIEM rule ids that matched no use case
    alerts_report: Mapped[dict | None] = mapped_column(JSON, default=dict)

    rules: Mapped[list["SiemRule"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", order_by="SiemRule.rule_id"
    )


class SiemRule(Base):
    """One detection rule as the SIEM reported it in its last inventory push."""

    __tablename__ = "siem_rules"
    __table_args__ = (UniqueConstraint("source_id", "rule_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("siem_sources.id", ondelete="CASCADE"), index=True
    )
    rule_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    severity: Mapped[str] = mapped_column(String(32), default="")
    techniques: Mapped[list[str]] = mapped_column(JSON, default=list)

    source: Mapped[SiemSource] = relationship(back_populates="rules")
