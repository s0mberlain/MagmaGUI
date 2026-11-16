"""Settings admins change in the app. First one: the SIEM name of a rule (issue #29).

The SIEM name is built from a format such as `$companyName:$ucID:$ucName`. `$ucID`, `$ucName`,
`$l2ID` and `$l1ID` come from the rule; admins define further variables (`$companyName` =
`MYCORP`). The name is built in the browser (frontend/src/lib/ruleName.ts); unknown `$names`
stay as they are, so a typo is visible in the result.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from app import audit
from app.api.deps import DB
from app.models import AppSetting
from app.security import Admin, Reader

router = APIRouter(tags=["settings"])

RULE_NAME = "rule_name"
BUILTINS = ("ucID", "ucName", "l2ID", "l1ID")
DEFAULT_FORMAT = "$ucID:$ucName"
VAR_NAME = r"^[A-Za-z_][A-Za-z0-9_]{0,49}$"


class Variable(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, pattern=VAR_NAME)]
    value: Annotated[str, StringConstraints(max_length=200)] = ""


class RuleNameSettings(BaseModel):
    format: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = (
        DEFAULT_FORMAT
    )
    variables: list[Variable] = Field(default_factory=list, max_length=50)


class RuleNameOut(RuleNameSettings):
    builtins: list[str] = list(BUILTINS)
    updated_at: datetime | None = None
    updated_by: str | None = None


def load(db) -> tuple[RuleNameSettings, AppSetting | None]:
    row = db.get(AppSetting, RULE_NAME)
    return (RuleNameSettings.model_validate(row.value) if row else RuleNameSettings()), row


@router.get("/settings/rule-name", response_model=RuleNameOut)
def get_rule_name(_: Reader, db: DB) -> RuleNameOut:
    s, row = load(db)
    return RuleNameOut(
        **s.model_dump(),
        updated_at=row.updated_at if row else None,
        updated_by=row.updated_by if row else None,
    )


@router.put("/settings/rule-name", response_model=RuleNameOut)
def put_rule_name(body: RuleNameSettings, user: Admin, db: DB) -> RuleNameOut:
    names = [v.name for v in body.variables]
    clash = sorted(set(names) & set(BUILTINS))
    if clash:
        raise HTTPException(422, f"${clash[0]} comes from the rule and cannot be redefined")
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise HTTPException(422, f"${dupes[0]} is defined twice")
    if not body.format:
        raise HTTPException(422, "The format cannot be empty")
    old, row = load(db)
    value = body.model_dump()
    if row is None:
        row = AppSetting(key=RULE_NAME, value=value, updated_by=user.username)
        db.add(row)
    else:
        row.value, row.updated_by = value, user.username
    audit.record(db, user, "update", "settings", RULE_NAME, audit.diff(old.model_dump(), value))
    db.commit()
    db.refresh(row)
    return RuleNameOut(**value, updated_at=row.updated_at, updated_by=row.updated_by)
