# MoneyPulse — Claude Code Guide

## What This Project Is

Local-first personal finance tracker running on a home NAS (Ugreen) via Docker Compose. NestJS API + Next.js UI + PostgreSQL + Redis + Ollama (local AI). This is the **system of record**. Financial data never leaves the local network unless explicitly synced via the Phase 9 outbox to `../moneypulse-web` (Firebase), and only in de-identified form.

**Privacy is the primary invariant.** All cloud-destined data is sanitized, alias-mapped, and signed before leaving this system.

## Stack

| Layer | Technology |
|---|---|
| API | NestJS 11, REST, Swagger/OpenAPI, Passport JWT |
| ORM | Drizzle ORM 0.45, migrations as code |
| Database | PostgreSQL 16, integer cents, GIN indexes |
| Queue | BullMQ + Redis 7 |
| Frontend | Next.js 16, React 19, App Router, shadcn/ui, Recharts |
| AI | Ollama (llama3.2:3b) — local categorization |
| PDF | Python FastAPI + pdfplumber microservice (:5000) |
| MCP | TypeScript stdio server, 8 query tools |
| Infra | Docker Compose, 7 services |
| Tooling | pnpm 10+, Turborepo, Vitest, pytest, Playwright |

## Repo Layout

| Path | Purpose |
|---|---|
| `apps/api/src/` | NestJS modules — auth, accounts, transactions, ingestion, categorization, analytics, budgets, notifications, sync |
| `apps/api/src/sync/` | Phase 9 sync domain — outbox, alias mapper, sanitizer, signing, delivery |
| `apps/web/src/` | Next.js local UI |
| `packages/shared/` | Shared TS types, Zod schemas, constants |
| `services/pdf-parser/` | Python FastAPI PDF extraction service |
| `db/migrations/` | Drizzle migrations |
| `PHASE*-SPEC.md` | Phase implementation specs |
| `MONEYPULSE-PLAN.md` | Master architecture plan |
| `docs/agentic/` | Rule set, memory, agent guide |
| `.github/agents/` | Copilot agents (mp-lead through mp-tester) |

## Build and Validation

```bash
pnpm install                          # always first
pnpm dev                              # start API + Web (hot reload)
pnpm test                             # all Vitest + pytest tests
pnpm build                            # production build
pnpm test:e2e                         # Playwright e2e
pnpm db:migrate                       # run Drizzle migrations
pnpm db:generate                      # generate migration from schema change

# Infrastructure only (dev)
docker compose up postgres redis -d   # start Postgres + Redis
docker compose --profile ai up -d     # include Ollama
```

Always `pnpm test` then `pnpm build` before marking any slice complete.

## TDD Mandate

**Tests come before implementation.** This is a founding architectural decision (see `MONEYPULSE-PLAN.md`).

1. Write failing tests that describe intended behavior.
2. Write minimum code to make them pass.
3. Refactor with tests green.

For API modules: Vitest unit + integration tests in `apps/api/src/<module>/__tests__/`.
For sync domain: policy tests, no-reverse-route e2e test required per Phase 9 spec.
For frontend: Vitest + Testing Library.
For PDF parser: pytest.

## Privacy and Data Boundary — Non-Negotiable

**Never store in the local DB:**
- Full account numbers (last 4 only, AES-256-GCM encrypted)

**Never send to cloud AI without sanitization:**
- SSN, credit card, email, phone, DOB, account numbers, addresses

**Never send to Firebase without:**
- Sanitizer-v2 policy pass
- Alias mapper rewrite of all local IDs
- HMAC signing via `SigningService`

**Never expose from local API:**
- A reverse-sync write endpoint that Firebase can call
- Raw AI prompt text or output text

## Sync Domain (Phase 9) — Key Files

| File | Role |
|---|---|
| `apps/api/src/sync/outbox.service.ts` | Write events to `outbox_events` table |
| `apps/api/src/sync/sanitizer-v2.service.ts` | Banned-field + pattern PII policy |
| `apps/api/src/sync/alias-mapper.service.ts` | HMAC deterministic alias IDs |
| `apps/api/src/sync/signing.service.ts` | HMAC payload signing for Firebase ingress |
| `apps/api/src/sync/sync-delivery.service.ts` | Delivery worker with retry + DLQ |
| `apps/api/src/sync/sync.types.ts` | SyncPolicyResult, SignedPayload types |

Sync signing must produce headers matching what `../moneypulse-web/functions/src/sync/security.ts` expects: `x-mp-signature`, `x-mp-key-id`, `x-mp-timestamp`, `x-mp-idempotency-key`.

## Security Requirements

- JWT dual-token auth (access 15m + refresh 7d, Redis allowlist)
- AES-256-GCM encryption for PII columns (last_four, original_description, webhook URLs, AI logs)
- Helmet + CSP on API and frontend
- All cookies: httpOnly + secure + sameSite:lax
- Rate limiting: login 5/min, API 100/min per user
- Swagger disabled in production
- CSV export: formula injection protection

## Code Review Standards

Before completing any slice:

1. Local-first boundary preserved — no new cloud leak paths
2. Migration generated and applied if schema changed
3. Shared types in `packages/shared/` updated if contracts changed
4. Tests written and passing (`pnpm test`)
5. Build passing (`pnpm build`)
6. Rubber-duck review completed (use `/rubber-duck` command)
7. Spec file updated if behavior changed

## Phase Roadmap

| Phase | Status |
|---|---|
| 0 — Scaffolding | ✅ Done |
| 1 — Auth and user management | ✅ Done |
| 2 — Bank accounts and CSV/Excel ingestion | ✅ Done |
| 3 — AI categorization (Ollama) | ✅ Done |
| 4 — PDF parser microservice | ✅ Done |
| 5 — Dashboard and visualization | ✅ Done |
| 5.5 — Dashboard drill-down and UX polish | ✅ Done |
| 6 — Budgets, alerts, notifications | ✅ Done |
| 6.5 — Security hardening + AI observability | ✅ Done |
| 7 — MCP server for AI agents | Planned |
| 8 — Investment account tracking | Planned |
| 9 — Sync domain (outbox → Firebase) | ✅ Implemented, needs e2e validation |

## Agent Workflow (Copilot in VS Code)

For GitHub Copilot: start with `mp-lead` agent, then route to specialists.
For Claude Code (this session): use `/phase-orchestrate`, `/implement-slice`, `/rubber-duck`, `/review-work` commands.

## Companion Repo

Firebase web app: `../moneypulse-web`
Firebase ingestion endpoint: get URL from Firebase Console → Build → Functions → ingestSyncEvent
Sync ingress verification: `../moneypulse-web/functions/src/sync/security.ts`

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | DB password |
| `JWT_SECRET` | Yes | JWT signing (openssl rand -hex 64) |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM (openssl rand -hex 32) |
| `REDIS_PASSWORD` | Yes | Redis auth |
| `ALIAS_SECRET` | Yes | HMAC alias mapping (openssl rand -hex 32) |
| `SYNC_SIGNING_SECRET` | Yes | Outbound sync HMAC signing |
| `FIREBASE_SYNC_ENDPOINT` | Yes | Firebase ingestSyncEvent endpoint URL |
| `OLLAMA_URL` | No | Default: http://ollama:11434 |
