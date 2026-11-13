from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from app.models import AuthSource, Lifecycle, RefKind, Role

# Identifier rules from the MaGMa UCF tool: L1 "XX", L2 "XX-YYY", L3 "XX-YYY-NN".
L1Code = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
L2Code = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}-[A-Z0-9]{3}$")]
L3Code = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}-[A-Z0-9]{3}-\d{2,3}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Metric = Annotated[float, Field(ge=0, le=1)]
AttackId = Annotated[str, StringConstraints(pattern=r"^T\d{4}(\.\d{3})?$")]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth & users


class LoginIn(BaseModel):
    username: str
    password: str
    # authenticator code or a recovery code, for accounts with two-factor login
    otp: str | None = None


class UserOut(ORM):
    id: int
    username: str
    display_name: str
    email: str | None
    role: Role
    auth_source: AuthSource
    active: bool
    totp_enabled: bool = False
    last_login_at: datetime | None
    created_at: datetime


class UserCreate(BaseModel):
    username: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._@-]{2,64}$")]
    display_name: str = ""
    email: EmailStr | None = None
    role: Role
    password: str


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: EmailStr | None = None
    role: Role | None = None
    active: bool | None = None
    password: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class AuthConfigOut(BaseModel):
    local_login_enabled: bool
    sso_enabled: bool
    sso_label: str = "Sign in with SSO"


# ---------------------------------------------------------------- business layer & references


class RefItemIn(BaseModel):
    name: Name
    description: str = ""


class RefItemOut(ORM):
    id: int
    kind: RefKind
    name: str
    description: str


class BusinessDriverIn(BaseModel):
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]
    name: Name
    description: str = ""


class BusinessDriverOut(ORM):
    id: int
    code: str
    name: str
    description: str


class ComplianceDriverIn(BaseModel):
    ref: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    name: str = ""
    description: str = ""


class ComplianceDriverOut(ORM):
    id: int
    source_id: int
    ref: str
    name: str
    description: str


class ComplianceSourceOut(ORM):
    id: int
    name: str
    drivers: list[ComplianceDriverOut]


class ComplianceSourceIn(BaseModel):
    name: Name


# ---------------------------------------------------------------- use cases


class L1Base(BaseModel):
    name: Name
    threat_category: str = ""
    purpose: str = ""
    stakeholders: str = ""
    description: str = ""
    applicable: bool = True
    sort_order: int = 0


class L1Create(L1Base):
    code: L1Code


class L1Update(BaseModel):
    name: Name | None = None
    threat_category: str | None = None
    purpose: str | None = None
    stakeholders: str | None = None
    description: str | None = None
    applicable: bool | None = None
    sort_order: int | None = None


class L1Out(ORM):
    id: int
    code: str
    name: str
    threat_category: str
    purpose: str
    stakeholders: str
    description: str
    applicable: bool
    sort_order: int
    l2_count: int = 0
    l3_count: int = 0


class TrackingFields(BaseModel):
    lifecycle_status: Lifecycle | None = None
    onboarded_at: date | None = None
    last_verified_at: date | None = None


class L2Create(TrackingFields):
    code: L2Code
    name: Name
    description: str = ""
    risk_level: Annotated[int, Field(ge=1, le=5)] | None = None
    target_implementation: Metric | None = None
    actors: list[str] = []
    business_drivers: list[str] = []
    compliance_driver_ids: list[int] = []


class L2Update(TrackingFields):
    name: Name | None = None
    description: str | None = None
    risk_level: Annotated[int, Field(ge=1, le=5)] | None = None
    target_implementation: Metric | None = None
    actors: list[str] | None = None
    business_drivers: list[str] | None = None
    compliance_driver_ids: list[int] | None = None


class L2Out(BaseModel):
    id: int
    code: str
    l1_code: str
    name: str
    description: str
    lifecycle_status: Lifecycle
    risk_level: int | None
    target_implementation: float | None
    onboarded_at: date | None
    last_verified_at: date | None
    last_verified_by: str | None
    actors: list[str]
    business_drivers: list[str]
    compliance_driver_ids: list[int]
    l3_count: int


class L3Create(TrackingFields):
    code: L3Code
    name: Name
    description: str = ""
    effectiveness: Metric | None = None
    implementation: Metric | None = None
    coverage: Metric | None = None
    comments: str = ""
    attack_techniques: list[AttackId] = []
    verification_interval_days: Annotated[int, Field(ge=1, le=3650)] | None = None
    risk_level: Annotated[int, Field(ge=1, le=5)] | None = None
    target_implementation: Metric | None = None
    log_sources: list[str] = []
    detection_technologies: list[str] = []
    scopes: list[str] = []


class L3Update(TrackingFields):
    name: Name | None = None
    description: str | None = None
    effectiveness: Metric | None = None
    implementation: Metric | None = None
    coverage: Metric | None = None
    comments: str | None = None
    attack_techniques: list[AttackId] | None = None
    verification_interval_days: Annotated[int, Field(ge=1, le=3650)] | None = None
    risk_level: Annotated[int, Field(ge=1, le=5)] | None = None
    target_implementation: Metric | None = None
    log_sources: list[str] | None = None
    detection_technologies: list[str] | None = None
    scopes: list[str] | None = None


class L3Out(BaseModel):
    id: int
    code: str
    l1_code: str
    l2_code: str
    name: str
    description: str
    effectiveness: float | None
    implementation: float | None
    coverage: float | None
    lifecycle_status: Lifecycle
    comments: str
    attack_techniques: list[str]
    onboarded_at: date | None
    last_verified_at: date | None
    last_verified_by: str | None
    verification_interval_days: int | None
    risk_level: int | None
    target_implementation: float | None
    log_sources: list[str]
    detection_technologies: list[str]
    scopes: list[str]
    updated_at: datetime
    # risk and target in effect (own value, else the L2's, else derived from the risk level)
    effective_risk: int | None = None
    risk_source: str | None = None
    effective_target: float | None = None
    target_source: str | None = None
    implementation_gap: float | None = None
    priority: float | None = None
    # calculated (app/scoring.py)
    weight: float | None = None
    potential: float | None = None
    assessed: bool = False
    scored: bool = False
    verification_due: date | None = None
    verification_overdue: bool = False


class CatalogueSummary(BaseModel):
    l1: int
    l2: int
    l3: int
    business_drivers: int
    compliance_drivers: int
    references: dict[str, int]


class AuditOut(ORM):
    id: int
    at: datetime
    username: str
    action: str
    entity: str
    entity_key: str
    changes: dict
