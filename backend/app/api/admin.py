from fastapi import APIRouter
from pydantic import BaseModel

from app import audit
from app.api.deps import DB, SettingsDep
from app.demo import apply_demo_data
from app.security import Admin

router = APIRouter(prefix="/admin", tags=["admin"])


class DemoIn(BaseModel):
    seed: int = 42


@router.post("/demo-data")
def demo_data(body: DemoIn, user: Admin, db: DB, settings: SettingsDep) -> dict[str, int]:
    """Overwrite metrics, statuses, data sources and dates with generated demo data."""
    counts = apply_demo_data(db, body.seed, default_interval=settings.default_verification_days)
    audit.record(db, user, "demo_data", "catalogue", "all", {"seed": body.seed} | counts)
    db.commit()
    return counts
