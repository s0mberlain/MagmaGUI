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
    """Full backup of the catalogue, verifications and configuration history."""

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
        "format": "magma-ucf-backup",
        "version": 1,
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
                        "onboarded_at last_verified_at last_verified_by"
                    ).split()
                },
                "actors": [a.name for a in x.actors],
                "business_drivers": [b.code for b in x.business_drivers],
                "compliance_drivers": [c.ref for c in x.compliance_drivers],
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
                        "last_verified_at last_verified_by verification_interval_days"
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
