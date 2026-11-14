"""Excel import / export and JSON backup (docs/PLAN.md section 7)."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app import audit, excel
from app.api.deps import DB
from app.models import (
    BusinessDriver,
    ComplianceSource,
    ConfigCommit,
    L1UseCase,
    L2UseCase,
    L3UseCase,
    LifecycleEvent,
    OutputMetric,
    ReferenceItem,
    Role,
    Verification,
)
from app.security import Editor, Reader

router = APIRouter(tags=["import / export"])

MAX_UPLOAD = 20 * 1024 * 1024
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/export/excel")
def export_excel(_: Reader, db: DB) -> Response:
    data = excel.export_workbook(db)
    name = f"magma-ucf-{date.today().isoformat()}.xlsx"
    return Response(
        data, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@router.get("/export/json")
def export_json(_: Reader, db: DB) -> dict:
    """Export of the catalogue with its history (verifications, lifecycle changes, output
    metrics, configurations) for other tools. It is not a backup: users, API tokens, snapshots
    and the audit log are not in it and it cannot be imported; back up the database for that."""

    def rows(model, *fields):
        return [{f: getattr(x, f) for f in fields} for x in db.scalars(select(model))]

    l2 = db.scalars(
        select(L2UseCase).options(
            selectinload(L2UseCase.actors),
            selectinload(L2UseCase.business_drivers),
            selectinload(L2UseCase.compliance_drivers),
        )
    )
    l3 = db.scalars(select(L3UseCase).options(selectinload(L3UseCase.references)))
    l2_code = dict(db.execute(select(L2UseCase.id, L2UseCase.code)).all())
    l3_code = dict(db.execute(select(L3UseCase.id, L3UseCase.code)).all())
    return {
        "format": "magma-ucf-export",
        "version": 2,
        "exported_at": date.today().isoformat(),
        "references": rows(ReferenceItem, "kind", "name", "description"),
        "business_drivers": rows(BusinessDriver, "code", "name", "description"),
        "compliance": [
            {
                "name": s.name,
                "drivers": [
                    {"ref": d.ref, "name": d.name, "description": d.description} for d in s.drivers
                ],
            }
            for s in db.scalars(select(ComplianceSource))
        ],
        "l1": rows(
            L1UseCase,
            *(
                "code name threat_category purpose stakeholders description applicable sort_order"
            ).split(),
        ),
        "l2": [
            {
                **{
                    f: getattr(x, f)
                    for f in (
                        "code name description lifecycle_status risk_level target_implementation "
                        "onboarded_at last_verified_at last_verified_by dod"
                    ).split()
                },
                "actors": [a.name for a in x.actors],
                "business_drivers": [b.code for b in x.business_drivers],
                "compliance_drivers": [
                    {"source": c.source.name, "ref": c.ref} for c in x.compliance_drivers
                ],
            }
            for x in l2
        ],
        "l3": [
            {
                **{
                    f: getattr(x, f)
                    for f in (
                        "code name description effectiveness implementation coverage "
                        "lifecycle_status comments attack_techniques onboarded_at "
                        "last_verified_at last_verified_by verification_interval_days "
                        "siem_rule_ids risk_level target_implementation dod"
                    ).split()
                },
                "references": [{"kind": r.kind, "name": r.name} for r in x.references],
            }
            for x in l3
        ],
        "verifications": [
            {
                "use_case": l3_code.get(v.l3_id) or l2_code.get(v.l2_id),
                "verified_at": v.verified_at,
                "username": v.username,
                "result": v.result,
                "note": v.note,
            }
            for v in db.scalars(select(Verification))
        ],
        "lifecycle_events": [
            {
                "use_case": l3_code.get(e.l3_id) or l2_code.get(e.l2_id),
                "from_status": e.from_status,
                "to_status": e.to_status,
                "driver_type": e.driver_type,
                "driver": e.driver,
                "note": e.note,
                "dod_override": e.dod_override,
                "username": e.username,
                "at": e.at,
            }
            for e in db.scalars(select(LifecycleEvent).order_by(LifecycleEvent.id))
        ],
        "output_metrics": [
            {
                "rule": l3_code.get(m.l3_id),
                "period": m.period,
                "alerts": m.alerts,
                "incidents": m.incidents,
                "false_positives": m.false_positives,
                "false_negatives": m.false_negatives,
                "note": m.note,
                "source": m.source,
            }
            for m in db.scalars(select(OutputMetric).order_by(OutputMetric.id))
        ],
        "config_commits": [
            {
                "use_case": l3_code.get(c.l3_id) or l2_code.get(c.l2_id),
                "rev": c.rev,
                "sha": c.sha,
                "parent_sha": c.parent_sha,
                "message": c.message,
                "author": c.author,
                "created_at": c.created_at,
                "restored_from": c.restored_from,
                "tags": [t.name for t in c.tags],
                "content": c.content,
            }
            for c in db.scalars(select(ConfigCommit).order_by(ConfigCommit.id))
        ],
    }


@router.post("/import/excel")
async def import_excel(
    user: Editor,
    db: DB,
    file: UploadFile = File(...),
    mode: Literal["merge", "replace"] = Form("merge"),
    dry_run: bool = Form(True),
) -> dict:
    """Preview (dry_run=true, nothing saved) or apply a workbook. Replace is admin-only."""
    if mode == "replace" and user.role != Role.admin:
        raise HTTPException(403, "Only admins can replace the catalogue")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is larger than 20 MB")
    try:
        report = excel.import_workbook(
            db,
            data,
            replace=mode == "replace",
            dry_run=dry_run,
            username=user.username,
            is_admin=user.role == Role.admin,
        )
    except excel.ImportFailed as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    if dry_run:
        db.rollback()
    else:
        audit.record(
            db,
            user,
            "import",
            "catalogue",
            file.filename or "workbook",
            {"mode": mode, "counts": report.counts, "errors": len(report.errors)},
        )
        db.commit()
    return vars(report)
