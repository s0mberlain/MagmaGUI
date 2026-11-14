#!/usr/bin/env python3
"""Push SIEM alert counts (CSV) or a rule inventory (JSON) to MaGMa UCF.

Usage:
  magma_push.py alerts <source> <file.csv> [--mode replace|add] [--dry-run]
  magma_push.py rules  <source> <file.json>

Environment: MAGMA_URL (e.g. https://magma.example.com) and MAGMA_TOKEN (API token).
CSV columns: rule, period (YYYY-MM), alerts, incidents, false_positives, false_negatives
(the last three are optional). Separator , or ; is detected. "-" as file reads stdin.
"""

import argparse
import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request


def read(path: str) -> str:
    return sys.stdin.read() if path == "-" else open(path, encoding="utf-8-sig").read()


def call(method: str, path: str, body: dict) -> dict:
    url = os.environ["MAGMA_URL"].rstrip("/") + path
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {os.environ['MAGMA_TOKEN']}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode(errors='replace')}")


def num(v: str | None) -> int | None:
    v = (v or "").strip()
    return int(float(v)) if v else None


def alerts(args) -> None:
    text = read(args.file)
    dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;")
    items = []
    for row in csv.DictReader(io.StringIO(text), dialect=dialect):
        row = {k.strip().lower(): v for k, v in row.items() if k}
        item = {"rule": row["rule"].strip(), "period": row["period"].strip()[:7]}
        for k in ("alerts", "incidents", "false_positives", "false_negatives"):
            if num(row.get(k)) is not None:
                item[k] = num(row.get(k))
        items.append(item)
    q = "?dry_run=true" if args.dry_run else ""
    path = f"/api/integrations/siem/{args.source}/alerts{q}"
    res = call("POST", path, {"mode": args.mode, "items": items})
    print(json.dumps(res, indent=2))


def rules(args) -> None:
    data = json.loads(read(args.file))
    res = call("PUT", f"/api/integrations/siem/{args.source}/rules", {"rules": data})
    print(
        f"{res['rules_total']} rules, {res['linked']} linked, "
        f"{len(res['unlinked'])} without use case, "
        f"{len(res['disabled_but_operational'])} disabled but operational"
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("alerts")
    a.add_argument("source")
    a.add_argument("file")
    a.add_argument("--mode", choices=["replace", "add"], default="replace")
    a.add_argument("--dry-run", action="store_true")
    r = sub.add_parser("rules")
    r.add_argument("source")
    r.add_argument("file")
    args = p.parse_args()
    {"alerts": alerts, "rules": rules}[args.cmd](args)


if __name__ == "__main__":
    main()
