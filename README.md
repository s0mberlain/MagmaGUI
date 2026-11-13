# MagmaGUI

Web application for the FI-ISAC **MaGMa Use Case Framework**: manage SIEM / SOC use cases across the business, threat (L1/L2) and implementation (L3) layers, score them, track verification and keep versioned YAML configs per use case.

Status: **M0 – skeleton**. See [docs/PLAN.md](docs/PLAN.md) for the full plan and milestones, and [docs/design/](docs/design/) for the approved desktop design draft.

## Run with Docker

```bash
cp .env.example .env        # optional, adjust settings
docker compose up -d --build
```

Open http://localhost:8080. Data is stored in the `magma-data` volume (`/data` in the container). API docs: http://localhost:8080/api/docs

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

## Layout

```
backend/    FastAPI app (API under /api, serves the built SPA)
frontend/   React single-page app
docs/       plan and design draft
Dockerfile  multi-stage build: frontend → Python runtime, one container on port 8080
```
