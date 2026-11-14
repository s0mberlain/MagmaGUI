from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import audit
from app.api.deps import DB, SettingsDep
from app.demo import apply_demo_data
from app.security import Admin

router = APIRouter(prefix="/admin", tags=["admin"])


class DemoIn(BaseModel):
    seed: int = 42


class DemoStatus(BaseModel):
    allowed: bool


@router.get("/demo-data", response_model=DemoStatus)
def demo_status(_: Admin, settings: SettingsDep) -> DemoStatus:
    return DemoStatus(allowed=settings.demo_data_allowed)


@router.post("/demo-data")
def demo_data(body: DemoIn, user: Admin, db: DB, settings: SettingsDep) -> dict[str, int]:
    """Overwrite metrics, statuses, data sources and dates with generated demo data. This also
    deletes all verifications, lifecycle changes and the config history, so it is only possible
    on an installation that was set up for demo data."""
    if not settings.demo_data_allowed:
        raise HTTPException(
            409,
            "Demo data is switched off on this installation, because loading it deletes the "
            "verification, lifecycle and configuration history. Set ALLOW_DEMO_DATA=true to "
            "allow it.",
        )
    counts = apply_demo_data(db, body.seed, default_interval=settings.default_verification_days)
    audit.record(db, user, "demo_data", "catalogue", "all", {"seed": body.seed} | counts)
    db.commit()
    return counts
