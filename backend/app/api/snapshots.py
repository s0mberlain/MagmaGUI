"""Snapshots, snapshot comparison and control-metric trends."""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import audit, snapshots
from app.api.deps import DB, SettingsDep
from app.models import Snapshot
from app.security import Admin, Editor, Reader

router = APIRouter(tags=["snapshots & trends"])


class SnapshotOut(BaseModel):
    id: int
    label: str
    kind: str
    taken_at: datetime
    taken_by: str
    kpis: dict[str, Any]


class SnapshotFull(SnapshotOut):
    data: dict[str, Any]


class SnapshotIn(BaseModel):
    label: Annotated[str, Field(max_length=200)] = ""


class MetricOut(BaseModel):
    key: str
    label: str
    unit: str


class TrendPoint(BaseModel):
    id: int | None
    label: str
    kind: str
    taken_at: datetime
    kpis: dict[str, Any]
    lifecycle_changes: int
    config_commits: int


class TrendsOut(BaseModel):
    metrics: list[MetricOut]
    schedule: str
    points: list[TrendPoint]


class CompareOut(BaseModel):
    a: SnapshotOut
    b: SnapshotOut
    kpis: dict[str, dict[str, Any]]
    l1: list[dict[str, Any]]
    l2: list[dict[str, Any]]
    rules: list[dict[str, Any]]


def _out(s: Snapshot) -> SnapshotOut:
    return SnapshotOut(
        id=s.id,
        label=s.label,
        kind=s.kind,
        taken_at=snapshots._aware(s.taken_at),
        taken_by=s.taken_by,
        kpis=s.data.get("kpis", {}),
    )


def _live(db: DB, settings: SettingsDep) -> SnapshotFull:
    data = snapshots.capture(db, settings.default_verification_days)
    return SnapshotFull(
        id=0,
        label="Now",
        kind="live",
        taken_at=datetime.now(UTC),
        taken_by="",
        kpis=data["kpis"],
        data=data,
    )


def _get(db: DB, settings: SettingsDep, ref: str) -> SnapshotFull:
    if ref in ("live", "0"):
        return _live(db, settings)
    s = db.get(Snapshot, int(ref)) if ref.isdigit() else None
    if s is None:
        raise HTTPException(404, "Snapshot not found")
    return SnapshotFull(**_out(s).model_dump(), data=s.data)


@router.get("/snapshots", response_model=list[SnapshotOut])
def list_snapshots(_: Reader, db: DB) -> list[SnapshotOut]:
    return [_out(s) for s in db.scalars(select(Snapshot).order_by(Snapshot.taken_at.desc()))]


@router.post("/snapshots", response_model=SnapshotOut, status_code=201)
def create_snapshot(body: SnapshotIn, user: Editor, db: DB, settings: SettingsDep) -> SnapshotOut:
    s = snapshots.take(
        db, settings.default_verification_days, label=body.label.strip(), by=user.username
    )
    audit.record(db, user, "create", "snapshot", str(s.id), {"label": s.label})
    db.commit()
    return _out(s)


@router.get("/snapshots/compare", response_model=CompareOut)
def compare(
    _: Reader, db: DB, settings: SettingsDep, a: str = Query(...), b: str = Query("live")
) -> CompareOut:
    x, y = _get(db, settings, a), _get(db, settings, b)
    if x.taken_at > y.taken_at:
        x, y = y, x
    diff = snapshots.compare(x.data, y.data)
    return CompareOut(
        a=SnapshotOut(**x.model_dump(exclude={"data"})),
        b=SnapshotOut(**y.model_dump(exclude={"data"})),
        **diff,
    )


@router.get("/snapshots/{ref}", response_model=SnapshotFull)
def get_snapshot(ref: str, _: Reader, db: DB, settings: SettingsDep) -> SnapshotFull:
    return _get(db, settings, ref)


@router.delete("/snapshots/{snap_id}", status_code=204)
def delete_snapshot(snap_id: int, user: Admin, db: DB) -> None:
    s = db.get(Snapshot, snap_id)
    if s is None:
        raise HTTPException(404, "Snapshot not found")
    audit.record(db, user, "delete", "snapshot", str(s.id), {"label": s.label})
    db.delete(s)
    db.commit()


@router.get("/trends", response_model=TrendsOut)
def trends(_: Reader, db: DB, settings: SettingsDep) -> TrendsOut:
    snaps = list(db.scalars(select(Snapshot).order_by(Snapshot.taken_at)))
    live = _live(db, settings)
    rows = [
        (s.id, s.label, s.kind, snapshots._aware(s.taken_at), s.data.get("kpis", {})) for s in snaps
    ]
    rows.append((None, "Now", "live", live.taken_at, live.kpis))
    points, prev = [], datetime.min.replace(tzinfo=UTC)
    for sid, label, kind, at, kpis in rows:
        points.append(
            TrendPoint(
                id=sid,
                label=label,
                kind=kind,
                taken_at=at,
                kpis=kpis,
                **snapshots.framework_changes(db, prev, at),
            )
        )
        prev = at
    return TrendsOut(
        metrics=[MetricOut(key=k, label=lbl, unit=u) for k, lbl, u in snapshots.METRICS],
        schedule=settings.snapshot_schedule,
        points=points,
    )
