# MoneyPulse — Local Deployment Guide

Run the full stack locally using **Podman** and `podman compose`. No Node.js installation required for the containerised path.

> **Note:** All `docker` commands in the codebase and compose files work identically with Podman — the CLI is fully compatible.

---

## What You'll Get

| Service       | URL                                   | Description                        |
|---------------|---------------------------------------|------------------------------------|
| **Dashboard** | http://localhost:3000                 | Next.js frontend                   |
| **API**       | http://localhost:4000/api             | NestJS REST API                    |
| **Swagger**   | http://localhost:4000/api/docs        | Interactive API explorer           |
| **PDF Parser**| http://localhost:5000/health          | Python microservice (healthcheck)  |
| **PostgreSQL**| localhost:5432                        | Database (moneypulse)              |
| **Redis**     | localhost:6379                        | Queue & cache                      |

---

## Prerequisites

### Required

| Tool | Minimum Version | Install |
|------|----------------|----------|
| **Podman Desktop** | 1.x+ (bundles `podman` 5.x + compose support) | https://podman-desktop.io |
| **Git** | any | https://git-scm.com |

> **macOS setup tip:** After installing Podman Desktop, open it and complete the onboarding wizard. It creates and starts a Podman machine (the Linux VM that runs containers) automatically. Wait until the status indicator is green before proceeding.

#### Verify Podman is ready

```bash
podman version          # should show Client + Server (machine)
podman compose version  # should show compose version
```

If `podman compose` isn't found, install the standalone shim:

```bash
brew install podman-compose
# then use 'podman-compose' instead of 'podman compose' in all commands below
```

### Optional (AI categorization)

| Tool | Notes |
|------|-------|
| **Ollama** | Only needed if you want local AI categorization. Pull `mistral:7b` after installing. The compose `ai` profile runs it as a container — no separate install needed. |

### Required for Development Mode only (apps run locally, not in containers)

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 22.x LTS | https://nodejs.org or `brew install node@22` |
| **pnpm** | 10.x | `npm install -g pnpm` |

---

## Option A — Full Podman Compose (Recommended for first run)

Everything runs in containers. The fastest way to see the app.

### Step 1 — Clone and navigate

```bash
git clone https://github.com/ManikantaR/MoneyPulse.git
cd MoneyPulse
```

If you already have the repo:

```bash
cd /path/to/MoneyPulse
git checkout main
git pull
```

### Step 2 — Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and set these two **required** values (everything else has safe defaults):

```env
# Required — choose any strong passwords/secrets
POSTGRES_PASSWORD=mysecurepassword123
JWT_SECRET=a_very_long_random_string_at_least_64_characters_long_change_this
```

> **Generate a strong JWT secret:**
> ```bash
> openssl rand -base64 64
> ```

### Step 3 — Build and start all services

```bash
podman compose up -d --build
```

This builds the API, web, and PDF parser images, then starts all 6 compose services (postgres, redis, api, web, pdf-parser, and backup). First build takes **5–10 minutes** (downloads base images and compiles TypeScript). Subsequent starts are seconds.

Watch the startup progress:

```bash
podman compose logs -f
```

Wait until you see:
```
api  | MoneyPulse API running on http://localhost:4000
api  | Swagger docs at http://localhost:4000/api/docs
```

Press `Ctrl+C` to stop following logs (services keep running).

### Step 4 — Run database migrations

Migrations are not run automatically. Run them once after the first start.

The recommended approach requires Node.js + pnpm installed locally (see [Prerequisites](#prerequisites)):

```bash
# Point to the containerised Postgres
DATABASE_URL=postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:migrate
```

> **No local pnpm?** The API container does not bundle the migration files or the `pg` client, so exec-based migration inside the container is not supported. Install Node.js 22 + pnpm 10 locally and run the command above, or use Option B (Dev Mode) which always runs migrations via the local toolchain.

### Step 5 — Seed default categories

```bash
# Replace the password with your POSTGRES_PASSWORD value
DATABASE_URL=postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:seed
```

> If you don't have pnpm locally, skip seeding — the app works without seed data. Categories can be created manually in the UI.

### Step 6 — Open the app

1. Navigate to **http://localhost:3000**
2. Click **"Create admin account"** and register the first user (auto-assigned admin role)
3. Log in and explore the dashboard

---

## Option B — Dev Mode (Hot Reload)

Only infra (Postgres, Redis) runs in Podman. The API and web app run locally with hot reload. Use this when actively developing.

### Step 1 — Install dependencies

```bash
# Requires Node.js 22+ and pnpm 10+
pnpm install
```

### Step 2 — Start infrastructure only

```bash
podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This starts only PostgreSQL and Redis in containers (API, web, pdf-parser are excluded in dev mode).

### Step 3 — Configure `.env`

```bash
cp .env.example .env
```

The dev `.env` already has correct `localhost` values. Only set the required secrets:

```env
POSTGRES_PASSWORD=mysecurepassword123
JWT_SECRET=a_very_long_random_string_at_least_64_characters_long_change_this
DATABASE_URL=postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse
```

### Step 4 — Run migrations and seed

```bash
pnpm --filter @moneypulse/api run db:migrate
pnpm --filter @moneypulse/api run db:seed
```

### Step 5 — Start the apps

```bash
pnpm dev
```

This starts both the NestJS API (port 4000) and Next.js frontend (port 3000) with hot reload via Turborepo.

> **Note:** The Python PDF parser service is not started in dev mode. PDF uploads will return an error. To test PDF parsing locally, see [Running PDF Parser Locally](#running-pdf-parser-locally) below.

---

## Verifying Everything Works

### Check service health

```bash
# All containers running?
podman compose ps

# API health (returns JSON with db/redis/ollama status)
curl http://localhost:4000/api/health | python3 -m json.tool

# PDF parser health
curl http://localhost:5000/health
```

Expected API health response:
```json
{
  "status": "ok",
  "services": {
    "database": "connected",
    "redis": "connected",
    "ollama": "unavailable"
  }
}
```

> `"ollama": "unavailable"` is normal unless you started with the `ai` profile.

### Check logs for a specific service

```bash
podman compose logs api        # NestJS API logs
podman compose logs web        # Next.js logs
podman compose logs pdf-parser # Python service logs
podman compose logs postgres   # Database logs

# Follow logs live (Ctrl+C to stop)
podman compose logs -f api
```

---

## Optional: Enable AI Categorization (Ollama)

Start the stack with the `ai` profile to include the Ollama container:

```bash
podman compose --profile ai up -d --build
```

Then pull the model (one-time — ~4 GB download):

```bash
podman compose exec ollama ollama pull mistral:7b
```

After first pull, Ollama will be ready automatically on subsequent starts. The AI health check in `/api/health` will show `"ollama": "available"`.

---

## Stopping and Cleaning Up

```bash
# Stop all containers (keeps data volumes)
podman compose down

# Stop and delete ALL data (database, uploads, etc.) — destructive!
podman compose down -v

# Stop the Podman machine entirely (frees RAM)
podman machine stop
```

---

## Running PDF Parser Locally

If you need to test PDF uploads in dev mode without Docker:

```bash
cd services/pdf-parser

# Create virtual environment (one-time)
python3 -m venv .venv

# Activate it
source .venv/bin/activate

# Install dependencies (one-time)
pip install -e .

# Start the service
uvicorn src.main:app --host 0.0.0.0 --port 5000
```

Then set in your `.env`:
```env
PDF_PARSER_URL=http://localhost:5000
```

---

## What's Currently Implemented (Phase 5)

The app is at **Phase 5** of 8 planned phases. Here's what you can test:

| Feature | Status | Where |
|---------|--------|-------|
| Register / Login / JWT auth | ✅ | `/login`, `/register` |
| Add bank accounts | ✅ | `/accounts` |
| Import transactions (CSV / Excel) | ✅ | `/upload` — supports BofA, Chase, Citi, Amex, generic CSV |
| Import transactions (PDF) | ✅ | `/upload` — requires PDF parser service running |
| Transaction grid with search/filter | ✅ | `/transactions` |
| Bulk categorize transactions | ✅ | `/transactions` — select rows → Categorize |
| Export transactions to CSV | ✅ | `/transactions` → Export button |
| Category management (tree view) | ✅ | `/categories` |
| AI auto-categorization | ✅ | Runs automatically on import (requires Ollama) |
| Dashboard — 7 charts + KPI cards | ✅ | `/` (home) |
| — Income vs Expenses bar chart | ✅ | Dashboard |
| — Spending by Category donut | ✅ | Dashboard |
| — Net Worth card | ✅ | Dashboard |
| — Top Merchants bar chart | ✅ | Dashboard |
| — Spending Trend line chart | ✅ | Dashboard |
| — Account Balances chart | ✅ | Dashboard |
| — Credit Utilization bars | ✅ | Dashboard |
| Budget alerts | ⏳ | Phase 6 |
| Savings goals | ⏳ | Phase 6 |
| Investments tracking | ⏳ | Phase 8 |

---

## Debugging

### Inspect running containers

```bash
# List all running containers with status and ports
podman compose ps
podman ps                           # all containers (any compose project)

# See resource usage (CPU/RAM)
podman stats --no-stream
```

### Shell into a running container

```bash
# API container
podman compose exec api sh

# Postgres container — run psql directly
podman compose exec postgres psql -U moneypulse moneypulse

# Redis container — run redis-cli
podman compose exec redis redis-cli
  > KEYS *            # list all keys
  > DBSIZE           # count keys
  > FLUSHALL         # clear queue (useful to unstick failed jobs)
```

### Inspect the database

```bash
podman compose exec postgres psql -U moneypulse moneypulse
```
Useful SQL once inside:
```sql
-- Check tables exist
\dt

-- Count rows in key tables
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM transactions;
SELECT COUNT(*) FROM categories;

-- Check a specific user
SELECT id, email, role FROM users;
\q
```

### Run API tests

```bash
# All tests
pnpm test

# API tests only (watch mode)
pnpm --filter @moneypulse/api run test:watch

# Single test file
pnpm --filter @moneypulse/api run test -- analytics.service

# With coverage
pnpm --filter @moneypulse/api run test:cov
```

### Debug NestJS API in VS Code (Dev Mode)

Add this to `.vscode/launch.json` (create the file if it doesn't exist):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@moneypulse/api", "run", "start:debug"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "DATABASE_URL": "postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse",
        "REDIS_URL": "redis://localhost:6379",
        "JWT_SECRET": "your_jwt_secret_here",
        "NODE_ENV": "development"
      }
    }
  ]
}
```

Then press **F5** in VS Code with the API package open. Breakpoints set in `apps/api/src/**` will hit.

> Prerequisite: infra must be running (`podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d`).

### Explore the API interactively (Swagger)

Open **http://localhost:4000/api/docs** in a browser while the API is running.

- All endpoints are listed with request/response schemas
- Use the **Authorize** button (top right) to paste a JWT token from the login response cookie
- Execute requests directly from the browser

### Check PDF parser logs / debug Python service

```bash
# Container logs
podman compose logs -f pdf-parser

# Health check
curl http://localhost:5000/health

# Test a parse request manually
curl -X POST http://localhost:5000/parse \
  -F 'file=@/path/to/statement.pdf' \
  -F 'institution=generic'
```

---

## Troubleshooting

### Port already in use

```bash
# Find what's using the port (example: 5432)
lsof -i :5432

# Kill it
lsof -ti:5432 | xargs kill -9

# Or change the host port mapping in docker-compose.yml
```

### API container keeps restarting

```bash
podman compose logs api
```

Most common causes:
- `POSTGRES_PASSWORD` not set in `.env`
- `JWT_SECRET` not set in `.env`
- Database not ready yet (wait 30 s and try `podman compose restart api`)

### Migrations fail

```bash
# Check postgres is healthy first
podman compose ps postgres

# Run migrations with explicit URL
DATABASE_URL=postgresql://moneypulse:YOUR_PASSWORD@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:migrate
```

### "Cannot connect to the Podman socket" / "podman machine" errors

The Podman machine is not running. Open Podman Desktop and wait for it to go green, or:

```bash
podman machine start
```

### `podman compose` command not found

```bash
brew install podman-compose
# then substitute 'podman-compose' for 'podman compose' in all commands above
```

### Next.js shows blank page or login loop

Clear browser cookies for `localhost:3000` and reload.

### PDF uploads fail silently

The PDF parser service is not running or not healthy. Check:
```bash
curl http://localhost:5000/health
podman compose logs pdf-parser
```

### Rootless networking — service can't reach another service

Podman runs rootless by default. If containers can't reach each other, ensure the compose network is up:

```bash
podman network ls
podman compose down && podman compose up -d
```
