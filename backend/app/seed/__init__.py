"""Default MaGMa catalogue (from the MaGMa UCF Tool v1.0 workbook) and first admin account."""

import json
import logging
import secrets
from importlib import resources
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    BusinessDriver,
    ComplianceSource,
    L1UseCase,
    L2UseCase,
    L3UseCase,
    ReferenceItem,
    RefKind,
    Role,
    User,
)
from app.security import hash_password

log = logging.getLogger("magma.seed")


def load_catalogue() -> dict[str, Any]:
    return json.loads(resources.files("app.seed").joinpath("catalogue.json").read_text("utf-8"))


def seed_catalogue(db: Session) -> bool:
    """Load the default catalogue into an empty database. Returns True if anything was loaded."""
    if db.scalar(select(func.count()).select_from(L1UseCase)):
        return False
    data = load_catalogue()

    for kind, items in data["references"].items():
        for it in items:
            db.add(
                ReferenceItem(kind=RefKind(kind), name=it["name"], description=it["description"])
            )
    for bd in data["business_drivers"]:
        db.add(BusinessDriver(**bd))
    for name in data["compliance_sources"]:
        db.add(ComplianceSource(name=name))

    l1_by_code: dict[str, L1UseCase] = {}
    for i, row in enumerate(data["l1"]):
        l1 = L1UseCase(sort_order=i, **row)
        db.add(l1)
        l1_by_code[l1.code] = l1

    l2_by_code: dict[str, L2UseCase] = {}
    for row in data["l2"]:
        l2 = L2UseCase(parent=l1_by_code[row["code"][:2]], **row)
        db.add(l2)
        l2_by_code[l2.code] = l2

    for row in data["l3"]:
        db.add(L3UseCase(parent=l2_by_code[row["code"][:6]], **row))

    db.commit()
    log.info(
        "Seeded MaGMa catalogue: %d L1, %d L2, %d L3",
        len(data["l1"]),
        len(data["l2"]),
        len(data["l3"]),
    )
    return True


def ensure_admin(db: Session, settings: Settings) -> str | None:
    """Create the first admin when there are no users. Returns a generated password, if any."""
    if db.scalar(select(func.count()).select_from(User)):
        return None
    password = settings.admin_password
    generated = None
    if not password:
        password = generated = secrets.token_urlsafe(18)
    db.add(
        User(
            username=settings.admin_user,
            display_name="Administrator",
            role=Role.admin,
            password_hash=hash_password(password),
        )
    )
    db.commit()
    if generated:
        log.warning(
            "Created admin user '%s' with generated password: %s  (set ADMIN_PASSWORD to choose "
            "one; change it after the first login)",
            settings.admin_user,
            generated,
        )
    else:
        log.info("Created admin user '%s'", settings.admin_user)
    return generated
