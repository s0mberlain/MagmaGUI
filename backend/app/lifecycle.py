"""Lifecycle changes, change drivers and the "Operational" definition of done (PLAN 2.4)."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import L2UseCase, L3UseCase, Lifecycle, LifecycleEvent

# From the MaGMa framework: a use case is only "Operational" when all of these are done.
DOD_ITEMS = [
    (
        "log_sources",
        "Log sources deliver data",
        "Required log sources are connected and delivering.",
    ),
    ("scope", "Scope implemented", "All assets, users or networks in scope are covered."),
    ("incident_response", "Incident response documented", "There is a playbook for the alerts."),
    ("roles", "Roles documented", "Owner and responsibilities for the use case are written down."),
    ("rules", "Rules implemented, tested and documented", "Detection logic is live and tested."),
]
DOD_KEYS = [k for k, *_ in DOD_ITEMS]

# Why a use case changes (maintenance drivers in the framework).
DRIVERS = {
    "environmental": [
        ("threat_landscape", "Threat landscape"),
        ("business", "Business change"),
        ("regulation", "Regulation"),
        ("it_infrastructure", "IT infrastructure"),
    ],
    "operational": [
        ("red_teaming", "Red / purple teaming"),
        ("incident_lessons", "Incident lessons learned"),
        ("threat_hunting", "Threat hunting"),
        ("tuning", "Tuning / false positives"),
    ],
    "other": [("other", "Other")],
}
DRIVER_TYPES = [*DRIVERS, "unspecified"]


def dod_missing(obj: L2UseCase | L3UseCase) -> list[str]:
    done = obj.dod or {}
    return [k for k in DOD_KEYS if k not in done]


def valid_driver(driver_type: str, driver: str) -> bool:
    if driver_type == "unspecified":
        return driver == ""
    return driver in {k for k, _ in DRIVERS.get(driver_type, [])}


def record_change(
    db: Session,
    obj: L2UseCase | L3UseCase,
    from_status: Lifecycle | None,
    to_status: Lifecycle,
    username: str,
    driver_type: str = "unspecified",
    driver: str = "",
    note: str = "",
    override: bool = False,
    at: datetime | None = None,
) -> LifecycleEvent:
    ev = LifecycleEvent(
        from_status=from_status,
        to_status=to_status,
        driver_type=driver_type,
        driver=driver,
        note=note,
        dod_override=override,
        username=username,
        at=at or datetime.now(UTC),
    )
    if isinstance(obj, L2UseCase):
        ev.l2_id = obj.id
    else:
        ev.l3_id = obj.id
    db.add(ev)
    return ev
