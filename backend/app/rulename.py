"""SIEM name of an L3 rule (issue #29), built on the server (issue #50).

The format (e.g. `$companyName:$ucID:$ucName`) and admin variables live in app_settings key
`rule_name`. `$ucID`, `$ucName`, `$l2ID` and `$l1ID` come from the rule. The whole name counts
(`$ucIDx` is not `$ucID` + "x"); unknown names stay as they are so a typo is visible. The
frontend (lib/ruleName.ts) uses the same rules for its live preview.
"""

import re
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.models import L3UseCase

_VAR = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")


def render(fmt: str, values: dict[str, str]) -> str:
    return _VAR.sub(lambda m: values.get(m.group(1), m.group(0)), fmt)


def formatter(db: Session) -> Callable[[L3UseCase], str]:
    from app.api.app_settings import load

    settings, _ = load(db)
    variables = {v.name: v.value for v in settings.variables}

    def name(rule: L3UseCase) -> str:
        values = variables | {
            "ucID": rule.code,
            "ucName": rule.name,
            "l2ID": rule.parent.code,
            "l1ID": rule.code[:2],
        }
        return render(settings.format, values)

    return name
