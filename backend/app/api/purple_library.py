"""Purple team library: test procedures (templates), campaign templates, the bundled Atomic Red
Team index and imports (app/purple_import.py)."""

from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import attack, audit
from app import purple_import as pimp
from app.api.deps import DB
from app.api.purple import Items, Name, Short, Text, _dedupe, techniques_in
from app.models import PtCampaignTemplate, PtTemplate, PtTestCase, User
from app.security import Editor, Reader

router = APIRouter(tags=["purple teaming"])

MAX_IMPORT = 10 * 1024 * 1024

TEMPLATE_FIELDS = (
    "name",
    "description",
    "techniques",
    "tactic",
    "platforms",
    "executor",
    "command",
    "cleanup",
    "operator_guidance",
    "expected_defenses",
    "detection_steps",
    "prevention_steps",
    "references",
    "tags",
    "archived",
)


class TemplateIn(BaseModel):
    name: Name
    description: Text = ""
    techniques: Items = []
    tactic: Short = ""
    platforms: Items = []
    executor: Short = ""
    command: Text = ""
    cleanup: Text = ""
    operator_guidance: Text = ""
    expected_defenses: Items = []
    detection_steps: Text = ""
    prevention_steps: Text = ""
    references: Items = []
    tags: Items = []
    archived: bool = False

    _t = field_validator("techniques")(lambda cls, v: techniques_in(v))
    _d = field_validator("platforms", "expected_defenses", "references", "tags")(
        lambda cls, v: _dedupe(v)
    )


class CampaignTemplateIn(BaseModel):
    name: Name
    description: Text = ""
    template_ids: Annotated[list[int], Field(max_length=500)] = []


def template_out(t: PtTemplate, used: int = 0) -> dict:
    return {
        "id": t.id,
        **{
            f: (list(getattr(t, f) or []) if isinstance(getattr(t, f), list) else getattr(t, f))
            for f in TEMPLATE_FIELDS
        },
        "source": t.source,
        "source_ref": t.source_ref,
        "used": used,
        "updated_at": t.updated_at,
    }


def _template(db: Session, template_id: int) -> PtTemplate:
    t = db.get(PtTemplate, template_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test procedure not found")
    return t


def _name_free(db: Session, model, name: str, own_id: int | None = None) -> None:
    other = db.scalar(select(model).where(model.name_key == name.lower()))
    if other is not None and other.id != own_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{other.name} exists already")


def _usage(db: Session) -> dict[int, int]:
    out: dict[int, int] = {}
    for tid in db.scalars(
        select(PtTestCase.template_id).where(PtTestCase.template_id.is_not(None))
    ):
        out[tid] = out.get(tid, 0) + 1
    return out


def _snapshot(t: PtTemplate) -> dict:
    return {f: (list(v) if isinstance(v := getattr(t, f), list) else v) for f in TEMPLATE_FIELDS}


# ---------------------------------------------------------------- templates


@router.get("/purple/templates")
def list_templates(
    _: Reader,
    db: DB,
    q: str = "",
    technique: str = "",
    archived: bool = False,
) -> list[dict]:
    used = _usage(db)
    out = []
    needle = q.strip().lower()
    tech = technique.strip().upper()
    for t in db.scalars(select(PtTemplate).order_by(PtTemplate.name_key)):
        if t.archived and not archived:
            continue
        if needle and needle not in t.name.lower() and needle not in (t.description or "").lower():
            continue
        if tech and not any(x == tech or x.startswith(tech + ".") for x in t.techniques or []):
            continue
        out.append(template_out(t, used.get(t.id, 0)))
    return out


def _create_template(
    db: Session, data: dict, user: User, source: str = "custom", ref: str = ""
) -> PtTemplate:
    t = PtTemplate(name_key=data["name"].lower(), source=source, source_ref=ref, **data)
    db.add(t)
    audit.record(db, user, "create", "pt_template", t.name, data | {"source": source})
    return t


@router.post("/purple/templates", status_code=201)
def create_template(body: TemplateIn, user: Editor, db: DB) -> dict:
    _name_free(db, PtTemplate, body.name)
    t = _create_template(db, body.model_dump(), user)
    db.commit()
    return template_out(t)


@router.get("/purple/templates/{template_id}")
def get_template(template_id: int, _: Reader, db: DB) -> dict:
    t = _template(db, template_id)
    return template_out(t, _usage(db).get(t.id, 0))


@router.put("/purple/templates/{template_id}")
def update_template(template_id: int, body: TemplateIn, user: Editor, db: DB) -> dict:
    t = _template(db, template_id)
    _name_free(db, PtTemplate, body.name, t.id)
    before, old_name = _snapshot(t), t.name
    for f, v in body.model_dump().items():
        setattr(t, f, v)
    t.name_key = body.name.lower()
    changes = audit.diff(before, _snapshot(t))
    if changes:
        audit.record(db, user, "update", "pt_template", old_name, changes)
    db.commit()
    return template_out(t, _usage(db).get(t.id, 0))


@router.delete("/purple/templates/{template_id}", status_code=204)
def delete_template(template_id: int, user: Editor, db: DB) -> None:
    """Test cases made from it keep their copy (and their lineage for the trends)."""
    t = _template(db, template_id)
    for ct in db.scalars(select(PtCampaignTemplate)):
        if t.id in (ct.template_ids or []):
            ct.template_ids = [x for x in ct.template_ids if x != t.id]
    audit.record(db, user, "delete", "pt_template", t.name)
    db.delete(t)
    db.commit()


# ---------------------------------------------------------------- campaign templates


def campaign_template_out(db: Session, ct: PtCampaignTemplate) -> dict:
    items = []
    for tid in ct.template_ids or []:
        t = db.get(PtTemplate, tid)
        if t is not None:
            items.append({"id": t.id, "name": t.name, "techniques": t.techniques or []})
    return {
        "id": ct.id,
        "name": ct.name,
        "description": ct.description,
        "template_ids": [x["id"] for x in items],
        "templates": items,
        "updated_at": ct.updated_at,
    }


def _campaign_template(db: Session, ct_id: int) -> PtCampaignTemplate:
    ct = db.get(PtCampaignTemplate, ct_id)
    if ct is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign template not found")
    return ct


def _check_templates(db: Session, ids: list[int]) -> list[int]:
    out = []
    for tid in ids:
        _template(db, tid)
        if tid not in out:
            out.append(tid)
    return out


@router.get("/purple/campaign-templates")
def list_campaign_templates(_: Reader, db: DB) -> list[dict]:
    q = select(PtCampaignTemplate).order_by(PtCampaignTemplate.name_key)
    return [campaign_template_out(db, ct) for ct in db.scalars(q)]


@router.post("/purple/campaign-templates", status_code=201)
def create_campaign_template(body: CampaignTemplateIn, user: Editor, db: DB) -> dict:
    _name_free(db, PtCampaignTemplate, body.name)
    ids = _check_templates(db, body.template_ids)
    ct = PtCampaignTemplate(
        name=body.name, name_key=body.name.lower(), description=body.description, template_ids=ids
    )
    db.add(ct)
    audit.record(db, user, "create", "pt_campaign_template", ct.name, body.model_dump())
    db.commit()
    return campaign_template_out(db, ct)


@router.put("/purple/campaign-templates/{ct_id}")
def update_campaign_template(ct_id: int, body: CampaignTemplateIn, user: Editor, db: DB) -> dict:
    ct = _campaign_template(db, ct_id)
    _name_free(db, PtCampaignTemplate, body.name, ct.id)
    before = {"name": ct.name, "description": ct.description, "template_ids": list(ct.template_ids)}
    ct.name, ct.name_key, ct.description = body.name, body.name.lower(), body.description
    ct.template_ids = _check_templates(db, body.template_ids)
    changes = audit.diff(
        before,
        {"name": ct.name, "description": ct.description, "template_ids": list(ct.template_ids)},
    )
    if changes:
        audit.record(db, user, "update", "pt_campaign_template", before["name"], changes)
    db.commit()
    return campaign_template_out(db, ct)


@router.delete("/purple/campaign-templates/{ct_id}", status_code=204)
def delete_campaign_template(ct_id: int, user: Editor, db: DB) -> None:
    ct = _campaign_template(db, ct_id)
    audit.record(db, user, "delete", "pt_campaign_template", ct.name)
    db.delete(ct)
    db.commit()


# ---------------------------------------------------------------- Atomic Red Team


@router.get("/purple/atomics")
def list_atomics(
    _: Reader,
    db: DB,
    technique: str = "",
    platform: str = "",
    q: str = "",
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    data = pimp.atomics()
    adopted = set(db.scalars(select(PtTemplate.source_ref).where(PtTemplate.source == "atomic")))
    tech = technique.strip().upper()
    plat = platform.strip().lower()
    needle = q.strip().lower()
    hits = []
    for t in data["tests"]:
        if tech and not (t["technique"] == tech or t["technique"].startswith(tech + ".")):
            continue
        if plat and plat not in [p.lower() for p in t["platforms"]]:
            continue
        if needle and needle not in t["name"].lower() and needle not in t["technique_name"].lower():
            continue
        hits.append(t)
    return {
        "source": data.get("source", ""),
        "commit": data.get("commit", ""),
        "total": len(data["tests"]),
        "matches": len(hits),
        "platforms": sorted({p for t in data["tests"] for p in t["platforms"]}),
        "tests": [
            {
                "guid": t["guid"],
                "technique": t["technique"],
                "technique_name": t["technique_name"] or attack.name(t["technique"]) or "",
                "name": t["name"],
                "description": t["description"][:600],
                "platforms": t["platforms"],
                "executor": t["executor"],
                "elevation": t["elevation"],
                "command": t["command"][:2000],
                "adopted": t["guid"] in adopted,
            }
            for t in hits[:limit]
        ],
    }


def _unique_name(db: Session, name: str, ref: str) -> str:
    if db.scalar(select(PtTemplate).where(PtTemplate.name_key == name.lower())) is None:
        return name
    suffix = f" ({ref[:8]})" if ref else " (2)"
    return name[: 255 - len(suffix)] + suffix


@router.post("/purple/atomics/{guid}/adopt", status_code=201)
def adopt_atomic(guid: str, user: Editor, db: DB) -> dict:
    """Copy an atomic test into the library (once; adopting it again returns the copy)."""
    existing = db.scalar(
        select(PtTemplate).where(PtTemplate.source == "atomic", PtTemplate.source_ref == guid)
    )
    if existing is not None:
        return template_out(existing, _usage(db).get(existing.id, 0))
    t = pimp.atomic(guid)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Atomic test not found")
    data = pimp.atomic_template(t)
    source, ref = data.pop("source"), data.pop("source_ref")
    data["name"] = _unique_name(db, data["name"], ref)
    tpl = _create_template(db, data, user, source, ref)
    db.commit()
    return template_out(tpl)


# ---------------------------------------------------------------- import


@router.post("/purple/import")
async def import_library(
    user: Editor,
    db: DB,
    file: UploadFile = File(...),
    format: Literal["atomic", "vectr_tsi", "csv"] = Query(...),
    dry_run: bool = True,
    update: bool = Query(False, description="Overwrite procedures imported before"),
) -> dict:
    """Preview (dry_run, the default) or apply an import. Procedures are matched to earlier
    imports by their source id (ART guid, TSI id), else by name; existing ones are skipped
    unless `update` is set. Each TSI campaign becomes a campaign template."""
    data = await file.read(MAX_IMPORT + 1)
    if len(data) > MAX_IMPORT:
        raise HTTPException(413, "The file is larger than 10 MB")
    try:
        parsed = pimp.parse(format, data)
    except pimp.ImportFormatError as e:
        raise HTTPException(422, str(e)) from None
    by_ref = {(t.source, t.source_ref): t for t in db.scalars(select(PtTemplate)) if t.source_ref}
    by_name = {t.name_key: t for t in db.scalars(select(PtTemplate))}
    rows, ref_to_id, created, updated, skipped = [], {}, 0, 0, 0
    pending_names: set[str] = set()
    for tpl in parsed.templates:
        src, ref = tpl["source"], tpl["source_ref"]
        found = by_ref.get((src, ref)) if ref else None
        if found is None:
            found = by_name.get(tpl["name"].lower())
            if found is not None and ref and found.source_ref and found.source_ref != ref:
                found = None  # same name, other procedure: import under a unique name
        if found is not None:
            action = "update" if update else "skip"
        elif tpl["name"].lower() in pending_names:
            action = "skip"
        else:
            action = "create"
        rows.append(
            {"name": tpl["name"], "techniques": tpl["techniques"], "action": action, "ref": ref}
        )
        if dry_run:
            continue
        fields = {k: v for k, v in tpl.items() if k not in ("source", "source_ref")}
        if action == "create":
            fields["name"] = _unique_name(db, fields["name"], ref)
            t = _create_template(db, fields, user, src, ref)
            db.flush()
            pending_names.add(tpl["name"].lower())
            by_name[t.name_key] = t
            created += 1
        elif action == "update":
            t = found
            before = _snapshot(t)
            for k, v in fields.items():
                if k != "name":
                    setattr(t, k, v)
            changes = audit.diff(before, _snapshot(t))
            if changes:
                audit.record(db, user, "update", "pt_template", t.name, changes)
            updated += 1
        else:
            t = found or by_name.get(tpl["name"].lower())
            skipped += 1
        if t is not None:
            ref_to_id[ref or tpl["name"]] = t.id
    campaigns = []
    for c in parsed.campaigns:
        exists = db.scalar(
            select(PtCampaignTemplate).where(PtCampaignTemplate.name_key == c["name"].lower())
        )
        campaigns.append(
            {
                "name": c["name"],
                "templates": len(c["refs"]),
                "action": "update" if exists else "create",
            }
        )
        if dry_run:
            continue
        ids = [ref_to_id[r] for r in c["refs"] if r in ref_to_id]
        if exists is not None:
            before = list(exists.template_ids)
            exists.template_ids = ids
            if before != ids:
                audit.record(
                    db,
                    user,
                    "update",
                    "pt_campaign_template",
                    exists.name,
                    {"template_ids": [before, ids]},
                )
        else:
            db.add(
                PtCampaignTemplate(
                    name=c["name"],
                    name_key=c["name"].lower(),
                    description=c["description"],
                    template_ids=ids,
                )
            )
            audit.record(
                db, user, "create", "pt_campaign_template", c["name"], {"templates": len(ids)}
            )
    if not dry_run:
        audit.record(
            db,
            user,
            "import",
            "pt_library",
            parsed.bundle,
            {
                "format": format,
                "file": file.filename,
                "created": created,
                "updated": updated,
                "skipped": skipped,
            },
        )
        db.commit()
    return {
        "bundle": parsed.bundle,
        "dry_run": dry_run,
        "templates": rows,
        "campaigns": campaigns,
        "errors": parsed.errors[:200],
        "counts": {
            "create": sum(1 for r in rows if r["action"] == "create"),
            "update": sum(1 for r in rows if r["action"] == "update"),
            "skip": sum(1 for r in rows if r["action"] == "skip"),
        },
    }
