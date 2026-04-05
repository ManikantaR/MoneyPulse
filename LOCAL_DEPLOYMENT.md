# MoneyPulse — Local Deployment Guide

Run the full stack locally using **Podman** and `podman-compose`.

> **Important:** Use `podman-compose` (the standalone Python tool, installed via `brew install podman-compose`), **not** `podman compose`. Podman's built-in compose delegate picks up Docker's compose binary which fails on macOS without Docker Desktop running.

---

## What You'll Get

| Service        | URL                            | Description                       |
| -------------- | ------------------------------ | --------------------------------- |
| **Dashboard**  | http://localhost:3000          | Next.js frontend                  |
| **API**        | http://localhost:4000/api      | NestJS REST API                   |
| **Swagger**    | http://localhost:4000/api/docs | Interactive API explorer          |
| **PDF Parser** | http://localhost:5001/health   | Python microservice (healthcheck) |
| **PostgreSQL** | localhost:5432                 | Database (moneypulse)             |
| **Redis**      | localhost:6379                 | Queue & cache                     |

---

## Prerequisites

### Required

| Tool               | Minimum Version             | Install                       |
| ------------------ | --------------------------- | ----------------------------- |
| **Podman Desktop** | 1.x+ (bundles `podman` 5.x) | https://podman-desktop.io     |
| **podman-compose** | 1.x+                        | `brew install podman-compose` |
| **Git**            | any                         | https://git-scm.com           |

> **macOS setup tip:** After installing Podman Desktop, open it and complete the onboarding wizard. It creates and starts a Podman machine (the Linux VM that runs containers) automatically. Wait until the status indicator is green before proceeding.

#### Verify Podman is ready

```bash
podman version        # should show Client + Server (machine)
podman-compose --version  # should print podman-compose version
```

> **Why `podman-compose` instead of `podman compose`?**
> The `podman compose` sub-command on macOS delegates to whatever compose binary is found in PATH. If Docker Desktop is installed alongside Podman, its `docker-compose` binary gets picked up — and it fails with `docker-credential-desktop: executable file not found`. The standalone `podman-compose` avoids this entirely.

### Optional (AI categorization)

| Tool       | Notes                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ollama** | Only needed if you want local AI categorization. Pull `mistral:7b` after installing. The compose `ai` profile runs it as a container — no separate install needed. |

### Required for Development Mode only (apps run locally, not in containers)

| Tool        | Version  | Install                                      |
| ----------- | -------- | -------------------------------------------- |
| **Node.js** | 22.x LTS | https://nodejs.org or `brew install node@22` |
| **pnpm**    | 10.x     | `npm install -g pnpm`                        |

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
>
> ```bash
> openssl rand -base64 64 | tr -d '\n'
> ```
>
> Paste the full output as the value of `JWT_SECRET`. The default placeholder will cause startup to fail.

### Step 3 — Create the local data directories (one-time)

All persistent data lives **outside the repo** at `~/moneypulse-data/` so it survives branch switches and is never accidentally committed.

```bash
mkdir -p ~/moneypulse-data/{pg,redis,uploads,watch-folder,ollama,backup}
```

| Folder                           | Mounted as inside container | Purpose                             |
| -------------------------------- | --------------------------- | ----------------------------------- |
| `~/moneypulse-data/pg`           | `/var/lib/postgresql/data`  | Postgres database files             |
| `~/moneypulse-data/redis`        | `/data`                     | Redis snapshots                     |
| `~/moneypulse-data/uploads`      | `/data/uploads`             | Files uploaded via the UI           |
| `~/moneypulse-data/watch-folder` | `/data/watch-folder`        | Auto-import drop folder (see below) |
| `~/moneypulse-data/ollama`       | `/root/.ollama`             | Ollama model weights                |
| `~/moneypulse-data/backup`       | `/backup`                   | Nightly Postgres dumps              |

### Step 4 — Build and start all services

```bash
podman-compose up -d --build
```

This builds the API, web, and PDF parser images, then starts all 6 compose services (postgres, redis, api, web, pdf-parser, and backup). First build takes **5–10 minutes** (downloads base images and compiles TypeScript). Subsequent starts are seconds.

Watch the startup progress:

```bash
podman-compose logs -f
```

Wait until you see:

```
api  | MoneyPulse API running on http://localhost:4000
api  | Swagger docs at http://localhost:4000/api/docs
```

Press `Ctrl+C` to stop following logs (services keep running).

> **Note:** `podman-compose` starts postgres, redis, pdf-parser, backup, and api in sequence. The web container starts only after the API passes its health check (30 s window). If you see the web container not listed after `up`, wait ~45 s and run `podman-compose up -d web` to start it once the API is healthy.

### Step 5 — Run database migrations

Migrations are not run automatically. Run them once after the first start:

```bash
# Replace mysecurepassword123 with your POSTGRES_PASSWORD value
DATABASE_URL=postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:migrate
```

> **Alternative — run migrations inside the container** (no local pnpm needed):
>
> ```bash
> podman-compose exec api node --input-type=module -e "
> import { drizzle } from 'drizzle-orm/postgres-js';
> import { migrate } from 'drizzle-orm/migrator';
> import postgres from 'postgres';
> const sql = postgres(process.env.DATABASE_URL, { max: 1 });
> await migrate(drizzle(sql), { migrationsFolder: '/app/db/migrations' });
> console.log('Migrations done');
> await sql.end();
> process.exit(0);
> "
> ```

### Step 6 — Seed default categories

```bash
# Replace the password with your POSTGRES_PASSWORD value
DATABASE_URL=postgresql://moneypulse:mysecurepassword123@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:seed
```

> If you don't have pnpm locally, skip seeding — the app works without seed data. Categories can be created manually in the UI.

### Step 7 — Open the app

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
podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
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
podman-compose ps

# API health (returns JSON with db/redis/ollama status)
curl http://localhost:4000/api/health | python3 -m json.tool

# PDF parser health (port 5001 on host — mapped to 5000 inside container)
curl http://localhost:5001/health
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
podman-compose logs api        # NestJS API logs
podman-compose logs web        # Next.js logs
podman-compose logs pdf-parser # Python service logs
podman-compose logs postgres   # Database logs

# Follow logs live (Ctrl+C to stop)
podman-compose logs -f api
```

---

## Optional: Enable AI Categorization (Ollama)

Start the stack with the `ai` profile to include the Ollama container:

```bash
podman-compose --profile ai up -d --build
```

Then pull the model (one-time — ~4 GB download):

```bash
podman-compose exec ollama ollama pull mistral:7b
```

After first pull, Ollama will be ready automatically on subsequent starts. The AI health check in `/api/health` will show `"ollama": "available"`.

---

## Stopping and Cleaning Up

```bash
# Stop all containers (keeps data volumes)
podman-compose down

# Stop and delete ALL data (database, uploads, etc.) — destructive!
podman-compose down -v

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

| Feature                             | Status | Where                                                     |
| ----------------------------------- | ------ | --------------------------------------------------------- |
| Register / Login / JWT auth         | ✅     | `/login`, `/register`                                     |
| Add bank accounts                   | ✅     | `/accounts`                                               |
| Import transactions (CSV / Excel)   | ✅     | `/upload` — supports BofA, Chase, Citi, Amex, generic CSV |
| Import transactions (PDF)           | ✅     | `/upload` — requires PDF parser service running           |
| Transaction grid with search/filter | ✅     | `/transactions`                                           |
| Bulk categorize transactions        | ✅     | `/transactions` — select rows → Categorize                |
| Export transactions to CSV          | ✅     | `/transactions` → Export button                           |
| Category management (tree view)     | ✅     | `/categories`                                             |
| AI auto-categorization              | ✅     | Runs automatically on import (requires Ollama)            |
| Dashboard — 7 charts + KPI cards    | ✅     | `/` (home)                                                |
| — Income vs Expenses bar chart      | ✅     | Dashboard                                                 |
| — Spending by Category donut        | ✅     | Dashboard                                                 |
| — Net Worth card                    | ✅     | Dashboard                                                 |
| — Top Merchants bar chart           | ✅     | Dashboard                                                 |
| — Spending Trend line chart         | ✅     | Dashboard                                                 |
| — Account Balances chart            | ✅     | Dashboard                                                 |
| — Credit Utilization bars           | ✅     | Dashboard                                                 |
| Budget alerts                       | ⏳     | Phase 6                                                   |
| Savings goals                       | ⏳     | Phase 6                                                   |
| Investments tracking                | ⏳     | Phase 8                                                   |

---

## Debugging

### Inspect running containers

```bash
# List all running containers with status and ports
podman-compose ps
podman ps                           # all containers (any compose project)

# See resource usage (CPU/RAM)
podman stats --no-stream
```

### Shell into a running container

```bash
# API container
podman-compose exec api sh

# Postgres container — run psql directly
podman-compose exec postgres psql -U moneypulse moneypulse

# Redis container — run redis-cli
podman-compose exec redis redis-cli
  > KEYS *            # list all keys
  > DBSIZE           # count keys
  > FLUSHALL         # clear queue (useful to unstick failed jobs)
```

### Inspect the database

```bash
podman-compose exec postgres psql -U moneypulse moneypulse
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

> Prerequisite: infra must be running (`podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`).

### Explore the API interactively (Swagger)

Open **http://localhost:4000/api/docs** in a browser while the API is running.

- All endpoints are listed with request/response schemas
- Use the **Authorize** button (top right) to paste a JWT token from the login response cookie
- Execute requests directly from the browser

### Check PDF parser logs / debug Python service

```bash
# Container logs
podman-compose logs -f pdf-parser

# Health check (port 5001 on host)
curl http://localhost:5001/health

# Test a parse request manually
curl -X POST http://localhost:5001/parse \
  -F 'file=@/path/to/statement.pdf' \
  -F 'institution=generic'
```

---

---

## Testing with Synthetic Bank Statements

Sample files in every supported format live in `config/sample-data/`. Use them to exercise the parsers end-to-end.

### Supported formats & parsers

| File pattern           | Parser              | Format                                                                          |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `chase-checking-*.csv` | Chase Checking      | `Transaction Date, Posting Date, Description, Category, Debit, Credit, Balance` |
| `chase-cc-*.csv`       | Chase Credit Card   | `Transaction Date, Post Date, Description, Category, Type, Amount`              |
| `boa-checking-*.csv`   | Bank of America     | `Date, Reference Number, Description, Amount, Running Bal.`                     |
| `amex-*.csv`           | American Express    | `Date, Description, Amount` (positive = charge)                                 |
| `citi-*.csv`           | Citi                | `Status, Date, Description, Debit, Credit`                                      |
| `*.xlsx`               | Generic Excel       | First sheet, same column structure as any CSV above                             |
| `*.pdf`                | PDF parser (Python) | BofA rule-based; other banks use AI fallback                                    |

### Option 1 — Upload via the UI

1. Open **http://localhost:3000/accounts** and create a bank account (e.g. "Chase Checking", last four: `1234`)
2. Go to **http://localhost:3000/upload**
3. Select the account and drag-and-drop or choose a file from `config/sample-data/`
4. The API parses the file, deduplicates rows, and enqueues AI categorization
5. Check **http://localhost:3000/transactions** for the imported rows

### Option 2 — Drop files into the watch folder (auto-import)

The watch folder maps to `~/moneypulse-data/watch-folder/` on your Mac. The API watcher picks up new files automatically — no UI needed.

Files must be placed inside a **subfolder named after the account slug** (`{nickname-slug}-{last-four}`):

```
~/moneypulse-data/watch-folder/
  chase-checking-1234/          ← slug for "Chase Checking" account with last four 1234
    march-2026.csv
  boa-checking-5678/
    april-2026.xlsx
```

The slug format is: lowercase nickname, non-alphanumeric chars replaced with `-`, then `-{lastFour}`. Examples:

- "Chase Checking" + `1234` → `chase-checking-1234`
- "BofA Savings" + `9012` → `bofa-savings-9012`
- "Amex Platinum" + `0005` → `amex-platinum-0005`

**Drop a sample file:**

```bash
# 1. Find your account slug (visible in the Accounts page or via API)
curl -s http://localhost:4000/api/accounts \
  -H "Cookie: access_token=<your-token>" | python3 -m json.tool

# 2. Create the slug subfolder
mkdir -p ~/moneypulse-data/watch-folder/chase-checking-1234

# 3. Copy a sample file in
cp config/sample-data/chase-checking.csv \
   ~/moneypulse-data/watch-folder/chase-checking-1234/march-2026.csv
```

The API log will show:

```
[WatcherService] New file detected: /data/watch-folder/chase-checking-1234/march-2026.csv
[WatcherService] Enqueued parse job for upload <uuid>
```

Successfully processed files are moved to `.archived/` inside the slug folder.

---

## Start Fresh — Purge All Data

Use these commands to reset the app to a clean state.

### Stop containers first

```bash
podman-compose down
```

### Wipe individual data stores

```bash
# Postgres — all tables, users, transactions, categories
rm -rf ~/moneypulse-data/pg/*

# Redis — all queues and cached tokens
rm -rf ~/moneypulse-data/redis/*

# Uploaded files
rm -rf ~/moneypulse-data/uploads/*

# Watch folder and any archived imports
rm -rf ~/moneypulse-data/watch-folder/*

# Ollama model weights (~4 GB) — only if you want to re-download
rm -rf ~/moneypulse-data/ollama/*

# Nightly backups
rm -rf ~/moneypulse-data/backup/*
```

### Wipe everything at once (full reset)

```bash
podman-compose down
rm -rf ~/moneypulse-data/{pg,redis,uploads,watch-folder,backup}/*
```

> **Note:** This does **not** remove `~/moneypulse-data/ollama` so you keep the downloaded model weights. Add it to the command if you also want to free that ~4 GB.

### Restart and re-initialise

```bash
podman-compose up -d

# Wait ~30 s for postgres to initialise the empty data dir, then:
DATABASE_URL=postgresql://moneypulse:YOUR_PASSWORD@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:migrate

DATABASE_URL=postgresql://moneypulse:YOUR_PASSWORD@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:seed
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
podman-compose logs api
```

Most common causes:

- `POSTGRES_PASSWORD` not set in `.env`
- `JWT_SECRET` not set in `.env`
- Database not ready yet (wait 30 s and try `podman compose restart api`)

### Migrations fail

```bash
# Check postgres is healthy first
podman-compose ps postgres

# Run migrations with explicit URL
DATABASE_URL=postgresql://moneypulse:YOUR_PASSWORD@localhost:5432/moneypulse \
  pnpm --filter @moneypulse/api run db:migrate
```

### "Cannot connect to the Podman socket" / "podman machine" errors

The Podman machine is not running. Open Podman Desktop and wait for it to go green, or:

```bash
podman machine start
```

### `podman-compose` command not found

```bash
brew install podman-compose
```

### `podman compose` fails with `docker-credential-desktop` error

This happens when Docker Desktop is also installed — Podman delegates to Docker's compose binary which requires Docker Desktop to be running.

**Fix:** Always use `podman-compose` (the standalone tool) instead of `podman compose`:

```bash
brew install podman-compose
```

### Next.js shows blank page or login loop

Clear browser cookies for `localhost:3000` and reload.

### PDF uploads fail silently

The PDF parser service is not running or not healthy. Check:

```bash
curl http://localhost:5001/health
podman-compose logs pdf-parser
```

### Port 5000 in use (macOS AirPlay Receiver)

macOS Control Center reserves port 5000 for the AirPlay Receiver. The pdf-parser container is mapped to host port **5001** (→ internal 5000) to avoid this conflict. This is already handled in `docker-compose.yml`.

If you see `bind: address already in use` for port 5000, AirPlay Receiver is still the culprit. Disable it in **System Settings → General → AirDrop & Handoff → AirPlay Receiver**, or keep using port 5001 (the default).

### Rootless networking — service can't reach another service

Podman runs rootless by default. If containers can't reach each other, ensure the compose network is up:

```bash
podman network ls
podman-compose down && podman-compose up -d
```

### Web container fails to start / exits immediately

The web container depends on the API being healthy. `podman-compose` does not wait for health conditions before starting dependents — if the API is still initialising, the web container may fail to start.

**Fix:** Wait ~45 s for the API to become healthy, then start the web container manually:

```bash
# Check API is healthy first
curl http://localhost:4000/api/health

# Then start web
podman-compose up -d web
```
