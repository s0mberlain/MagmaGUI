# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop browsers on PCs only. Mobile and tablet use is not a target (confirmed 2026-11-21).

## Users

One company's own in-house SOC runs Vulcan for itself; it is not a product shared with or sold to other SOCs. Its primary users, all working at a desk on a PC:

- **Detection engineers** maintain the L3 rules: log sources, detection technologies, scopes, ATT&CK IDs, SIEM rule IDs, the versioned JSON config, the embedded metrics (effectiveness, implementation, coverage), lifecycle status and periodic verification. They spend most of their time in Use cases, rule pages, Verification and Output metrics.
- **The SOC lead / manager** steers growth and reports upward: the SOC detection score, detection gap, growth potential, Priorities, History & trends, driver coverage and the PDF management report.
- **Threat modellers** run business-owner interviews per business system (components, STRIDE threats rated likelihood × impact, custom ATT&CK threats), review the proposed L2 use cases and record what is covered, partly covered or a gap.
- **The red / purple team** plans and records VECTR-style assessments: campaigns, test cases with a red side (execution) and blue side (detections, outcomes), quick tests, re-runs and trends.

Secondary audiences: **admins** (users, settings, STRIDE mapping, integrations) and **auditors** (read-only, including the audit log). Business owners are interviewed and may sign off an interview, but they are contacts, not users.

## Product Purpose

**Vulcan** (formerly MagmaGUI, shown as "Magma UCF" until 2026-11-21) replaces the FI-ISAC **MaGMa Use Case Framework Excel tool** (v1.0, 2017) with a self-hosted, multi-user web app for managing the SOC's security-monitoring (SIEM) use cases across the framework's business layer (business and compliance drivers), threat layer (L1 strategic, L2 tactical) and implementation layer (L3 rules).

It exists so the SOC can manage its use cases the way the framework intends (**Ma**nagement as lifecycle, **G**rowth as risk-based capability, **M**etrics and **a**ssessment as embedded, control and output metrics) with history, multiple users and an audit trail that a spreadsheet cannot give.

Success means the SOC knows, at any moment and with evidence, where its detection is strong, where the gaps are, which gaps matter most for the business, and what changed since last time.

## Positioning

- It keeps the MaGMa framework's layers, identifiers (`AO`, `AO-CRE`, `AO-CRE-01`), reference lists and metrics recognisable to anyone who knew the Excel, but its scoring is deliberately cleaned up: a rule is scored only when all three metrics are set and it is Operational or Maintenance, and an L2 without scored rules is shown as a **detection gap**, never as 0. Numbers differ from the Excel on purpose.
- It connects four sources of truth to the same use-case record: the framework catalogue, business-owner threat modelling (STRIDE + ATT&CK, risk raises a rule's priority), purple-team test evidence (recorded as verification, never altering the metrics) and SIEM output (rule inventory and alert counts pushed in).
- Each L3 rule's JSON config is versioned like git (commits, diff, restore, tags, optional sync to a real repository).

## Operating Context

- Self-hosted as one Docker container (port 8080), usually behind the company's reverse proxy for TLS. SQLite by default, PostgreSQL optional.
- Sign-in with local accounts or OIDC SSO, optional TOTP 2FA. Roles admin / analyst / auditor are enforced in the API.
- UI in English, German and Dutch.
- Data flows in from: the bundled MaGMa seed catalogue, classic UCF Excel workbooks (import with preview and merge/replace), CSV output-metrics imports, SIEM push via API tokens, Atomic Red Team / Threat Simulation Index / CSV imports for purple teaming, and evidence file uploads.
- Data flows out as: classic-layout Excel export, JSON export, PDF management report, PDF interview report, PDF purple-team report, ATT&CK Navigator layers, and the SIEM rule inventory.
- Recurring rituals the app supports: rule verification every 180 days by default, monthly output metrics, periodic snapshots for trends, system re-interviews at each system's review interval, purple-team re-runs, and management reporting.

## Capabilities and Constraints

- Desktop-only. Screens may be dense and assume a PC-sized viewport with mouse and keyboard; phone layouts are out of scope.
- Every data change is written to the audit log with old and new values; scores are calculated, never stored (except inside snapshots).
- Concurrent edits are guarded with optimistic locking (stale saves get 409), and the UI must surface those conflicts.
- Every UI string goes through the translation layer and needs German and Dutch entries.
- Existing frontend: React 18 + TypeScript + Vite SPA served by the FastAPI backend.
- Framework terminology is product vocabulary and must be used consistently: L1 / L2 / L3, use case, rule, business driver, compliance driver, definition of done, change driver, effectiveness / implementation / coverage, weight, potential, detection gap, growth potential, catalogue coverage, verification, STRIDE, risk level, outcome (blocked, alerted, logged, none).
- The CMMI maturity self-assessment was built and removed (2026-11-14); do not reintroduce it unasked.
- Not yet decided: no formal accessibility standard or offline/air-gap requirement has been made binding.

## Brand Commitments

- The product is named **Vulcan** (decided 2026-11-21) everywhere people see it: UI, page titles, reports, export file names, authenticator issuer, docs. "MaGMa" remains the name of the framework Vulcan implements and is never replaced.
- Technical identifiers keep the old name for compatibility (the `magma` CLI, `MAGMA_*` variables, the `magma_session` cookie, `magma.db`, Docker service and volume names, the `Magma-Token` header, the repository `MagmaGUI`).
- Logo: **"The Struck V"**, a V monogram with an Ember spark at the notch (`frontend/src/components/Logo.tsx`, `frontend/public/favicon.svg`).

## Evidence on Hand

- `backend/app/seed/catalogue.json`: the default MaGMa catalogue (12 L1 + Weaponization, 62 L2, 169 L3 rules, reference lists, business drivers).
- Reproducible demo data (`backend/app/demo.py`, seed 42): metrics, statuses, verifications, configs, output metrics, 12 snapshots and two purple-team assessments. Demo rules and records are marked as demo and must never be presented as real SOC results.
- `docs/design/`: the approved desktop design drafts (Login, Main, Use cases, Rule detail).
- `docs/purple-teaming-guide.pdf` and `docs/PLAN.md` (original plan and decisions).
- The framework source: FI-ISAC "MaGMa use case framework" short version (betaalvereniging.nl).
- Bundled offline datasets: MITRE ATT&CK Enterprise and the Atomic Red Team index.
- Absent: no real filled-in UCF workbook, no real SOC data in the repository, no customer quotes or metrics. Do not fabricate detection scores, incidents or outcomes as if they were real.

## Product Principles

1. **Show the gap, never hide it.** Missing data is a visible state (detection gap, unassessed, overdue, not discussed), not a zero or a blank.
2. **Every number is explainable.** A score, priority or coverage value can be traced back to the rules, metrics, risks and evidence behind it.
3. **Evidence informs; people decide.** Tests, SIEM output and interviews add evidence and suggestions, but metrics, lifecycle changes and proposals stay deliberate, attributed human decisions.
4. **Faithful to MaGMa, better than the spreadsheet.** Keep the framework's structure and vocabulary; fix what the Excel did badly instead of copying it.
5. **Built for daily expert work.** Four specialist roles use it at their desks every day: favour speed, density, and consistency across sections over introductory hand-holding.
