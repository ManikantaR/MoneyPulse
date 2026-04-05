# MoneyPulse — Personal Finance Tracker: Comprehensive Plan

## TL;DR

Full-stack expense/income tracking app with bank statement ingestion (CSV, PDF, Excel), AI-powered categorization (Ollama local + cloud fallback), interactive dashboard, budgeting/alerts, Home Assistant webhooks, and MCP tools for AI agents. TypeScript monorepo (NestJS API + Next.js UI + MCP server) with PostgreSQL, Docker-first for Ugreen NAS, AWS-portable. TDD methodology — tests written before implementation for every feature.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose (Ugreen NAS)             │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Next.js  │  │ NestJS   │  │ PDF      │  │ MCP       │  │
│  │ Frontend │──│ API      │──│ Parser   │  │ Server    │  │
│  │ :3000    │  │ :4000    │  │ (Python) │  │ (stdio)   │  │
│  └──────────┘  └────┬─────┘  │ :5000    │  └───────────┘  │
│                     │        └──────────┘                   │
│                ┌────┴─────┐  ┌──────────┐  ┌───────────┐  │
│                │PostgreSQL│  │  Ollama   │  │  Redis    │  │
│                │  :5432   │  │  :11434   │  │  :6379    │  │
│                └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**7 services orchestrated via Docker Compose:**

- **Next.js UI** — Dashboard, upload, manual entry, charts (shadcn/ui + Recharts), dark mode
- **NestJS API** — REST with OpenAPI/Swagger, all business logic, auth, notifications
- **PDF Parser** — Python FastAPI microservice (pdfplumber + Ollama fallback for unstructured PDFs)
- **MCP Server** — TypeScript stdio server exposing transaction query tools for AI agents
- **PostgreSQL 16** — Primary data store, named volume for persistence
- **Redis 7** — BullMQ job queue for file processing + session cache
- **Ollama** — Local LLM (`mistral:7b`) for categorization + PDF extraction (Docker Compose with optional profile; supports external URL override)

---

## Key Architectural Decisions

| Decision             | Choice                                        | Rationale                                                                                                                           |
| -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **App Name**         | **MoneyPulse**                                | Clean namespace (13 GitHub repos, none serious), self-explanatory, modern feel                                                      |
| **Codebase**         | **Monorepo** (pnpm + Turborepo)               | Shared TS types between API/UI/MCP — no version drift; single Docker Compose                                                        |
| **Currency**         | **USD-only**                                  | Simplified amount handling; no exchange rate complexity                                                                             |
| **Auth**             | Passport.js + JWT + httpOnly cookies          | Simple, no external deps, NAS-friendly; can add OAuth/SSO later for AWS                                                             |
| **Registration**     | **Admin-only invite**                         | First user = admin. Admin creates household member accounts (temp password). No open registration                                   |
| **Multi-user**       | **Per-user accounts + shared household view** | Each user owns their accounts. "Household" groups users for shared dashboard. Admin sees all; members see own + household aggregate |
| **ORM**              | Drizzle ORM                                   | TypeScript-first, SQL-like syntax, lighter than Prisma, migrations as code                                                          |
| **Charts**           | Recharts                                      | React-native, composable, responsive, well-maintained                                                                               |
| **Job queue**        | BullMQ + Redis                                | Async file processing with retries, cron for budget checks                                                                          |
| **PDF parsing**      | Python microservice                           | Best PDF libs (pdfplumber, tabula-py) are Python; isolated responsibility via HTTP                                                  |
| **AI model**         | Ollama primary (`mistral:7b`), cloud opt-in   | Privacy first — data never leaves NAS; 7B model needs ~4GB RAM, excellent for classification + PDF extraction                       |
| **Dedup**            | Bank txn ID + SHA256 hash fallback            | Covers banks with/without transaction IDs in CSV                                                                                    |
| **Account numbers**  | **Last 4 digits only, NEVER store full**      | If DB compromised, no usable account numbers exposed                                                                                |
| **Balance tracking** | **Option B: Starting balance + computed**     | User provides starting balance at account creation; running balance computed from there. Upgrade to snapshot (Option C) if slow     |
| **Soft delete**      | **`deleted_at` timestamp on all entities**    | Deleted records still visible in analytics/graphs. Null = active                                                                    |
| **Testing**          | **TDD — tests first**                         | Every feature starts with test cases, then implementation                                                                           |
| **API versioning**   | `/api/` (no version prefix)                   | Simple for household app; add `/api/v2/` only if breaking changes arise                                                             |
| **Upload progress**  | Polling `GET /uploads/:id`                    | BullMQ already tracks job status; no WebSocket overhead needed                                                                      |

### Privacy & PII Protection Strategy

Before ANY cloud LLM call, a sanitization pipeline runs:

1. Strip: account numbers, routing numbers, SSNs, card numbers (regex patterns)
2. Replace: user names → "USER", addresses → "ADDRESS"
3. Only send to cloud: merchant description, date, amount, category guess
4. **Ollama (local) is primary** — data stays on NAS always
5. Cloud AI is an explicit per-user opt-in setting (default OFF)

### Ollama Deployment Strategy

- **Default**: Ollama runs inside Docker Compose with `mistral:7b` model (4GB RAM)
- **Optional profile**: `docker compose --profile ai up` to include Ollama
- **External override**: Set `OLLAMA_URL=http://192.168.x.x:11434` to point at a separate PC/mini PC and disable the Compose Ollama service
- Both NestJS API and PDF Parser read `OLLAMA_URL` from env

---

## Database Schema (Core Tables)

All tables include `created_at TIMESTAMPTZ DEFAULT NOW()` and `updated_at TIMESTAMPTZ DEFAULT NOW()`. Entities supporting deletion include `deleted_at TIMESTAMPTZ NULL` (soft delete).

| Table                    | Key Columns                                                                                                                                                                                                                                                                                             | Notes                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **users**                | id (uuid), email, password_hash, display_name, role (admin/member), household_id, deleted_at                                                                                                                                                                                                            | First user auto-admin. Password: 16+ chars min                                                                                 |
| **households**           | id (uuid), name                                                                                                                                                                                                                                                                                         | Groups household users                                                                                                         |
| **user_settings**        | id, user_id (unique FK), timezone, theme (light/dark/system), enable_cloud_ai (default false), ha_webhook_url, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, weekly_digest_enabled, notification_email                                                                                          | Per-user configuration                                                                                                         |
| **accounts**             | id (uuid), user_id, institution, account_type (checking/savings/credit_card), nickname, last_four, starting_balance_cents (integer), credit_limit_cents (integer, nullable), deleted_at                                                                                                                 | BofA/Chase/Amex/Citi. Credit limit configurable for utilization charts                                                         |
| **transactions**         | id (uuid), account_id, user_id, external_id, txn_hash, date, description, original_description, amount_cents (integer), category_id, merchant_name, is_credit, is_manual, tags (text[]), source_file_id, parent_transaction_id (nullable, self-FK), is_split_parent (boolean default false), deleted_at | **Unique indexes**: (account_id, external_id), (account_id, txn_hash). Split txns: parent preserved, children reference parent |
| **categories**           | id (uuid), name, icon, color, parent_id (self-FK, nullable), sort_order, deleted_at                                                                                                                                                                                                                     | Unlimited depth tree (recursive CTE). 15 defaults seeded                                                                       |
| **categorization_rules** | id, user_id, pattern, match_type (contains/startsWith/regex/exact), field (description/merchant), category_id, priority, is_ai_generated, confidence                                                                                                                                                    | Rules engine storage                                                                                                           |
| **budgets**              | id (uuid), user_id (nullable), household_id (nullable), category_id, amount_cents, period (monthly/weekly), deleted_at                                                                                                                                                                                  | user_id = personal budget; household_id only = shared budget. Both can coexist (Option C)                                      |
| **savings_goals**        | id (uuid), user_id, name, target_amount_cents, current_amount_cents, target_date, deleted_at                                                                                                                                                                                                            | Manual + auto-calculated                                                                                                       |
| **file_uploads**         | id (uuid), user_id, account_id, filename, file_type (csv/excel/pdf), file_hash (SHA256), status (pending/processing/completed/failed), rows_imported, rows_skipped, rows_errored, error_log (jsonb), archived_path                                                                                      | Idempotent uploads. File moved to `.archived/` on success                                                                      |
| **notifications**        | id (uuid), user_id, type, title, message, is_read, webhook_sent                                                                                                                                                                                                                                         | Budget alerts, import status                                                                                                   |
| **investment_accounts**  | id (uuid), user_id, institution, account_type (brokerage/retirement/stock_plan), nickname, deleted_at                                                                                                                                                                                                   | Phase 8                                                                                                                        |
| **investment_snapshots** | id, investment_account_id, date, balance_cents                                                                                                                                                                                                                                                          | Phase 8                                                                                                                        |
| **audit_logs**           | id (bigserial), user_id, action, entity_type, entity_id, old_value (jsonb), new_value (jsonb), ip_address, created_at                                                                                                                                                                                   | Actions: login, login_failed, password_changed, role_changed, transaction_edited, budget_exceeded, file_imported               |

> **Amount stored as integer cents** (not float) to avoid floating-point rounding issues.
> **Tags**: PostgreSQL `text[]` array on transactions — supports GIN index for fast lookups.

### Default Categories (15 seeded)

| #   | Name          | Icon | Color   | Parent |
| --- | ------------- | ---- | ------- | ------ |
| 1   | Income        | 💰   | #22c55e | —      |
| 2   | Groceries     | 🛒   | #16a34a | —      |
| 3   | Dining        | 🍽️   | #f59e0b | —      |
| 4   | Gas/Auto      | ⛽   | #ef4444 | —      |
| 5   | Shopping      | 🛍️   | #3b82f6 | —      |
| 6   | Travel        | ✈️   | #8b5cf6 | —      |
| 7   | Entertainment | 🎬   | #ec4899 | —      |
| 8   | Subscriptions | 📱   | #6366f1 | —      |
| 9   | Utilities     | 💡   | #14b8a6 | —      |
| 10  | Healthcare    | 🏥   | #f43f5e | —      |
| 11  | Housing       | 🏠   | #a855f7 | —      |
| 12  | Insurance     | 🛡️   | #64748b | —      |
| 13  | Education     | 📚   | #0ea5e9 | —      |
| 14  | Personal      | 👤   | #d946ef | —      |
| 15  | Transfers     | 🔄   | #6b7280 | —      |

Users can add subcategories under any of these (unlimited depth).

---

## Split Transaction Model

When a user splits a $150 Walmart transaction into $80 Groceries + $70 Household:

```
┌─────────────────────────────────────────┐
│ Parent Transaction (preserved)          │
│ id: txn-001                             │
│ description: "WALMART SUPERCENTER"      │
│ amount_cents: -15000                    │
│ is_split_parent: true                   │
│ category_id: null (no category on parent) │
└─────────┬───────────────────────────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌──────────┐ ┌──────────┐
│ Child 1  │ │ Child 2  │
│ $80.00   │ │ $70.00   │
│ Groceries│ │ Household│
│ parent_  │ │ parent_  │
│ txn: 001 │ │ txn: 001 │
└──────────┘ └──────────┘
```

- Original transaction stays (bank reconciliation)
- `is_split_parent = true` on parent — **excluded from analytics** to avoid double-counting
- Children have `parent_transaction_id` pointing to parent
- Children amounts must sum to parent amount (validated on API)
- Analytics queries filter: `WHERE is_split_parent = false AND deleted_at IS NULL`

---

## Security

| Concern             | Decision                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSRF**            | Deferred — local network only for now. Document steps to add SameSite=Strict + CSRF tokens when exposing to internet                                      |
| **Password policy** | 16+ characters minimum. bcrypt with cost factor 12                                                                                                        |
| **Rate limiting**   | `@nestjs/throttler` on auth endpoints (5 attempts/minute for login). General API: 100 req/min per user                                                    |
| **HTTPS/TLS**       | Deferred — bare ports on LAN. Future: Caddy reverse proxy in Docker Compose (documented in plan)                                                          |
| **Audit logging**   | Same PostgreSQL DB, `audit_logs` table. Captures: login, login_failed, password_changed, role_changed, transaction_edited, budget_exceeded, file_imported |

### Future HTTPS Setup (Documented for Later)

```yaml
# docker-compose.yml — add when ready
caddy:
  image: caddy:2-alpine
  ports:
    - '80:80'
    - '443:443'
  volumes:
    - ./config/Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
```

---

## Infrastructure

| Concern             | Decision                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Health checks**   | `GET /health` on API (:4000) and PDF Parser (:5000). Docker `HEALTHCHECK` directives. Exposable to Home Assistant for dashboard monitoring                                               |
| **Logging**         | Structured JSON logs via NestJS Logger. `docker logs` for now. Future: Loki/Promtail if needed                                                                                           |
| **DB backup**       | Docker container running `pg_dump --format=custom` via cron (daily 2 AM). Output: NAS shared folder `/backup/moneypulse/moneypulse_YYYY-MM-DD.sql.gz`. Retain 30 days, auto-delete older |
| **File storage**    | Uploads dropped to NAS shared folder (Docker volume: `UPLOAD_DIR=/data/uploads`). On successful import → moved to `{watch-folder}/{account-slug}/.archived/{filename}_{timestamp}`       |
| **Max upload size** | 50MB                                                                                                                                                                                     |
| **Reverse proxy**   | Deferred. Direct Docker port mapping for now. Caddy config documented for future                                                                                                         |

### Health Check Implementation

```typescript
// GET /health
{
  "status": "ok",
  "timestamp": "2026-03-22T10:00:00Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "ollama": "connected" | "unavailable" | "external"
  },
  "version": "1.0.0"
}
```

### DB Backup Strategy

```bash
#!/bin/bash
# config/backup/backup.sh — runs inside backup container
DATE=$(date +%Y-%m-%d)
pg_dump --format=custom -h postgres -U moneypulse moneypulse \
  | gzip > /backup/moneypulse_${DATE}.sql.gz
# Retain 30 days
find /backup -name "moneypulse_*.sql.gz" -mtime +30 -delete
```

---

## Data Export Strategy

For SQL Server portability and data ownership:

- **CSV export per table** — SQL Server `BULK INSERT` compatible
- **ANSI SQL DDL file** — `CREATE TABLE` statements without PostgreSQL-specific syntax
- **Admin CLI command**: `moneypulse export --format=csv --output=/path/`
- **Future UI**: "Download My Data" button (zip of CSVs)
- Triggered via API: `GET /admin/export?format=csv` (admin-only)

---

## Monorepo Structure

```
moneypulse/
├── package.json, pnpm-workspace.yaml, turbo.json
├── docker-compose.yml / docker-compose.dev.yml
├── .env.example
├── .gitignore
├── .github/workflows/ci.yml
│
├── apps/
│   ├── api/                        # NestJS REST API (:4000)
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/               # Passport + JWT + guards + roles
│   │   │   ├── users/              # User + household CRUD + invite
│   │   │   ├── accounts/           # Bank account management
│   │   │   ├── transactions/       # Transaction CRUD + search + split + bulk
│   │   │   ├── categories/         # Category tree management (unlimited depth)
│   │   │   ├── ingestion/
│   │   │   │   ├── parsers/        # boa.parser, chase.parser, amex.parser,
│   │   │   │   │                   # citi.parser, generic-csv.parser, excel.parser
│   │   │   │   ├── dedup.service   # Hash-based + external_id dedup
│   │   │   │   └── watcher.service # chokidar watch-folder auto-import
│   │   │   ├── categorization/     # Rule engine + AI categorizer + PII sanitizer
│   │   │   ├── analytics/          # Aggregation SQL queries for dashboard
│   │   │   ├── budgets/            # Budget + savings goals + alert engine
│   │   │   ├── notifications/      # Home Assistant webhook + email (nodemailer)
│   │   │   ├── jobs/               # BullMQ processors (parse, categorize, alerts, backup)
│   │   │   ├── health/             # Health check endpoint
│   │   │   ├── audit/              # Audit logging service
│   │   │   └── export/             # Data export (CSV/SQL)
│   │   └── test/                   # Test files (mirrors src/ structure)
│   │
│   ├── web/                        # Next.js Frontend (:3000)
│   │   ├── Dockerfile
│   │   ├── src/app/                # App Router pages
│   │   │   ├── page.tsx            # Dashboard (charts grid)
│   │   │   ├── login/              # Auth pages
│   │   │   ├── transactions/       # Grid + search + filter + bulk categorize
│   │   │   ├── upload/             # Drag-and-drop file upload
│   │   │   ├── budgets/            # Budget management + progress bars
│   │   │   ├── accounts/           # Account management
│   │   │   ├── settings/           # User prefs, webhook config, AI toggle
│   │   │   └── investments/        # Phase 8
│   │   ├── src/components/
│   │   │   ├── charts/             # 7 Recharts chart components
│   │   │   ├── TransactionGrid.tsx # TanStack Table with inline category edit
│   │   │   ├── PeriodSelector.tsx  # Date range preset + custom picker
│   │   │   ├── FileUpload.tsx      # Drag-and-drop with progress
│   │   │   └── ThemeToggle.tsx     # Dark mode toggle
│   │   └── __tests__/             # Frontend test files
│   │
│   └── mcp-server/                 # MCP Server (stdio, TypeScript)
│       ├── package.json
│       └── src/
│           ├── index.ts            # Server setup + tool registration
│           ├── tools/              # 8 MCP tools
│           └── db.ts               # PostgreSQL read-only connection
│
├── services/
│   └── pdf-parser/                 # Python FastAPI microservice (:5000)
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── src/
│           ├── main.py
│           ├── parsers/
│           │   ├── pdfplumber_parser.py
│           │   └── ai_parser.py
│           ├── routes.py
│           └── tests/              # pytest tests
│
├── packages/
│   └── shared/                     # Shared TS types, Zod schemas, constants
│       ├── package.json
│       └── src/
│           ├── types/              # Transaction, Account, User DTOs
│           ├── constants/          # Default categories, institutions
│           └── validation/         # Zod schemas (shared API <-> UI)
│
├── db/
│   └── migrations/                 # Drizzle migrations
│
└── config/
    ├── watch-folder/               # Docker volume mount — auto-import
    ├── backup/                     # DB backup scripts
    └── sample-data/                # Test CSVs/PDFs per bank
```

---

## Progress Tracking

| Phase       | Status         | Commit    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | ✅ DONE        | `df4e101` | Monorepo, NestJS, Next.js, shared pkg, Docker Compose, DB schema, health checks                                                                                                                                                                                                                                                                                                                                                                                            |
| **Phase 1** | ✅ DONE        | `515556a` | Auth (JWT + cookies + Redis), users, audit, guards, login/register/settings UI, 13 unit tests pass                                                                                                                                                                                                                                                                                                                                                                         |
| **Phase 2** | ✅ DONE        | `48ab0fa` | Bank accounts, CSV/Excel parsers (BofA/Chase/Amex/Citi/Generic), upload pipeline, dedup, watch folder, transactions CRUD. 49 unit tests pass. Security hardened: account ownership checks, filename sanitization, scoped upload status, .xls rejected, csvFormatConfig validated with Zod                                                                                                                                                                                  |
| **Phase 3** | ✅ DONE        | `af246eb` | AI categorization: rule engine (60+ seed rules), Ollama batch categorizer, PII sanitizer, learning loop, category tree CRUD, categorization rules REST API. 72 unit tests pass. Post-review fixes: userId in AI rule dedup, user-scoped rules query, schema-ref in getDescendantIds, enum migration, DB credentials                                                                                                                                                        |
| **Phase 4** | ✅ DONE        | `21c8dbe` | PDF parser microservice (Python FastAPI): BofA-specific + generic pdfplumber + Ollama AI fallback. NestJS PdfProxyService. Cascade auto-detects bank. 66 tests pass (57 Python + 9 NestJS). Docker + CI updated                                                                                                                                                                                                                                                            |
| **Phase 5** | ✅ DONE        | `aa15b99` | Dashboard & visualization: 7 analytics SQL endpoints (user-scoped, camelCase transforms), 8 Recharts chart components, dashboard with KPI cards + PeriodSelector, transactions with bulk select + CSV export, upload with drag-drop + history, accounts + categories CRUD pages, AppShell layout (collapsible sidebar, TopBar with notifications, dark mode). 112 API tests + 11 web tests pass. Security fixes: 13 Dependabot vulnerabilities resolved via pnpm overrides |
| **Phase 6** | ⬜ Not started | —         | Budgets, alerts & notifications                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Phase 7** | ⬜ Not started | —         | MCP server                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Phase 8** | ⬜ Not started | —         | Investment account tracking                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Phase 9** | 🔮 Future      | —         | Microsoft Agent Framework                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Phase 0: Project Scaffolding & Infrastructure ✅

**Dependencies: None**

| #   | Step                   | Details                                                                                                                                                                             |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Init monorepo          | `pnpm init`, `pnpm-workspace.yaml` → `apps/*`, `packages/*`, `services/*`; Turborepo with build/dev/test/lint pipelines; root `tsconfig.base.json` (strict)                         |
| 0.2 | Scaffold NestJS API    | `nest new api`; install `@nestjs/config`, `@nestjs/swagger`, `@nestjs/passport`, `@nestjs/jwt`, `@nestjs/bullmq`, `@nestjs/throttler`, `drizzle-orm`, `pg`, `bcrypt`, `zod`         |
| 0.3 | Scaffold Next.js UI    | `create-next-app` with TypeScript + Tailwind + App Router; install `recharts`, `@tanstack/react-query`, `@tanstack/react-table`, `shadcn/ui`, `date-fns`, `next-themes` (dark mode) |
| 0.4 | Shared package         | Zod schemas for all DTOs, TypeScript types, constants (institutions, default categories)                                                                                            |
| 0.5 | Docker Compose         | PostgreSQL 16, Redis 7, Ollama (profile: ai, model: mistral:7b), API, Web, PDF Parser; named volumes; `.env.example`; dev override with hot reload; health checks on all services   |
| 0.6 | Database migration     | Drizzle schema → initial migration → seed: 15 default categories + 4 institution configs                                                                                            |
| 0.7 | Health check endpoints | `GET /health` on API + PDF Parser; Docker HEALTHCHECK directives                                                                                                                    |
| 0.8 | Backup container       | Cron-based `pg_dump` to NAS shared folder, 30-day retention                                                                                                                         |

### Key Files

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`
- `apps/api/src/app.module.ts` — root NestJS module
- `apps/api/src/health/health.controller.ts`
- `packages/shared/src/types/` — all shared DTOs
- `db/migrations/` — initial schema migration
- `config/backup/backup.sh`

---

## Phase 1: Authentication & User Management ✅

**Dependencies: Phase 0**

| #   | Step                | Details                                                                                                                                                                            |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Passport + JWT auth | `POST /auth/register` (first user = admin), `/login`, `/refresh` (token rotation), `/logout` (Redis invalidation); JWT in httpOnly cookies; payload: `{userId, householdId, role}` |
| 1.2 | Password policy     | 16+ characters minimum. bcrypt cost factor 12. Validation in shared Zod schema                                                                                                     |
| 1.3 | Rate limiting       | `@nestjs/throttler` — login: 5 attempts/min, general API: 100 req/min per user                                                                                                     |
| 1.4 | Admin invite flow   | Admin creates users via `POST /users/invite` → generates temporary password. New user must change password on first login                                                          |
| 1.5 | User + household    | Admin creates household, assigns members; `@CurrentUser()` decorator, `RolesGuard`, `HouseholdGuard`                                                                               |
| 1.6 | User settings       | `user_settings` table: timezone, theme, HA webhook URL, SMTP config, cloud AI toggle, weekly digest toggle                                                                         |
| 1.7 | Audit logging       | Service that logs security events: login, login_failed, password_changed, role_changed                                                                                             |
| 1.8 | UI auth pages       | Login form, protected layout wrapper, user settings (password, display name, preferences), dark mode toggle                                                                        |

### Key Files

- `apps/api/src/auth/` — auth module, strategies, guards
- `apps/api/src/users/` — user module, service, controller, invite flow
- `apps/api/src/audit/audit.service.ts` — audit logging
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/components/ThemeToggle.tsx`

---

## Phase 2: Bank Accounts & CSV/Excel Ingestion

**Dependencies: Phase 1**

| #    | Step                       | Details                                                                                                                                                                                                             |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Account CRUD               | `POST/GET/PATCH/DELETE /accounts` — institution, type, nickname, last_four, starting_balance_cents, credit_limit_cents (for CC). Soft delete                                                                        |
| 2.2  | **Bank of America parser** | Columns: Date, Reference Number, Description, Amount, Running Bal. Date: MM/DD/YYYY. **Quirk**: negative = debit, positive = credit. Detect by header pattern                                                       |
| 2.3  | **Chase parser**           | **Credit cards**: Transaction Date, Post Date, Description, Category, Type, Amount (negative = charge). **Checking**: separate Debit/Credit columns (unsigned, one populated per row). Detect by "Post Date" header |
| 2.4  | **Amex parser**            | Columns: Date, Description, Amount. **Quirk**: positive = charge (opposite of BofA!), negative = credit/refund. Only 3 columns                                                                                      |
| 2.5  | **Citi parser**            | Columns: Status, Date, Description, Debit, Credit. Separate unsigned columns like Chase checking. Detect by "Status" header                                                                                         |
| 2.6  | **Generic CSV parser**     | Configurable format string (Tally-inspired): `{date:%m/%d/%Y},{description},{amount}`. Handles delimiter, sign convention, column mapping. Fallback for unknown banks                                               |
| 2.7  | **Excel parser**           | SheetJS (`xlsx`) → convert to rows → delegate to CSV parser logic                                                                                                                                                   |
| 2.8  | Upload API + pipeline      | `POST /uploads` multipart (50MB max); SHA256 hash → reject duplicate file; BullMQ job chain: `validate → parse → dedup → categorize → complete`; status via `GET /uploads/:id` (polling)                            |
| 2.9  | **Partial import**         | Import all valid rows. Log invalid rows in `file_uploads.error_log` (jsonb: `[{row: 5, error: "invalid date", raw: "..."}]`). `rows_errored` count tracked                                                          |
| 2.10 | **Dedup engine**           | Primary: match `external_id` (bank txn ID if in CSV). Fallback: SHA256(`date + amount + normalized_description + account_id`). On collision → skip, log in `rows_skipped`                                           |
| 2.11 | **File archival**          | On successful import → move file to `{watch-folder}/{account-slug}/.archived/{filename}_{timestamp}`                                                                                                                |
| 2.12 | Watch folder               | `chokidar` watches `/config/watch-folder/{account-slug}/`; new file → auto-trigger upload; slug auto-generated from account nickname (lowercase, hyphenated)                                                        |
| 2.13 | Manual entry               | `POST /transactions` — cash transactions, `is_manual=true`, user selects category                                                                                                                                   |

### Watch Folder Slug Generation

Account nickname → slug:

- "BofA Checking" → `bofa-checking`
- "Chase Visa 1234" → `chase-visa-1234`
- Lowercase, spaces/special chars → hyphens, strip trailing hyphens

Directory structure:

```
config/watch-folder/
├── bofa-checking/
│   ├── .archived/          # Successfully imported files
│   └── statement-mar.csv   # Drop file here → auto-import
├── chase-visa-1234/
└── amex-gold/
```

### Bank CSV Format Reference

#### Bank of America (Checking/Savings)

```csv
Date,Reference Number,Description,Amount,Running Bal.
03/15/2026,1234567890,WHOLE FOODS MARKET,-85.23,4234.56
03/14/2026,1234567891,PAYROLL DIRECT DEP,3200.00,4319.79
```

- Negative = debit, Positive = credit

#### Chase (Credit Card)

```csv
Transaction Date,Post Date,Description,Category,Type,Amount
03/15/2026,03/16/2026,STARBUCKS STORE 12345,Food & Drink,Sale,-5.75
03/12/2026,03/13/2026,PAYMENT THANK YOU,,Payment,1500.00
```

- Negative = charge, Positive = payment/credit

#### Chase (Checking)

```csv
Transaction Date,Posting Date,Description,Category,Debit,Credit,Balance
03/15/2026,03/15/2026,AMAZON.COM,Shopping,45.99,,3200.00
03/14/2026,03/14/2026,PAYROLL,,  ,3200.00,3245.99
```

- Separate Debit/Credit columns (unsigned)

#### Amex

```csv
Date,Description,Amount
03/15/2026,UBER EATS,34.50
03/12/2026,AMEX PAYMENT RECEIVED,-500.00
```

- **Positive = charge** (opposite of BofA/Chase!)
- Negative = credit/refund

#### Citi

```csv
Status,Date,Description,Debit,Credit
Cleared,03/15/2026,TARGET STORE 1234,89.50,
Cleared,03/10/2026,PAYMENT RECEIVED,,500.00
```

- Separate Debit/Credit columns (unsigned), "Status" column present

### Key Files

- `apps/api/src/accounts/` — account module
- `apps/api/src/ingestion/parsers/` — all bank parsers
- `apps/api/src/ingestion/ingestion.service.ts` — upload orchestration
- `apps/api/src/ingestion/dedup.service.ts` — deduplication logic
- `apps/api/src/ingestion/watcher.service.ts` — chokidar watch folder
- `apps/api/src/ingestion/archiver.service.ts` — file archival
- `apps/api/src/jobs/` — BullMQ job processors
- `apps/api/src/transactions/` — transaction CRUD

---

## Phase 3: AI-Powered Categorization ✅

**Dependencies: Phase 2**

| #   | Step                    | Details                                                                                                                                                                                                                                  |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Rule engine             | Priority-ordered rules from `categorization_rules` table. Match types: `contains`, `starts_with`, `regex`, `exact` on description/merchant. First-match wins. Seed 60+ common rules (AMAZON→Shopping, STARBUCKS→Dining, SHELL→Gas, etc.) |
| 3.2 | Ollama categorizer      | Uncategorized txns → batch 20-50 per call to Ollama (`mistral:7b`). Prompt returns `{category, subcategory, confidence, merchant_name}`. Confidence > 0.85 → auto-assign + create rule. < 0.85 → "suggested" for user review             |
| 3.3 | Cloud AI fallback       | PII sanitizer strips all identifiers → only sends merchant+date+amount to OpenAI/Claude API. User setting: `enable_cloud_ai` (default OFF)                                                                                               |
| 3.4 | Learning loop           | User overrides category → auto-generate rule (e.g., "UBER EATS" manually → "Dining" → rule created). Track AI accuracy via `is_ai_generated` + `confidence` fields                                                                       |
| 3.5 | **Bulk categorization** | `POST /transactions/bulk-categorize` — body: `{transaction_ids: [...], category_id: "..."}`. Creates rule from common pattern if descriptions share a prefix. Audit logged                                                               |
| 3.6 | Category + rule APIs    | Tree CRUD for categories (unlimited depth, recursive CTE); rule CRUD; `POST /transactions/:id/recategorize` for override + learn                                                                                                         |

### AI Categorization Flow

```
Transaction Imported
        │
        ▼
┌─────────────────┐     Match Found
│  Rule Engine     │────────────────► Category Assigned ✓
│  (pattern match) │
└────────┬────────┘
         │ No Match
         ▼
┌─────────────────┐     Confidence > 0.85
│  Ollama (Local)  │────────────────► Auto-Assign + Create Rule ✓
│  mistral:7b      │
└────────┬────────┘
         │ Low Confidence
         ▼
┌─────────────────┐     User Setting ON?
│  Cloud AI        │────────────────► Suggested Category (user confirms)
│  (PII-stripped)  │
└────────┬────────┘
         │ OFF or Still Low
         ▼
    Mark as "Uncategorized"
    (user manually assigns in UI)
         │
         ▼
    Auto-Create Rule from Manual Override
```

### Key Files

- `apps/api/src/categorization/rule-engine.service.ts`
- `apps/api/src/categorization/ai-categorizer.service.ts`
- `apps/api/src/categorization/pii-sanitizer.ts`
- `apps/api/src/categorization/learning.service.ts`
- `apps/api/src/categorization/categorization.service.ts` — orchestration
- `apps/api/src/categories/` — category tree CRUD + rules REST API
- `packages/shared/src/constants/seed-rules.ts` — 60+ default merchant→category rules
- `packages/shared/src/constants/default-categories.ts`

---

## Phase 4: PDF Parser Microservice ✅

**Dependencies: Phase 2 | Can run parallel with Phase 3**

| #   | Step                   | Details                                                                                                                                                                                                                                 |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Python FastAPI service | `POST /parse` accepts PDF binary + optional `institution` hint → returns JSON transactions. Deps: `pdfplumber`, `tabula-py`, `fastapi`, `uvicorn`, `httpx`, `pydantic`, `python-multipart`. Health: `GET /health`                       |
| 4.2 | Rule-based extraction  | BofA-specific parser (regex on pdfplumber text, section tracking for deposits/withdrawals). Generic pdfplumber table parser (header detection, single-amount and split debit/credit layouts). `tabula-py` available for complex layouts |
| 4.3 | AI extraction fallback | If table extraction fails → send page text to Ollama (`mistral:7b`). Structured prompt requesting JSON array. PII sanitized for any cloud call. 60s timeout                                                                             |
| 4.4 | NestJS integration     | `PdfProxyService` calls `http://pdf-parser:5000/parse` via native `fetch` + `FormData`. Snake→camelCase response mapping. Wired into `IngestionProcessor` PDF pipeline (parse → dedup → insert → categorize → archive → audit)          |
| 4.5 | Auto-detection cascade | BofA parser tried first on all requests (self-detects via header text) → generic table → AI fallback. Institution hint bypasses detection                                                                                               |

### Key Files

- `services/pdf-parser/src/main.py` — FastAPI app + routes
- `services/pdf-parser/src/models.py` — Pydantic models (ParsedTransaction, ParseResponse)
- `services/pdf-parser/src/parsers/boa_pdf.py` — BofA-specific parser
- `services/pdf-parser/src/parsers/pdfplumber_parser.py` — Generic table parser
- `services/pdf-parser/src/parsers/ai_parser.py` — Ollama AI fallback
- `services/pdf-parser/src/tests/` — 57 Python tests + synthetic PDF fixtures (fpdf2)
- `apps/api/src/ingestion/parsers/pdf-proxy.service.ts` — NestJS HTTP client (9 tests)

---

## Phase 5: Dashboard & Visualization ✅

**Dependencies: Phase 2 + Phase 3**

### Analytics API Endpoints

All accept query params: `from`, `to`, `account_id`, `category_id`, `household` (boolean)

All queries filter: `WHERE is_split_parent = false AND deleted_at IS NULL`

| Endpoint                                                           | Returns                                                          | Chart Type       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------- |
| `GET /analytics/income-vs-expenses?period=monthly`                 | Monthly income/expense totals                                    | Bar chart        |
| `GET /analytics/category-breakdown`                                | Category totals + percentages                                    | Donut chart      |
| `GET /analytics/spending-trend?granularity=daily\|weekly\|monthly` | Time-series spend data                                           | Line chart       |
| `GET /analytics/account-balances`                                  | Per-account running balance (starting_balance + cumulative txns) | Multi-line chart |
| `GET /analytics/credit-utilization`                                | CC balance vs credit_limit_cents per card                        | Progress bars    |
| `GET /analytics/net-worth`                                         | Assets − liabilities snapshot                                    | Summary card     |
| `GET /analytics/top-merchants?limit=10`                            | Highest spend merchants                                          | Horizontal bar   |

### Dashboard Layout (Visual Reference)

#### Income vs Expenses (Monthly Bar Chart)

```
  Income vs Expenses                    [Period: Last 6 Months ▾]
  ██ Income  ▓▓ Expenses
  $8k ┬
  $6k ┤  ██    ██    ██    ██    ██    ██
  $4k ┤  ██▓▓  ██▓▓  ██▓▓  ██▓▓  ██▓▓  ██▓▓
  $2k ┤  ██▓▓  ██▓▓  ██▓▓  ██▓▓  ██▓▓  ██▓▓
     0 ┴──Oct───Nov───Dec───Jan───Feb───Mar──
```

#### Spending by Category (Donut Chart)

```
        ╭──────────╮        ● Groceries    28%  $1,540
       ╱            ╲       ● Dining       22%  $1,210
      │    Total:    │      ● Gas/Auto     15%  $825
      │   $5,500     │      ● Travel       12%  $660
       ╲            ╱       ● Subscriptions  8%  $440
        ╰──────────╯        ● Other        15%  $825
```

#### Spending Trend (Line Chart)

```
  Monthly Spending Trend
  $7k ┬
  $6k ┤           ╱╲
  $5k ┤     ╱╲  ╱    ╲     ╱╲
  $4k ┤   ╱    ╲╱      ╲  ╱    ╲
  $3k ┤  ╱                ╱      ╲──
  $2k ┴──Oct──Nov──Dec──Jan──Feb──Mar──
```

#### Account Balance History (Multi-line)

```
  Account Balances (starting_balance + cumulative transactions)
  ── BofA Checking  ── BofA Savings  -- Chase CC
  $15k ┬  ─────────────
  $10k ┤         ╲─────────────
   $5k ┤
     $0 ┤─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  -$3k ┤  - - - - - - - - - (CC debt)
       Oct   Nov   Dec   Jan   Feb   Mar
```

#### Credit Card Utilization (Progress Bars)

```
  Credit Utilization (balance / credit_limit_cents)
  Chase Visa     ████████████░░░░  $3,200 / $5,000  (64%)
  Amex Gold      █████░░░░░░░░░░░  $1,800 / $10,000 (18%)
  Citi Double    ██░░░░░░░░░░░░░░  $500 / $8,000     (6%)
```

#### Transaction Grid

```
┌───────────────────────────────────────────────────────────────┐
│ Transactions   🔍[Search...]  [Category ▾] [Account ▾] [CSV] │
│ [☐ Select All]  [Bulk: Assign Category ▾]                     │
├──────┬─────────────────┬───────────┬─────────┬───────────────┤
│ Date │ Description     │ Category▾ │ Amount  │ Account       │
├──────┼─────────────────┼───────────┼─────────┼───────────────┤
│ 3/15 │ WHOLE FOODS 365 │ Grocery ▾ │ -$85.23 │ BofA Checking │
│ 3/14 │ NETFLIX.COM     │ Subs   ▾  │ -$15.99 │ Chase CC      │
│ 3/14 │ PAYROLL DIRECT  │ Income    │+$3,200  │ BofA Checking │
│ 3/13 │ SHELL OIL 04522 │ Gas    ▾  │ -$52.40 │ Amex          │
│ 3/12 │ UBER EATS       │ Dining ▾  │ -$34.50 │ Citi CC       │
├──────┴─────────────────┴───────────┴─────────┴───────────────┤
│  ◀ Prev   Page 1 of 24   Next ▶          Total: 573 txns    │
└───────────────────────────────────────────────────────────────┘
```

> ▾ = clicking category opens inline dropdown to override
> Bulk select + "Assign Category" for bulk categorization

### Steps

| #   | Step                              | Status | Details                                                                                                                                                                   |
| --- | --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Analytics SQL queries             | ✅     | 7 PostgreSQL aggregation endpoints with date range + account filters. camelCase transform layer in service. No Redis cache yet (deferred)                                 |
| 5.2 | Transaction grid API              | ✅     | Paginated list, search, CSV export endpoint, bulk categorize endpoint                                                                                                     |
| 5.3 | Period selector component         | ✅     | Presets: This Month, Last Month, Last 90 Days, YTD, Last 12 Months + custom date range                                                                                    |
| 5.4 | Build 8 Recharts chart components | ✅     | `StatCard`, `IncomeExpenseBar`, `CategoryDonut`, `SpendingTrendLine`, `AccountBalanceHistory`, `CreditUtilization`, `NetWorthCard`, `TopMerchantsBar`                     |
| 5.5 | Dashboard page                    | ✅     | 3-column responsive grid, KPI stat cards (computed from monthly rows), all charts, PeriodSelector, dark mode                                                              |
| 5.6 | Transaction page                  | ✅     | HTML table with inline category dropdown, bulk select checkboxes + assign category, CSV export download. No TanStack Table (not needed). Split txn UI deferred to Phase 6 |
| 5.7 | Upload page                       | ✅     | Drag-and-drop zone, account selector, upload history table                                                                                                                |
| 5.8 | App layout                        | ✅     | AppShell (flex), collapsible Sidebar (6 nav items), TopBar (notification bell + dark mode toggle + avatar + logout)                                                       |
| 5.9 | Additional pages                  | ✅     | Accounts CRUD (card grid), Categories CRUD (tree view with icon/color), Settings (timezone, theme)                                                                        |

### Implementation Notes

- **No TanStack Table** — HTML table with inline selects is sufficient; adds no dependency
- **No Redis caching** — Analytics queries hit DB directly; can add 5min TTL cache in Phase 6+
- **Notification bell** integrated into TopBar (not a separate component)
- **TransactionGrid / FileUpload** are inline in their page files (not extracted to standalone components)
- **camelCase transforms** done in `analytics.service.ts` `.map()` layer (not via NestJS interceptor/serializer)
- **KPI totals** computed client-side from monthly `incomeVsExpenses` rows via `useMemo`

### Key Files

- `apps/api/src/analytics/analytics.service.ts` — 7 aggregation methods with camelCase transforms
- `apps/api/src/analytics/analytics.controller.ts` — 7 GET endpoints with JwtAuthGuard
- `apps/api/src/analytics/__tests__/analytics.service.spec.ts` — 18 unit tests
- `apps/api/src/transactions/export.service.ts` — CSV export (5 unit tests)
- `apps/web/src/components/AppShell.tsx` — flex layout shell
- `apps/web/src/components/Sidebar.tsx` — collapsible navigation
- `apps/web/src/components/TopBar.tsx` — notification bell + theme toggle
- `apps/web/src/components/PeriodSelector.tsx` — date range selector
- `apps/web/src/components/charts/` — 8 Recharts chart components
- `apps/web/src/lib/hooks/useAnalytics.ts` — 7 typed React Query hooks
- `apps/web/src/app/(protected)/page.tsx` — dashboard
- `apps/web/src/app/(protected)/transactions/page.tsx` — transaction grid with bulk select

---

## Phase 6: Budgets, Alerts & Notifications

**Dependencies: Phase 5**

| #   | Step                       | Details                                                                                                                                                                                                                 |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Budget CRUD                | `POST/GET/PATCH/DELETE /budgets` — monthly limit per category. Personal: `user_id` set. Shared: `household_id` set (no user_id). `GET /budgets/status` returns `{ spent, limit, remaining, percentage, projected_eom }` |
| 6.2 | Savings goals              | CRUD + `POST /savings-goals/:id/contribute`; auto-calculate savings = income − expenses per month                                                                                                                       |
| 6.3 | Alert engine               | BullMQ cron (daily) + triggered on every import. Budget > 80% → warning, > 100% → alert. Savings milestones at 25/50/75/100%. Audit logged                                                                              |
| 6.4 | **Home Assistant webhook** | `POST https://<ha-url>/api/webhook/<id>` with payload `{ title, message, data: { category, spent, limit, pct } }`. User configures URL in `user_settings`. Triggers: budget alert, import complete, goal milestone      |
| 6.5 | **Email notifications**    | `nodemailer` + SMTP from `user_settings`. Weekly digest: spending summary + budget status. Instant: over-budget alerts                                                                                                  |
| 6.6 | Budget UI                  | Budget progress bars (green/yellow/red), personal vs shared tabs, savings goal cards with projected completion, notification bell with unread count                                                                     |

### Key Files

- `apps/api/src/budgets/` — budget + savings goal modules
- `apps/api/src/notifications/` — webhook + email services
- `apps/api/src/jobs/budget-check.job.ts` — cron processor
- `apps/web/src/app/budgets/page.tsx` — budget management page

---

## Phase 7: MCP Server

**Dependencies: Phase 2 + 3 (after core API stable)**

### 8 MCP Tools

| Tool                     | Params                                                       | Returns                                   |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------- |
| `get_transactions`       | from, to, account, category, merchant, min/max_amount, limit | Transaction array                         |
| `get_spending_summary`   | from, to, group_by (category/merchant/account), top_n        | Grouped totals + %                        |
| `get_budget_status`      | category (optional)                                          | Budget health per category                |
| `get_account_balances`   | —                                                            | Per-account balance + net                 |
| `search_transactions`    | query (text), from, to                                       | Full-text search results                  |
| `get_category_breakdown` | from, to                                                     | Category tree with amounts                |
| `compare_periods`        | period_a_start/end, period_b_start/end                       | Delta per category                        |
| `get_recurring_expenses` | —                                                            | Merchants with consistent monthly charges |

> Direct PostgreSQL read-only connection (no API hop for speed).
> All queries respect soft delete and split parent filters.

### Key Files

- `apps/mcp-server/src/index.ts` — server setup + tool registration
- `apps/mcp-server/src/tools/*.ts` — individual tool implementations
- `apps/mcp-server/src/db.ts` — PostgreSQL read-only connection

---

## Phase 8: Investment Account Tracking

**Dependencies: Phase 5 | Balance-tracking only, not trade analysis**

| #   | Step                    | Details                                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 8.1 | Investment account CRUD | Institution (Robinhood/Betterment/Shareworks/T.Rowe), type (brokerage/retirement/stock_plan), nickname. Soft delete |
| 8.2 | Manual balance entry    | `POST /investment-accounts/:id/snapshots` — date + balance. Can import CSV if broker provides                       |
| 8.3 | Basic CSV parsers       | Robinhood/Betterment CSV → extract date + total account value (not trades). Shareworks Excel → same                 |
| 8.4 | Net worth calculation   | Sum(checking + savings + investments) − Sum(CC balances) = net worth. Monthly historical snapshots                  |
| 8.5 | Dashboard widgets       | Net worth trend line, investment balances card, retirement total                                                    |

### Investment Platform Export Formats

| Platform                        | Format    | Key Fields                                                             |
| ------------------------------- | --------- | ---------------------------------------------------------------------- |
| **Robinhood**                   | CSV       | Date, Transaction Type, Symbol, Shares, Price, Amount                  |
| **Betterment**                  | CSV       | Date, Transaction Type, Symbol, Shares, Unit Price, Amount, Balance    |
| **Shareworks (Morgan Stanley)** | CSV/Excel | Grant Date, Vesting Date, Transaction Type, Shares, Price, Total Value |
| **T. Rowe Price**               | CSV/PDF   | Fund Name, Date, Transaction Type, Shares, Unit Price, Amount          |

### Key Files

- `apps/api/src/investments/` — investment module
- `apps/web/src/app/investments/page.tsx`

---

## Phase 9: Microsoft Agent Framework Integration (Future)

**Dependencies: Phase 7 (MCP server must exist)**

| #   | Step                 | Details                                                                                                                                                        |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | Python agent service | `services/ai-agent/` using `agent-framework` package (Python). Agent connects to MoneyPulse MCP server as tool provider                                        |
| 9.2 | Agent capabilities   | NL queries ("financial health this month?"), anomaly detection ("flag unusual txns"), predictive budgeting ("will I exceed dining budget?"), multi-turn memory |
| 9.3 | Integration          | Standalone CLI, or embedded chat in MoneyPulse web, or API for Home Assistant voice commands                                                                   |

> **Note**: MS Agent Framework is Python/C# only — no TypeScript runtime. The agent is a **separate Python service** that uses the MCP tools built in Phase 7.

### Key Files

- `services/ai-agent/src/agent.py`
- `services/ai-agent/src/tools.py` — MCP tool bindings

---

## Verification Plan (TDD)

### Testing Strategy

**Every feature follows TDD**:

1. Write failing test(s) first
2. Implement minimum code to pass
3. Refactor while keeping tests green

### Test Layers

| Test Type       | What                                                                                                                                                                                                                                        | Tool                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Unit**        | Each CSV parser with real bank samples; dedup engine (upload same file twice → 0 new); rule engine pattern matching + priority; PII sanitizer strips account#/SSN/names; split transaction validation; bulk categorization; slug generation | Vitest (TS), pytest (Python)    |
| **Integration** | Upload CSV → verify DB rows; same file again → idempotent; create budget → exceed → verify notification; auth flow end-to-end; audit log entries; soft delete + analytics exclusion                                                         | NestJS testing module + test DB |
| **E2E**         | Login → upload → grid shows data; dashboard charts render; change category inline → rule created; budget page progress bars; dark mode toggle; split transaction flow; bulk categorize                                                      | Playwright                      |

### Manual Verification

1. Export real CSVs from BofA, Chase, Amex, Citi → upload each → verify correct parsing (sign conventions, dates)
2. Upload a BofA PDF → verify Python parser extracts transactions correctly
3. Run Ollama on 50 uncategorized transactions → check accuracy
4. Configure HA webhook → trigger budget alert → verify NAS announcement
5. Claude Desktop + MCP: ask "How much dining this month?" → verify correct answer
6. Split a transaction → verify parent excluded from analytics, children included
7. Bulk categorize 20 transactions → verify rule created from common pattern

---

## CI/CD Strategy (for Local NAS)

**Option A (Recommended)**: GitHub Actions with self-hosted runner on Ugreen NAS

- Install `actions-runner` in Docker on NAS
- On push to `main`: lint → test → build Docker images → `docker compose up -d` on NAS
- Images stay local (no registry needed), or push to GHCR for AWS later

**Option B**: Manual Docker Compose deploy

```bash
git pull && docker compose build && docker compose up -d
```

---

## Technology Stack Summary

| Layer             | Technology                   | Version     |
| ----------------- | ---------------------------- | ----------- |
| **Runtime**       | Node.js                      | 22 LTS      |
| **Backend**       | NestJS                       | 11.x        |
| **Frontend**      | Next.js                      | 16.x        |
| **UI Components** | shadcn/ui + Tailwind CSS     | latest      |
| **Charts**        | Recharts                     | 2.x         |
| **Data Grid**     | TanStack Table               | 8.x         |
| **Dark Mode**     | next-themes                  | latest      |
| **ORM**           | Drizzle ORM                  | latest      |
| **Database**      | PostgreSQL                   | 16          |
| **Cache/Queue**   | Redis + BullMQ               | 7.x         |
| **PDF Parsing**   | Python FastAPI + pdfplumber  | 3.12        |
| **AI (Local)**    | Ollama + mistral:7b          | latest      |
| **AI (Cloud)**    | OpenAI / Anthropic API       | opt-in      |
| **MCP**           | @modelcontextprotocol/sdk    | latest      |
| **Monorepo**      | pnpm + Turborepo             | latest      |
| **Containers**    | Docker + Docker Compose      | latest      |
| **Testing**       | Vitest + Playwright + pytest | latest      |
| **Agent**         | MS Agent Framework (Python)  | pre-release |

---

## Scope Boundaries

### Included

- CSV/PDF/Excel ingestion for BofA, Chase, Amex, Citi
- AI categorization (Ollama local + cloud opt-in with PII stripping)
- Multi-user household with admin/member roles (admin-only invite)
- 7 chart types + transaction grid with inline edit
- **Split transactions** (parent + children model)
- **Bulk categorization** (multi-select + assign)
- Budgets + alerts (Home Assistant webhook + email) — personal + shared household
- MCP server (8 tools) for AI agent integration
- Docker-first for Ugreen NAS, AWS-portable
- Investment balance tracking (Phase 8)
- Watch folder auto-import + manual upload
- Manual cash transaction entry
- Deduplication (bank ID + hash fallback)
- Generic CSV parser for unknown banks
- **Dark mode** (shadcn/ui + next-themes)
- **Audit logging** (security events)
- **Health checks** (Home Assistant compatible)
- **DB backup** (pg_dump cron to NAS)
- **Data export** (CSV/SQL for SQL Server portability)
- **Soft delete** (all entities, preserved in analytics)
- **TDD** — tests first for every feature

### Excluded (for now)

- Direct bank API (Plaid) — no paid bank sync
- Mobile app — web responsive only
- Bill reminders / recurring payment detection
- Tax reporting / 1099 generation
- Cryptocurrency tracking
- Individual stock trade analysis (balance only)
- Real-time bank sync
- OFX/QFX file format support (can add later)
- CSRF protection (local network; documented for future)
- HTTPS/TLS (local network; Caddy config documented for future)

---

## Complete Decision Log

All decisions from the planning phase, for reference:

| #   | Topic               | Decision                                                                                                                                                           |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | App name            | MoneyPulse                                                                                                                                                         |
| 2   | Currency            | USD-only                                                                                                                                                           |
| 3   | Balance tracking    | Starting balance + computed (Option B). Upgrade to snapshot (C) if slow                                                                                            |
| 4   | Split transactions  | In scope. Parent preserved, children created, analytics use children only                                                                                          |
| 5   | Transaction editing | Description, category, tags editable. Amount/date immutable                                                                                                        |
| 6   | Partial import      | Import all valid rows, log errors in jsonb                                                                                                                         |
| 7   | Reverse proxy       | Deferred. Direct ports on LAN. Caddy documented for future                                                                                                         |
| 8   | File retention      | Move to `.archived/` subfolder on successful import                                                                                                                |
| 9   | Dark mode           | Yes (shadcn/ui + next-themes)                                                                                                                                      |
| 10  | Upload progress     | Polling `GET /uploads/:id`                                                                                                                                         |
| 11  | Category depth      | Unlimited (recursive CTE)                                                                                                                                          |
| 12  | Default categories  | 15: Income, Groceries, Dining, Gas/Auto, Shopping, Travel, Entertainment, Subscriptions, Utilities, Healthcare, Housing, Insurance, Education, Personal, Transfers |
| 13  | Ollama hosting      | Docker Compose (optional profile) + external URL override for separate PC                                                                                          |
| 14  | Ollama model        | `mistral:7b` (~4GB RAM, excellent for classification + PDF extraction)                                                                                             |
| 15  | Audit log           | Same DB, `audit_logs` table                                                                                                                                        |
| 16  | Data export         | CSV per table + ANSI SQL DDL (SQL Server compatible)                                                                                                               |
| 17  | API versioning      | `/api/` (no version prefix)                                                                                                                                        |
| 18  | Timestamps          | `created_at`, `updated_at` on all tables                                                                                                                           |
| 19  | Credit limit        | Stored in `accounts.credit_limit_cents`, configurable                                                                                                              |
| 20  | User settings       | Separate `user_settings` table                                                                                                                                     |
| 21  | Tags                | PostgreSQL `text[]` on transactions with GIN index                                                                                                                 |
| 22  | Soft delete         | `deleted_at` timestamp. Still visible in analytics                                                                                                                 |
| 23  | CSRF                | Deferred (local network). Document SameSite+token for future                                                                                                       |
| 24  | Password policy     | 16+ characters minimum, bcrypt cost 12                                                                                                                             |
| 25  | Rate limiting       | Login: 5/min. General: 100/min per user                                                                                                                            |
| 26  | Health checks       | `GET /health` on API + PDF Parser. Docker HEALTHCHECK. HA-compatible                                                                                               |
| 27  | DB backup           | pg_dump cron daily 2 AM → NAS shared folder. 30-day retention                                                                                                      |
| 28  | File storage        | NAS shared folder via Docker volume (`UPLOAD_DIR` env var)                                                                                                         |
| 29  | Max upload size     | 50MB                                                                                                                                                               |
| 30  | Bulk categorization | Yes. Multi-select + assign + optional auto-rule                                                                                                                    |
| 31  | Watch folder slug   | Auto-generated from account nickname (lowercase, hyphenated)                                                                                                       |
| 32  | Timezone            | UTC in DB, user's local timezone for display (from `user_settings.timezone`)                                                                                       |
| 33  | Registration        | Admin-only invite. Admin creates members with temp password                                                                                                        |
| 34  | Household budgets   | Both personal + shared (Option C). `user_id` = personal, `household_id` only = shared                                                                              |
| 35  | Archived files      | `{watch-folder}/{account-slug}/.archived/{filename}_{timestamp}`                                                                                                   |
| 36  | Git                 | Initialized in workspace with `.gitignore`                                                                                                                         |
| 37  | Testing             | TDD — tests first for every feature                                                                                                                                |
| 38  | Logging             | Structured JSON via NestJS Logger. `docker logs` for now                                                                                                           |
