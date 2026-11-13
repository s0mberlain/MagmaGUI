# MagmaGUI

Web application for the FI-ISAC **MaGMa Use Case Framework**: manage SIEM / SOC use cases across the business, threat (L1/L2) and implementation (L3) layers, score them, track verification and keep versioned YAML configs per use case.

Status: **M4**: MVP (catalogue, scoring, verification, YAML configs with history, Excel import/export, local login and SSO) plus lifecycle change log, history and trends, and optional git sync. See [docs/PLAN.md](docs/PLAN.md) for the full plan and milestones, and [docs/design/](docs/design/) for the approved desktop design draft.

## Run with Docker

```bash
cp .env.example .env        # optional, adjust settings
docker compose up -d --build
```

Open http://localhost:8080 and sign in as `admin`. Set `ADMIN_PASSWORD` in `.env` before the first start, or read the generated password from the log: `docker compose logs magma | grep "generated password"`.

On first start the database is created, migrated and filled with the default MaGMa catalogue (12 L1 + Weaponization (not applicable), 62 L2, 169 L3, reference lists, business drivers). Data is stored in the `magma-data` volume (`/data` in the container). API docs: http://localhost:8080/api/docs

## Develop

Backend (Python 3.12+, FastAPI):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
pytest && ruff check . && ruff format --check .
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
