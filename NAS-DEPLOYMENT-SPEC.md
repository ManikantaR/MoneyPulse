# MoneyPulse NAS Deployment Spec

Living document for the MoneyPulse ecosystem deployed on a UGREEN DXP4800+ NAS. This spec is the single source of truth for Claude Code or any AI agent picking up deployment, debugging, or feature work.

**SECURITY RULE**: This file is committed to git. NEVER put real secrets, passwords, API keys, account numbers, IP addresses with credentials, PII, or Firebase service account contents in this file. Use placeholder patterns like `<YOUR_VALUE>` instead. Reference `.env` files for actual values.

---

## 1. Target Hardware & OS

| Property | Value |
|----------|-------|
| NAS | UGREEN DXP4800+ |
| CPU | Intel N100 (4-core, 3.4 GHz burst) |
| OS | UGOS Pro (Debian-based) |
| Docker | Docker Engine 26.1.0 (no Compose plugin — use `docker compose` v2) |
| VLAN IP | Configured in router, static |
| SSH user | `manikanta3` (group: `admin`, gid=10) |
| SSH alias | `nas` (configured in `~/.ssh/config` on Mac) |

### UGOS Quirks (must-know)

- **Port 80/443 occupied** by UGOS built-in nginx — Traefik uses `8080`/`8443` instead.
- **`scp -O` required** — UGOS needs legacy SCP protocol (no SFTP subsystem).
- **BusyBox tar** — cannot parse macOS extended attributes. Use `COPYFILE_DISABLE=1` when creating tarballs on Mac.
- **No `docker compose` plugin** — UGOS ships standalone `docker compose` v2 binary, not the plugin.
- **`docker restart` does NOT re-read env vars** — must use `docker compose up -d --force-recreate`.

---

## 2. Ecosystem Components

### 2.1 MoneyPulse (self-hosted finance app)

| Component | Tech | Container Name | Port (internal) |
|-----------|------|----------------|-----------------|
| API | NestJS 11 + TypeScript | `moneypulse-api` | 4000 |
| Web UI | Next.js 16 | `moneypulse-web` | 3000 |
| Database | PostgreSQL 16 Alpine | `moneypulse-db` | 5432 |
| Cache/Queue | Redis 7 Alpine | `moneypulse-redis` | 6379 |
| PDF Parser | Python FastAPI | `moneypulse-pdf` | 5000 |
| DB Backup | pg_dump cron (2am daily) | `moneypulse-backup` | — |
| AI (optional) | Ollama | `moneypulse-ollama` | 11434 |

**Repo**: `~/repo/MyMoney` (local) → `/volume1/docker/moneypulse/repo` (NAS)
**Compose**: `/volume1/docker/docker-compose.moneypulse.yml`
**Env**: `/volume1/docker/moneypulse/repo/.env` (on NAS, gitignored)

### 2.2 Bank Statement Watcher (macOS daemon)

Runs on the Mac (not the NAS). Watches `~/Downloads` for bank CSV files, detects the bank from headers, matches to an account, renames with slug+timestamp, SCP-transfers to NAS watch folder.

| Component | Tech | Location |
|-----------|------|----------|
| Watcher | Python 3 + watchdog | `~/repo/bank-statement-watcher/` |
| LaunchAgent | macOS launchd | `~/Library/LaunchAgents/com.mani.bank-watcher.plist` |
| Python | Anaconda | `/Users/manikantaradhakrishna/opt/anaconda3/bin/python3` |
| Config | YAML | `~/repo/bank-statement-watcher/config.yaml` (gitignored) |

**Repo**: `~/repo/bank-statement-watcher` → `https://github.com/ManikantaR/bank-statement-watcher.git` (private)

Key files: `watcher.py` (entry point, `--scan` / `--scan-only` flags), `detector.py` (bank detection from CSV headers — handles BoA preamble rows), `matcher.py` (account matching by filename hints), `transfer.py` (SCP with retry queue), `notifier.py` (macOS notifications + Uptime Kuma heartbeat), `state.py` (processed-file tracking).

### 2.3 MoneyPulse Web (cloud companion)

Firebase-hosted read-only companion app. Receives de-identified financial data from the local API via one-way sync (Phase 9).

**Repo**: `~/repo/moneypulse-web`
**Hosting**: Firebase (Firestore + Hosting)
**Sync direction**: Local NAS → Firebase (one-way, never reverse)
**Data sanitization**: Alias mapper + HMAC signing + PII stripping before sync

### 2.4 Infrastructure Stack

| Service | Container | Traefik Host | Purpose |
|---------|-----------|-------------|---------|
| Traefik v3.4 | `traefik` | `traefik.home.lab` | Reverse proxy on port 8080 |
| AdGuard Home | `adguard` | `adguard.home.lab` | DNS + ad blocking (port 53) |
| Dozzle | `dozzle` | `logs.home.lab` | Real-time Docker log viewer |
| Uptime Kuma | `uptime-kuma` | `status.home.lab` | Service health monitoring |
| Homepage | `homepage` | `home.lab` | Dashboard |
| Watchtower | `watchtower` | — | Auto-update containers @ 4am |
| Portainer | `portainer` | — | Container mgmt (HTTPS :9443) |

**Compose**: `/volume1/docker/docker-compose.infra.yml`
**Network**: `traefik-public` (shared external network)

---

## 3. NAS Directory Layout

```
/volume1/docker/
├── docker-compose.infra.yml          # Infrastructure stack
├── docker-compose.moneypulse.yml     # MoneyPulse stack
├── traefik/
│   ├── traefik.yml                   # Static config
│   ├── dynamic/                      # Dynamic config
│   ├── acme.json                     # TLS certs (if any)
│   └── logs/
├── adguard/
│   ├── work/
│   └── conf/
├── homepage/
│   ├── settings.yaml
│   ├── services.yaml
│   ├── widgets.yaml
│   ├── bookmarks.yaml
│   ├── docker.yaml
│   ├── custom.css
│   └── custom.js
├── uptime-kuma/                      # Uptime Kuma data
├── moneypulse/
│   ├── repo/                         # MoneyPulse source code (synced from Mac)
│   │   └── .env                      # NAS-specific env vars (NEVER commit)
│   ├── pg/                           # PostgreSQL data
│   ├── redis/                        # Redis persistence
│   ├── uploads/                      # User uploads
│   ├── watch-folder/                 # Bank statement drop zone
│   │   ├── bofa-checking-XXXX/
│   │   ├── bofa-credit-XXXX/
│   │   ├── chase-freedom-unlimited-XXXX/
│   │   └── ...                       # One folder per account slug
│   ├── backup/                       # Daily pg_dump files (7-day retention)
│   └── ollama/                       # Ollama model weights (optional)
└── portainer/                        # Portainer data
```

---

## 4. Environment Variables

All secrets live in `.env` files that are **gitignored**. The compose file references them via `${VAR}` interpolation.

### Required env vars (NAS `.env`)

| Variable | Purpose | Format |
|----------|---------|--------|
| `POSTGRES_PASSWORD` | PostgreSQL auth | `openssl rand -hex 16` |
| `REDIS_PASSWORD` | Redis AUTH | `openssl rand -hex 16` |
| `JWT_SECRET` | JWT signing | `openssl rand -hex 64` |
| `ENCRYPTION_KEY` | AES-256-GCM for PII at rest | `openssl rand -hex 32` (64 hex chars) |
| `ALIAS_SECRET` | Sync alias mapper | `openssl rand -hex 32` |
| `SYNC_SIGNING_SECRET` | HMAC signing for sync payloads | `openssl rand -hex 32` |
| `FIREBASE_SYNC_ENDPOINT` | Cloud function URL for sync | URL string |

### Critical deployment notes

- `ENCRYPTION_KEY` must be exactly **64 hex characters** (32 bytes). The code validates at `crypto.ts` line 18.
- `COOKIE_SECURE` must be `'false'` for HTTP-only deployments (no HTTPS on local VLAN).
- `CORS_ORIGIN` must match the Traefik-routed URL (e.g., `http://moneypulse.home.lab:8080`).
- Compose `environment:` block only substitutes vars that are **explicitly listed** — adding a var to `.env` alone is not enough.
- `docker restart` does NOT re-read env vars — use `docker compose up -d --force-recreate`.

---

## 5. Deployment Workflow

### 5.1 Code changes → NAS deploy

The deploy script handles everything: `~/repo/MyMoney/deploy-to-nas.sh`

```bash
./deploy-to-nas.sh              # Rebuild & deploy API + Web
./deploy-to-nas.sh api          # API only
./deploy-to-nas.sh web          # Web only
./deploy-to-nas.sh sync-only    # Just sync code, no rebuild
./deploy-to-nas.sh db:migrate   # Sync + run Drizzle migrations
```

Under the hood: warns about uncommitted changes → checks SSH → `tar` with `COPYFILE_DISABLE=1` → `scp -O` → `docker compose build` → `docker compose up -d --force-recreate` → health check wait.

### 5.2 Database migrations

Drizzle ORM with drizzle-kit. Migrations live in `apps/api/db/migrations/`.

```bash
# Via deploy script
./deploy-to-nas.sh db:migrate

# Or manually on NAS
ssh nas
cd /volume1/docker/moneypulse/repo
docker compose -f /volume1/docker/docker-compose.moneypulse.yml exec api \
  node -e "..." # (migration script)
```

### 5.3 Seeding categories

67 categories across 13 groups. Seed script: `apps/api/src/db/seed.ts`

```bash
ssh nas
docker compose -f /volume1/docker/docker-compose.moneypulse.yml exec api \
  node -e "const { seed } = require('./dist/db/seed'); seed();"
```

### 5.4 Bank statement watcher (Mac)

```bash
cd ~/repo/bank-statement-watcher
./restart.sh                    # Restart after config changes
python3 watcher.py --scan       # Process existing files + watch
python3 watcher.py --scan-only  # Process existing files and exit
```

---

## 6. Schema Changes Applied (beyond base code)

These changes were made during NAS deployment and must be preserved:

1. **`last_four` column widened**: `varchar(4)` → `varchar(255)` in `accounts` table. Required because encrypted values are much longer than 4 chars. Applied both in schema.ts and via `ALTER TABLE` on NAS.

2. **`notifications.metadata` column added**: `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata jsonb`. Missing from earlier migrations.

3. **Watcher slug decryption**: `apps/api/src/ingestion/watcher.service.ts` — `findAccountBySlug()` now calls `decryptField(account.lastFour)` before generating the slug comparison, so encrypted lastFour values produce correct folder slugs.

---

## 7. Known Issues (Active)

### 7.1 Cannot assign category to transactions — ✅ Fixed 2026-05-25

- **Root cause**: `TransactionsService.update()` wrapped the domain write and the sync outbox insert in a single DB transaction. When `ALIAS_SECRET` is not configured, `AliasMapperService.toAliasId()` throws, the DB transaction rolls back, and the category update is never saved.
- **Fix**: `update()` now writes the domain change directly (no wrapping transaction) then calls the existing best-effort `enqueueTransactionEvent()` (which catches and logs errors) so an absent `ALIAS_SECRET` only causes a missed sync event — not a rolled-back category write.
- **Files changed**: `apps/api/src/transactions/transactions.service.ts` (lines ~261–278), `apps/web/src/lib/hooks/useTransactions.ts` (response type alignment)
- **Tests added**: `apps/api/src/transactions/__tests__/transactions.service.spec.ts`

### 7.2 Transactions not syncing to Firestore
- **Symptom**: After importing transactions, they don't appear in the Firebase companion app
- **Status**: Not yet investigated
- **Likely area**: Phase 9 sync domain — `apps/api/src/sync/`
- **Relevant spec**: `PHASE9-SYNC-SPEC.md`
- **Required env vars**: `ALIAS_SECRET`, `SYNC_SIGNING_SECRET`, `FIREBASE_SYNC_ENDPOINT`
- **Investigation steps**: Check if outbox_events table has pending rows, check if delivery worker is running, check dead-letter queue, verify Firebase endpoint is reachable from NAS

### 7.3 Bank Statement Watcher — BoA preamble handling
- **Fixed**: Detector now scans up to 15 rows to find the real header row, skipping BoA's summary preamble (balance, totals, etc.)
- **Test**: `python3 detector.py` runs 10 self-tests including preamble case

### 7.4 Uptime Kuma — Portainer monitor
- **Fixed**: Enabled "Ignore TLS/SSL error for HTTPS websites" in the Portainer monitor settings (self-signed cert on port 9443)

### 7.5 Homepage — AdGuard widget
- **Fixed**: Added `username` and `password` fields to the AdGuard widget config in `services.yaml`. Changed widget URL to `http://adguard:80` (Docker internal network).

### 7.6 "Failed to fetch" after NAS deploy — ✅ Fixed 2026-05-25
- **Root cause**: Next.js `NEXT_PUBLIC_*` env vars are baked into JS bundles at **build time** (`next build`). Setting them in the compose `environment:` block only affects runtime — too late for client-side code. Every rebuild of the web container would lose the API URL.
- **Fix**: Added `ARG NEXT_PUBLIC_API_URL` + `ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}` in `apps/web/Dockerfile` (builder stage, before `RUN pnpm --filter @moneypulse/web build`). Added `build.args.NEXT_PUBLIC_API_URL` in `docker-compose.moneypulse.yml`.
- **IMPORTANT**: Any future `NEXT_PUBLIC_*` variable must be added as both a Docker build ARG and a compose build arg — runtime `environment:` alone will NOT work.

---

## 8. Secret Protection Strategy

### What's already in place

- `.env`, `.env.local`, `.env.*.local` in `.gitignore`
- AES-256-GCM encryption for PII at rest (account numbers, lastFour, etc.)
- PII sanitization pipeline before any cloud AI call
- One-way sync with alias mapping (no real IDs leave the NAS)
- HMAC-signed sync payloads
- **gitleaks pre-commit hook** — blocks accidental secret commits (`.pre-commit-config.yaml`, `.gitleaks.toml`) ✅ Implemented 2026-05-25
- **GitHub Actions secret scan** — runs gitleaks on every PR (`.github/workflows/secret-scan.yml`) ✅ Implemented 2026-05-25

### Gitleaks setup (already installed — no action needed)

```bash
# Requires: brew install gitleaks pre-commit  (already done)
# Hook is active: pre-commit install has been run
# Config: .pre-commit-config.yaml (gitleaks v8.21.2)
# Rules:  .gitleaks.toml (custom Firebase, Postgres, ENCRYPTION_KEY rules + allowlists)
# Ignores: .gitleaksignore (10 confirmed false positives from history scan)
```

### Gitleaks custom rules (in `.gitleaks.toml`)

| Rule | Pattern |
|------|---------|
| `firebase-service-account` | JSON `"type": "service_account"` |
| `postgres-connection-string` | `postgres://user:password@` (excludes `${VAR}` substitutions) |
| `encryption-key-hex64` | `ENCRYPTION_KEY=<64 hex chars>` and similar |

### History scan results (2026-05-25)

Ran `gitleaks detect --source . --verbose` against all 90 commits. **10 findings, all false positives:**

| File | Line | Reason it's a false positive |
|------|------|-------------------------------|
| `scripts/deploy.sh` | 145 | `${POSTGRES_PASSWORD}` shell variable, not a real value |
| `scripts/setup.sh` | 129, 172, 188, 253 | Same — `${POSTGRES_PASSWORD}` shell variable |
| `scripts/reset.sh` | 75 | `${POSTGRES_USER}:${POSTGRES_PASSWORD}` shell variables |
| `.github/workflows/ci.yml` | 103, 126 | CI test DB uses literal `testpassword` (ephemeral container) |
| `.env.example` | 5 | Explicit placeholder `changeme_in_production` |
| `docker-compose.yml` | 47 | `${POSTGRES_PASSWORD}` compose variable interpolation |

All 10 fingerprints are recorded in `.gitleaksignore`. **No real secrets found. No rotations required.**

### Spec files rule

Any file ending in `-SPEC.md`, `DEPLOYMENT.md`, or `PLAN.md` must never contain:
- Real IP addresses with credentials
- Actual database passwords or API keys
- Real account numbers (even last 4)
- Real email addresses
- Firebase service account JSON contents

Use `<PLACEHOLDER>` notation instead.

---

## 9. Testing Strategy

### 9.1 Current state

- Unit tests: `pnpm test` (Jest, NestJS)
- No e2e tests running against NAS deployment
- No integration tests hitting real DB

### 9.2 Recommended: API integration tests

Priority order for Claude Code to implement:

1. **Ingestion pipeline test**: Upload a CSV → verify transactions created in DB → verify dedup on re-upload
2. **Category assignment test**: Create transaction → assign category → verify persisted
3. **Sync pipeline test**: Create transaction → verify outbox_event created → mock Firebase endpoint → verify delivery
4. **Watch folder test**: Drop CSV in watch folder → verify file picked up → verify transactions created
5. **Auth flow test**: Register → login → access protected endpoint → refresh token → logout

Framework: Jest + Supertest against a real PostgreSQL (Docker test container via `testcontainers`).

### 9.3 Future: Browser E2E

Playwright tests against the Next.js UI. Lower priority — API tests cover the critical paths.

---

## 10. Monitoring

### Uptime Kuma monitors (status.home.lab:8080)

| Monitor | Type | Target | Status |
|---------|------|--------|--------|
| MoneyPulse API | HTTP | `http://moneypulse.home.lab:8080/api/health` | Active |
| MoneyPulse Web | HTTP | `http://moneypulse.home.lab:8080` | Active |
| Traefik | HTTP | `http://traefik.home.lab:8080` | Active |
| AdGuard | HTTP | `http://adguard.home.lab:8080` | Active |
| Homepage | HTTP | `http://home.lab:8080` | Active |
| Dozzle | HTTP | `http://logs.home.lab:8080` | Active |
| Portainer | HTTPS | `https://<NAS_IP>:9443` (ignore TLS errors) | Active |
| Bank Watcher | Push | Heartbeat every 5 min from Mac watcher | Active |

### Homepage dashboard (home.lab:8080)

Cyberpunk glassmorphism theme with live Docker stats, resource widgets (CPU/RAM/disk/temp), category icons, and status dots for all services.

---

## 11. Changelog

Track all deployment-related changes here. Claude Code should append to this section after any deployment fix, schema change, or infrastructure modification.

| Date | Change | Category |
|------|--------|----------|
| 2026-05-24 | Initial NAS deployment of MoneyPulse | Deploy |
| 2026-05-24 | Added ENCRYPTION_KEY to compose env block | Fix |
| 2026-05-24 | Widened last_four varchar(4) → varchar(255) | Schema |
| 2026-05-24 | Added notifications.metadata jsonb column | Schema |
| 2026-05-24 | Added watcher slug decryption in watcher.service.ts | Fix |
| 2026-05-24 | Created deploy-to-nas.sh script | Tooling |
| 2026-05-24 | Set up Uptime Kuma monitors for all services | Infra |
| 2026-05-24 | Configured Homepage dashboard with custom CSS | Infra |
| 2026-05-24 | Full data reset (DB + Firestore), 12 accounts recreated | Data |
| 2026-05-24 | Seeded 67 categories (13 groups) | Data |
| 2026-05-24 | Bank watcher: added periodic heartbeat thread | Feature |
| 2026-05-24 | Bank watcher: added --scan / --scan-only flags | Feature |
| 2026-05-24 | Bank watcher: detector handles BoA preamble rows | Fix |
| 2026-05-24 | Fixed AdGuard widget (added auth creds) | Fix |
| 2026-05-24 | Fixed Portainer Uptime Kuma monitor (TLS ignore) | Fix |
| 2026-05-25 | Installed gitleaks pre-commit hook + GitHub Actions secret scan | Security |
| 2026-05-25 | Full git history scan: 10 false positives recorded, no real leaks | Security |
| 2026-05-25 | Fix category assignment: decouple sync outbox from domain write in TransactionsService.update() | Fix |
| 2026-05-25 | Fix "failed to fetch": pass NEXT_PUBLIC_API_URL as Docker build ARG (not just runtime env) | Fix |
