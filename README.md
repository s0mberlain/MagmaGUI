# MagmaGUI

Web application for the FI-ISAC **MaGMa Use Case Framework**: manage SIEM / SOC use cases across the business, threat (L1/L2) and implementation (L3) layers, score them, track verification and keep versioned YAML configs per use case.

Status: **M5**: MVP (catalogue, scoring, verification, YAML configs with history, Excel import/export, local login and SSO) plus lifecycle change log, history and trends, optional git sync, risk-based priorities, maturity assessment and two-factor login. See [docs/PLAN.md](docs/PLAN.md) for the full plan and milestones, and [docs/design/](docs/design/) for the approved desktop design draft.

## Run with Docker

```bash
cp .env.example .env        # optional, adjust settings
docker compose up -d --build
```

Open http://localhost:8080 and sign in as `admin`. Set `ADMIN_PASSWORD` in `.env` before the first start, or read the generated password from the log: `docker compose logs magma | grep "generated password"`.

On first start the database is created, migrated and filled with the default MaGMa catalogue (12 L1 + Weaponization (not applicable), 62 L2, 169 L3, reference lists, business drivers). Data is stored in the `magma-data` volume (`/data` in the container). API docs: http://localhost:8080/api/docs

## PostgreSQL

SQLite (one file in the volume) is fine for a small team. For more users or several app
replicas, use PostgreSQL:

```bash
echo "POSTGRES_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')" >> .env
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

Or point `DATABASE_URL` at your own server (`postgresql+psycopg://user:pw@host:5432/db`;
`postgres://` URLs work too). What the app does on PostgreSQL:

- Waits up to `DB_WAIT_SECONDS` (60) for the database on startup, then migrates.
- Several replicas can share one database: migrations and seeding run under an advisory lock,
  and the scheduled snapshot and the git sync run on one replica at a time.
- Connection pool with health checks (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_RECYCLE`), all
  sessions in UTC, optional `DB_STATEMENT_TIMEOUT_MS`.
- Two saves of the same YAML config at the same moment cannot get the same revision; the loser
  gets a 409 and reloads.
- `GET /api/ready` checks the database (503 when it is down), `GET /api/health` only the process.
- CI runs the full test suite on SQLite and on PostgreSQL 16, and checks that the migrations
  match the models on both.

**Moving from SQLite to PostgreSQL.** Start the Postgres stack once so the database exists, then
copy everything (users, history, configs, snapshots …) from the old volume:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml run --rm magma \
  magma db-copy --source sqlite:////data/magma.db \
  --target "postgresql+psycopg://magma:$POSTGRES_PASSWORD@postgres:5432/magma" --replace
```

`--replace` is needed because the first start already seeded the catalogue and the first admin.
Ids are kept and the sequences are moved past them. Other commands: `magma migrate` and
`magma demo-data --seed 42`.

## Develop

Backend (Python 3.12+, FastAPI):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
pytest && ruff check . && ruff format --check .
# the same tests on PostgreSQL (the database is emptied before each test):
TEST_DATABASE_URL=postgresql+psycopg://user:pw@localhost/magma_test pytest
```

Frontend (Node 22, React + Vite + TypeScript), proxies `/api` to port 8000:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build
```

## Scoring and demo data

- Rule weight = effectiveness × implementation × coverage, potential = effectiveness − weight.
- Only operational and maintenance rules with all three metrics count. Empty L2 use cases are shown
  as detection gaps instead of counting as zero, and every L2 counts equally in its L1.
- Verification: operational rules must be re-verified every `DEFAULT_VERIFICATION_DAYS` (180) days
  unless the rule sets its own interval. Never verified counts as overdue.
- Demo data: start with `DEMO_DATA=true`, use *Users → Demo data* (admin), or run
  `python -m app.demo --seed 42` in `backend/`.

## YAML configurations

Every L2 use case and L3 rule can keep a free-form YAML configuration (query, thresholds, owner …).
It works like git without needing git: each save is an immutable commit (sha, author, message),
with history, diff between any two versions, restore (a new commit with the old content) and tags.
"Verify now" tags the current version as `verified-<date>`. If someone else saved in between,
your save is refused with a diff and you merge by hand. The only check is that the text is valid YAML.

### Git repository (optional)

Set `GIT_REMOTE_URL` plus `GIT_TOKEN` (HTTPS) or `GIT_SSH_KEY_FILE` (SSH) and the app pushes every
configuration commit to that repository as a real git commit with the same author, date and
message, on `usecases/<L1>/<L2>/<L3>.yaml` (an L2 config is `usecases/<L1>/<L2>/<L2>.yaml`). Tags
become `<code>/<tag>`, e.g. `AO-CRE-01/verified-2026-11-13`. Sync runs in the background after each
commit (`GIT_AUTO_SYNC`) and at startup; admins see the state and can sync by hand under
*Import / Export*. The app stays the source of truth: changes made in the repository are not read
back. To try it locally: `docker compose --profile gitea up -d` starts Gitea on port 3000 with user
magma / magma-password and an empty repository `magma/usecases`; use the Gitea values from
`.env.example`.

## Lifecycle, history and trends

Status changes go through *Change status* on the rule or L2 page and are logged with a change
driver (environmental: threat landscape, business, regulation, IT infrastructure; operational:
red teaming, incident lessons, threat hunting, tuning) and a note. A use case can only become
*Operational* when its definition-of-done checklist is complete (log sources, scope, incident
response, roles, rules); an admin can skip it, which is logged. *History & trends* shows control
metrics over time from snapshots (taken manually or by `SNAPSHOT_SCHEDULE`, monthly by default),
compares any two snapshots, and lists all status changes. Demo data includes twelve monthly
snapshots and a matching change log.

## Priorities and maturity

Every L2 use case has a risk level (1–5) and an optional target implementation; a rule follows
its L2 unless it sets its own. Without an explicit target the risk level gives one
(`RISK_TARGETS`, default 40 % for risk 1 up to 90 % for risk 5). *Priorities* lists the active
rules with the gap between implementation and target, sorted by priority = potential × risk ÷ 5,
so the work with the most detection gain on the riskiest use cases comes first.

*Maturity* records self-assessments on the CMMI scale (1 Initial … 5 Optimizing) with an
optional target level, a level per aspect (people, process, technology) and notes. The level is
kept in every snapshot, so it shows up on *History & trends*.

## ATT&CK coverage

The app ships a compact copy of MITRE ATT&CK Enterprise (`backend/app/attack_data/enterprise.json`), so the
coverage page works offline. Each technique is coloured by the best weight of an operational rule mapped to it;
a rule on a sub-technique also counts for its parent. **Download Navigator layer** exports the same view as an
[ATT&CK Navigator](https://mitre-attack.github.io/attack-navigator/) layer (score = weight × 100).

The original MaGMa catalogue uses 2017 technique IDs. Most were later revoked and replaced, or deprecated. The
page lists them, and an admin can replace revoked IDs by their successor in one step (**Review update**, audited).
Deprecated IDs without a successor stay on the rule until someone maps it by hand.

To refresh the bundled data from a newer ATT&CK release:

```bash
cd backend && python -m app.attack_data.update            # downloads the latest enterprise-attack.json
python -m app.attack_data.update path/to/enterprise-attack.json
```

## Output metrics and report

Each rule can record per month: alerts, incidents, false positives and (optionally) false negatives. Enter them on
the rule page or import a CSV file on **Output metrics** (columns `rule, period, alerts, incidents,
false_positives, false_negatives, note`; period `YYYY-MM`; comma or semicolon separated; **Check** runs a dry run,
and a file with any error imports nothing). The page shows monthly totals and the rules with the most false
positives.

**Download PDF report** on the dashboard creates a management report: KPIs, the SOC score trend, detection per
L1, top priorities, ATT&CK coverage per tactic, the noisiest rules and overdue verifications.

## Excel import / export

*Import / Export* writes the classic MaGMa UCF Tool layout (L1 UC, L2 UC, L3 UC, Drivers,
References) with its formulas, plus extra columns for app fields. Import reads the same layout,
including the original tool, with a preview before anything is saved. *Merge* adds and updates by
ID; *Replace* (admin) also removes what is not in the file. A JSON backup export includes
verifications and the configuration history.

## Single sign-on (OIDC)

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_ROLE_MAP` (see `.env.example`)
and register `<BASE_URL>/api/auth/oidc/callback` as redirect URI at your IdP. Users are created on
first login; their role follows the mapped IdP group on every login, and users without a matching
group are refused (or get `OIDC_DEFAULT_ROLE`). Local login keeps working unless
`LOCAL_LOGIN_ENABLED=false`.

To try it locally: `docker compose --profile keycloak up -d` starts a Keycloak on port 8081 with
the users alice / bob / carol (admin / analyst / auditor, password `<name>-password`); use the
Keycloak values from `.env.example`.

## Two-factor login

Local accounts can turn on a TOTP second factor under *Account* (click your name in the
sidebar): scan the QR code with any authenticator app, confirm a code, and save the eight
one-time recovery codes. The secret is stored encrypted with `SECRET_KEY` (changing that key
turns existing second factors unusable; an admin can then reset them under *Users*). SSO
accounts use the second factor of the identity provider.

## Languages

The interface is available in English, German and Dutch. Pick the language at the bottom of the
sidebar (or on the sign-in page); it is saved on your account and follows you to other browsers.
Without a choice the browser language is used. The data itself (use case names, descriptions, the
ATT&CK catalogue) stays as entered; the Excel export keeps the classic English sheet layout.

Texts live in `frontend/src/locales/{de,nl}.json`, keyed by the English text used in
`t("...")`. `npm run i18n:check` (also in CI) fails when a text has no German or Dutch entry or a
`{placeholder}` got lost. Labels sent by the API (definition of done, change drivers, CMMI levels,
trend metrics) are listed in `frontend/src/serverTexts.ts` so they are translated too.

## Roles

| Role | Can |
|---|---|
| admin | everything, incl. users and deletes |
| analyst | read and edit use cases, drivers, reference lists |
| auditor | read everything incl. the audit log, no changes |

## Layout

```
backend/    FastAPI app (API under /api, serves the built SPA)
frontend/   React single-page app
docs/       plan and design draft
Dockerfile  multi-stage build: frontend → Python runtime, one container on port 8080
```
