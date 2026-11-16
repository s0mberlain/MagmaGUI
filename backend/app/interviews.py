"""Business owner interviews (issue #17): STRIDE threats per component -> proposed L2 use cases.

An analyst interviews the business owner of a system. Each component of the system gets the six
STRIDE categories; a category that applies is rated likelihood x impact (risk score 1..25).
The admin-maintained STRIDE -> L2 mapping turns threats at or above the proposal threshold into
proposed L2 use cases. The analyst can remove proposals, add L2s by hand and record detection
requests. Completing the interview freezes it and replaces the system's links.

Stored draft (`Interview.data`):
    components: [{key, name, description, log_source_ids, threats: [{category, state,
                  description, likelihood, impact}]}]
    added:      [{l2_id, threats: [{component: key, category}]}]
    removed:    [{l2_id, reason}]
    requests:   [{key, text, threat: {component: key, category}}]

`evaluate()` resolves ids to names and works out the proposals; for a draft this runs on every
read (so mapping, threshold, renamed or deleted use cases and log sources take effect), for a
completed interview its output is frozen in `Interview.result`.
"""

from datetime import date
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AppSetting,
    Interview,
    InterviewStatus,
    L2UseCase,
    L3UseCase,
    ReferenceItem,
    RefKind,
    StrideMapping,
    System,
    SystemLink,
)

STRIDE = (
    "spoofing",
    "tampering",
    "repudiation",
    "information_disclosure",
    "denial_of_service",
    "elevation_of_privilege",
)
STATES = ("applies", "does_not_apply", "not_discussed")
CLASSIFICATIONS = ("public", "internal", "confidential", "restricted")
COMPLETED = (InterviewStatus.completed, InterviewStatus.confirmed)

DEFAULT_MAPPING: dict[str, list[str]] = {
    "spoofing": ["RE-BRU", "EX-BRU", "AO-BRU", "AO-CRE", "AO-ACC", "AO-CSC", "PH-AAT", "FE-CEO"],
    "tampering": ["AO-FIL", "AO-DBC", "IN-MAL", "SD-WEB", "SD-CYS", "PV-POL"],
    "repudiation": ["AO-EVA", "PV-ACC"],
    "information_disclosure": ["AO-COL", "AO-EXF", "AO-DBC", "CC-SNC", "CC-CCH", "PV-COM"],
    "denial_of_service": ["DD-VOL", "DD-PRO", "DD-APP", "AO-FIL", "SD-CYS"],
    "elevation_of_privilege": ["AO-PRI", "PV-ACC", "EX-APP", "IN-RAT", "AO-PER"],
}

SETTINGS_KEY = "interviews"
DEFAULT_THRESHOLD = 8


# ---------------------------------------------------------------- settings and mapping


def load_settings(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, SETTINGS_KEY)
    value = dict(row.value) if row else {}
    value.setdefault("proposal_threshold", DEFAULT_THRESHOLD)
    value.setdefault("mapping_seeded", False)
    return value


def save_settings(db: Session, value: dict[str, Any], username: str) -> None:
    row = db.get(AppSetting, SETTINGS_KEY)
    if row is None:
        db.add(AppSetting(key=SETTINGS_KEY, value=value, updated_by=username))
    else:
        row.value, row.updated_by = dict(value), username


def threshold(db: Session) -> int:
    return int(load_settings(db)["proposal_threshold"])


def apply_default_mapping(db: Session) -> int:
    """Replace the mapping with the shipped default (codes that do not exist are skipped)."""
    db.execute(delete(StrideMapping))
    by_code = dict(db.execute(select(L2UseCase.code, L2UseCase.id)).all())
    n = 0
    for cat, codes in DEFAULT_MAPPING.items():
        for code in codes:
            if code in by_code:
                db.add(StrideMapping(category=cat, l2_id=by_code[code]))
                n += 1
    return n


def ensure_default_mapping(db: Session) -> None:
    """Once per installation: fill an empty mapping with the default. An admin who later removes
    every entry keeps an empty mapping (it is not filled again)."""
    s = load_settings(db)
    if s["mapping_seeded"]:
        return
    if db.scalar(select(StrideMapping.l2_id).limit(1)) is None:
        if db.scalar(select(L2UseCase.id).limit(1)) is None:
            return  # no catalogue yet; try again on the next start
        apply_default_mapping(db)
    s["mapping_seeded"] = True
    save_settings(db, s, "system")
    db.commit()


def mapping(db: Session) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {c: [] for c in STRIDE}
    for cat, l2_id in db.execute(select(StrideMapping.category, StrideMapping.l2_id)):
        if cat in out:
            out[cat].append(l2_id)
    return out


# ---------------------------------------------------------------- small rules


def risk_level(score: int | None) -> int | None:
    """Risk score 1..25 -> risk level 1..5 (1-5 -> 1, 6-10 -> 2, ... 21-25 -> 5)."""
    if not score or score < 1:
        return None
    return min(5, (score - 1) // 5 + 1)


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("invalid date")  # pragma: no cover


def interview_state(system: System, last: date | None, today: date | None = None) -> str:
    """none (never interviewed) | due (review interval passed) | ok."""
    if last is None:
        return "none"
    if add_months(last, system.review_interval_months) < (today or date.today()):
        return "due"
    return "ok"


def threat_score(t: dict) -> int | None:
    if t.get("state") != "applies":
        return None
    lk, im = t.get("likelihood"), t.get("impact")
    return lk * im if lk and im else None


def threat_complete(t: dict) -> bool:
    if t.get("state") != "applies":
        return True
    return bool((t.get("description") or "").strip()) and threat_score(t) is not None


# ---------------------------------------------------------------- evaluation


def _l2_index(db: Session) -> dict[int, L2UseCase]:
    q = select(L2UseCase).options(
        selectinload(L2UseCase.parent),
        selectinload(L2UseCase.children).selectinload(L3UseCase.references),
    )
    return {x.id: x for x in db.scalars(q)}


def _rule_views(l2: L2UseCase, delivered: set[str]) -> list[dict]:
    rules = []
    for r in l2.children:
        needed = sorted(x.name for x in r.references if x.kind == RefKind.log_source)
        rules.append(
            {
                "code": r.code,
                "name": r.name,
                "lifecycle_status": str(r.lifecycle_status),
                "log_sources": needed,
                "missing": sorted(set(needed) - delivered),
                "unknown": not needed,
            }
        )
    return rules


def evaluate(db: Session, data: dict, threshold_value: int) -> dict:
    """Resolve a stored draft and work out proposals, removals, gaps (see module docstring)."""
    ls_names = dict(
        db.execute(
            select(ReferenceItem.id, ReferenceItem.name).where(
                ReferenceItem.kind == RefKind.log_source
            )
        ).all()
    )
    l2s = _l2_index(db)
    mapped = mapping(db)

    components: list[dict] = []
    threats: dict[tuple[str, str], dict] = {}
    comp_ls: dict[str, set[str]] = {}
    incomplete: list[dict] = []
    for c in data.get("components", []):
        sources = [
            {"id": i, "name": ls_names[i]} for i in c.get("log_source_ids", []) if i in ls_names
        ]
        comp_ls[c["key"]] = {s["name"] for s in sources}
        tviews = []
        by_cat = {t["category"]: t for t in c.get("threats", [])}
        for cat in STRIDE:
            t = by_cat.get(cat, {"category": cat, "state": "not_discussed"})
            view = {
                "category": cat,
                "state": t.get("state", "not_discussed"),
                "description": t.get("description", "") or "",
                "likelihood": t.get("likelihood"),
                "impact": t.get("impact"),
                "score": threat_score(t),
                "complete": threat_complete(t),
            }
            tviews.append(view)
            threats[(c["key"], cat)] = view | {"component_name": c["name"]}
            if not view["complete"]:
                incomplete.append({"component": c["name"], "category": cat})
        components.append(
            {
                "key": c["key"],
                "name": c["name"],
                "description": c.get("description", "") or "",
                "log_sources": sources,
                "threats": tviews,
            }
        )

    proposals: dict[int, dict] = {}

    def propose(l2_id: int, key: str, cat: str, auto: bool) -> None:
        p = proposals.setdefault(l2_id, {"sources": {}, "auto": False, "manual": False})
        p["sources"][(key, cat)] = threats[(key, cat)]["score"]
        p["auto" if auto else "manual"] = True

    below: list[dict] = []
    for (key, cat), t in threats.items():
        if t["score"] is None:
            continue
        targets = [i for i in mapped.get(cat, []) if i in l2s]
        if t["score"] >= threshold_value:
            for i in targets:
                if l2s[i].parent.applicable:
                    propose(i, key, cat, auto=True)
        else:
            below.append(
                {
                    "component": key,
                    "component_name": t["component_name"],
                    "category": cat,
                    "score": t["score"],
                    "l2s": [_l2_brief(l2s[i]) for i in targets],
                }
            )

    for a in data.get("added", []):
        if a["l2_id"] not in l2s:
            continue  # deleted since (EC-1)
        refs = [(r["component"], r["category"]) for r in a.get("threats", [])]
        for key, cat in refs:
            if (key, cat) in threats:
                propose(a["l2_id"], key, cat, auto=False)

    removed_reason = {r["l2_id"]: r.get("reason", "") or "" for r in data.get("removed", [])}

    accepted, removed = [], []
    for l2_id, p in proposals.items():
        l2 = l2s[l2_id]
        delivered: set[str] = set()
        srcs = []
        for (key, cat), score in p["sources"].items():
            delivered |= comp_ls.get(key, set())
            srcs.append(
                {
                    "component": key,
                    "component_name": threats[(key, cat)]["component_name"],
                    "category": cat,
                    "score": score,
                }
            )
        srcs.sort(
            key=lambda s: (-(s["score"] or 0), s["component_name"], STRIDE.index(s["category"]))
        )
        scores = [s["score"] for s in srcs if s["score"] is not None]
        view = _l2_brief(l2) | {
            "risk_score": max(scores) if scores else None,
            "sources": srcs,
            "auto": p["auto"],
            "manual": p["manual"],
            "rules": _rule_views(l2, delivered),
        }
        if l2_id in removed_reason:
            removed.append(view | {"reason": removed_reason[l2_id]})
        else:
            accepted.append(view)
    # a removal of something that is no longer proposed is still listed (with its reason)
    for l2_id, reason in removed_reason.items():
        if l2_id not in proposals and l2_id in l2s:
            removed.append(
                _l2_brief(l2s[l2_id])
                | {"risk_score": None, "sources": [], "auto": False, "manual": False}
                | {"rules": [], "reason": reason}
            )

    order = lambda v: (-(v["risk_score"] or 0), v["code"])  # noqa: E731
    accepted.sort(key=order)
    removed.sort(key=order)
    below.sort(key=lambda b: (-b["score"], b["component_name"], STRIDE.index(b["category"])))

    requests = []
    for r in data.get("requests", []):
        ref = (r["threat"]["component"], r["threat"]["category"])
        t = threats.get(ref)
        requests.append(
            {
                "key": r.get("key", ""),
                "text": r["text"],
                "component": ref[0],
                "component_name": t["component_name"] if t else "",
                "category": ref[1],
            }
        )

    added = [
        {"l2_id": a["l2_id"], "threats": a.get("threats", [])}
        for a in data.get("added", [])
        if a["l2_id"] in l2s
    ]
    return {
        "threshold": threshold_value,
        "mapping_empty": not any(mapped.values()),
        "components": components,
        "incomplete": incomplete,
        "proposals": accepted,
        "removed": removed,
        "below_threshold": below,
        "added": added,
        "removed_ids": [r["l2_id"] for r in data.get("removed", []) if r["l2_id"] in l2s],
        "requests": requests,
        "log_source_gaps": [
            {"l2_code": p["code"], "rule_code": r["code"], "rule_name": r["name"]}
            | {"missing": r["missing"]}
            for p in accepted
            for r in p["rules"]
            if r["missing"]
        ],
    }


def _l2_brief(l2: L2UseCase) -> dict:
    return {
        "l2_id": l2.id,
        "code": l2.code,
        "name": l2.name,
        "l1_code": l2.parent.code,
        "l1_applicable": l2.parent.applicable,
    }


def mark_deleted(db: Session, result: dict) -> dict:
    """A completed interview keeps code and name as recorded; flag L2s deleted since (EC-1/2)."""
    ids = {p["l2_id"] for p in result.get("proposals", []) + result.get("removed", [])}
    existing = set(db.scalars(select(L2UseCase.id).where(L2UseCase.id.in_(ids)))) if ids else set()
    for p in result.get("proposals", []) + result.get("removed", []):
        p["deleted"] = p["l2_id"] not in existing
    return result


# ---------------------------------------------------------------- interviews of a system


def completed(system: System) -> list[Interview]:
    """Completed (or confirmed) interviews, oldest first."""
    done = [i for i in system.interviews if i.status in COMPLETED]
    # a re-interview is always created after the interview it starts from
    return sorted(done, key=lambda i: (i.interview_date, i.id))


def latest_completed(system: System) -> Interview | None:
    done = completed(system)
    return done[-1] if done else None


def draft_of(system: System) -> Interview | None:
    return next((i for i in system.interviews if i.status == InterviewStatus.draft), None)


def copy_for_reinterview(previous: Interview, existing_ls: set[int]) -> dict:
    """The data of a completed interview as the start of the next one (notes stay empty)."""
    data = previous.data or {}
    comps = []
    for c in data.get("components", []):
        comps.append(
            c | {"log_source_ids": [i for i in c.get("log_source_ids", []) if i in existing_ls]}
        )
    return {
        "components": comps,
        "added": list(data.get("added", [])),
        "removed": list(data.get("removed", [])),
        "requests": list(data.get("requests", [])),
    }


def replace_links(db: Session, system: System, interview: Interview, result: dict) -> None:
    db.execute(delete(SystemLink).where(SystemLink.system_id == system.id))
    db.flush()
    for p in result["proposals"]:
        db.add(
            SystemLink(
                system_id=system.id,
                l2_id=p["l2_id"],
                interview_id=interview.id,
                risk_score=p["risk_score"] or 0,
                sources=[
                    {"component": s["component_name"], "category": s["category"]}
                    | {"score": s["score"]}
                    for s in p["sources"]
                ],
            )
        )


def compare(old: dict, new: dict) -> dict:
    """What changed between two evaluated interviews (by component name and STRIDE category)."""
    oc = {c["name"]: c for c in old.get("components", [])}
    nc = {c["name"]: c for c in new.get("components", [])}

    def applying(comps: dict) -> dict[tuple[str, str], dict]:
        return {
            (name, t["category"]): t
            for name, c in comps.items()
            for t in c["threats"]
            if t["state"] == "applies"
        }

    ot, nt = applying(oc), applying(nc)
    rerated = []
    for k in sorted(set(ot) & set(nt)):
        a, b = ot[k], nt[k]
        if (a["likelihood"], a["impact"]) != (b["likelihood"], b["impact"]):
            rerated.append(
                {"component": k[0], "category": k[1], "old_score": a["score"]}
                | {"new_score": b["score"]}
            )
    ol = {p["code"]: p["name"] for p in old.get("proposals", [])}
    nl = {p["code"]: p["name"] for p in new.get("proposals", [])}
    return {
        "components_added": sorted(set(nc) - set(oc)),
        "components_removed": sorted(set(oc) - set(nc)),
        "threats_added": [{"component": k[0], "category": k[1]} for k in sorted(set(nt) - set(ot))],
        "threats_removed": [
            {"component": k[0], "category": k[1]} for k in sorted(set(ot) - set(nt))
        ],
        "threats_rerated": rerated,
        "use_cases_added": [{"code": c, "name": nl[c]} for c in sorted(set(nl) - set(ol))],
        "use_cases_removed": [{"code": c, "name": ol[c]} for c in sorted(set(ol) - set(nl))],
    }


# ---------------------------------------------------------------- effects elsewhere


def system_risk_by_l2(db: Session) -> dict[int, tuple[int, str]]:
    """L2 id -> (system risk level 1..5, system name) from links of non-archived systems; when
    several systems link the same L2, the highest level wins."""
    out: dict[int, tuple[int, str]] = {}
    q = (
        select(SystemLink.l2_id, SystemLink.risk_score, System.name)
        .join(System, System.id == SystemLink.system_id)
        .where(System.archived.is_(False))
        .order_by(System.name)
    )
    for l2_id, score, name in db.execute(q):
        lvl = risk_level(score)
        if lvl and (l2_id not in out or lvl > out[l2_id][0]):
            out[l2_id] = (lvl, name)
    return out
