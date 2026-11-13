"""Business layer (drivers, compliance) and reference lists."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import audit
from app.api.deps import DB
from app.models import (
    BusinessDriver,
    ComplianceDriver,
    ComplianceSource,
    ReferenceItem,
    RefKind,
)
from app.schemas import (
    BusinessDriverIn,
    BusinessDriverOut,
    ComplianceDriverIn,
    ComplianceDriverOut,
    ComplianceSourceIn,
    ComplianceSourceOut,
    RefItemIn,
    RefItemOut,
)
from app.security import Editor, Reader

router = APIRouter(tags=["business layer"])


def _commit(db, what: str) -> None:
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"{what} already exists or is in use") from e


def _get(db, model, id_: int):
    obj = db.get(model, id_)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return obj


# ---------------------------------------------------------------- reference lists


@router.get("/references/{kind}", response_model=list[RefItemOut])
def list_refs(kind: RefKind, _: Reader, db: DB) -> list[ReferenceItem]:
    return list(
        db.scalars(
            select(ReferenceItem).where(ReferenceItem.kind == kind).order_by(ReferenceItem.name)
        )
    )


@router.post("/references/{kind}", response_model=RefItemOut, status_code=201)
def create_ref(kind: RefKind, body: RefItemIn, user: Editor, db: DB) -> ReferenceItem:
    item = ReferenceItem(kind=kind, **body.model_dump())
    db.add(item)
    audit.record(db, user, "create", kind.value, body.name, body.model_dump())
    _commit(db, "Entry")
    return item


@router.patch("/references/{kind}/{item_id}", response_model=RefItemOut)
def update_ref(kind: RefKind, item_id: int, body: RefItemIn, user: Editor, db: DB) -> ReferenceItem:
    item = _get(db, ReferenceItem, item_id)
    if item.kind != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    data = body.model_dump()
    changes = audit.diff({k: getattr(item, k) for k in data}, data)
    for k, v in data.items():
        setattr(item, k, v)
    audit.record(db, user, "update", kind.value, item.name, changes)
    _commit(db, "Entry")
    return item


@router.delete("/references/{kind}/{item_id}", status_code=204)
def delete_ref(kind: RefKind, item_id: int, user: Editor, db: DB) -> None:
    item = _get(db, ReferenceItem, item_id)
    if item.kind != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    audit.record(db, user, "delete", kind.value, item.name)
    db.delete(item)
    _commit(db, "Entry")


# ---------------------------------------------------------------- business drivers


@router.get("/business-drivers", response_model=list[BusinessDriverOut])
def list_bd(_: Reader, db: DB) -> list[BusinessDriver]:
    return list(db.scalars(select(BusinessDriver).order_by(BusinessDriver.code)))


@router.post("/business-drivers", response_model=BusinessDriverOut, status_code=201)
def create_bd(body: BusinessDriverIn, user: Editor, db: DB) -> BusinessDriver:
    bd = BusinessDriver(**body.model_dump())
    db.add(bd)
    audit.record(db, user, "create", "business_driver", body.code, body.model_dump())
    _commit(db, "Business driver")
    return bd


@router.patch("/business-drivers/{bd_id}", response_model=BusinessDriverOut)
def update_bd(bd_id: int, body: BusinessDriverIn, user: Editor, db: DB) -> BusinessDriver:
    bd = _get(db, BusinessDriver, bd_id)
    data = body.model_dump()
    changes = audit.diff({k: getattr(bd, k) for k in data}, data)
    for k, v in data.items():
        setattr(bd, k, v)
    audit.record(db, user, "update", "business_driver", bd.code, changes)
    _commit(db, "Business driver")
    return bd


@router.delete("/business-drivers/{bd_id}", status_code=204)
def delete_bd(bd_id: int, user: Editor, db: DB) -> None:
    bd = _get(db, BusinessDriver, bd_id)
    audit.record(db, user, "delete", "business_driver", bd.code)
    db.delete(bd)
    _commit(db, "Business driver")


# ---------------------------------------------------------------- compliance


@router.get("/compliance", response_model=list[ComplianceSourceOut])
def list_compliance(_: Reader, db: DB) -> list[ComplianceSource]:
    return list(db.scalars(select(ComplianceSource).order_by(ComplianceSource.id)))


@router.post("/compliance", response_model=ComplianceSourceOut, status_code=201)
def create_source(body: ComplianceSourceIn, user: Editor, db: DB) -> ComplianceSource:
    src = ComplianceSource(name=body.name)
    db.add(src)
    audit.record(db, user, "create", "compliance_source", body.name)
    _commit(db, "Compliance source")
    return src


@router.delete("/compliance/{source_id}", status_code=204)
def delete_source(source_id: int, user: Editor, db: DB) -> None:
    src = _get(db, ComplianceSource, source_id)
    audit.record(db, user, "delete", "compliance_source", src.name)
    db.delete(src)
    _commit(db, "Compliance source")


@router.post("/compliance/{source_id}/drivers", response_model=ComplianceDriverOut, status_code=201)
def create_cd(source_id: int, body: ComplianceDriverIn, user: Editor, db: DB) -> ComplianceDriver:
    src = _get(db, ComplianceSource, source_id)
    cd = ComplianceDriver(source=src, **body.model_dump())
    db.add(cd)
    audit.record(db, user, "create", "compliance_driver", f"{src.name}/{body.ref}")
    _commit(db, "Compliance driver")
    return cd


@router.patch("/compliance/drivers/{cd_id}", response_model=ComplianceDriverOut)
def update_cd(cd_id: int, body: ComplianceDriverIn, user: Editor, db: DB) -> ComplianceDriver:
    cd = _get(db, ComplianceDriver, cd_id)
    data = body.model_dump()
    changes = audit.diff({k: getattr(cd, k) for k in data}, data)
    for k, v in data.items():
        setattr(cd, k, v)
    audit.record(db, user, "update", "compliance_driver", cd.ref, changes)
    _commit(db, "Compliance driver")
    return cd


@router.delete("/compliance/drivers/{cd_id}", status_code=204)
def delete_cd(cd_id: int, user: Editor, db: DB) -> None:
    cd = _get(db, ComplianceDriver, cd_id)
    audit.record(db, user, "delete", "compliance_driver", cd.ref)
    db.delete(cd)
    _commit(db, "Compliance driver")
