# MoneyPulse (MyMoney) — Spec Index

> All phase specs and plans for the local NAS-hosted MoneyPulse app.
> Companion web app specs live in `../moneypulse-web/specs/`.

## Master Plan

| Document | Description |
|----------|-------------|
| [MONEYPULSE-PLAN.md](MONEYPULSE-PLAN.md) | Full architecture plan — 38 decisions, stack, data model, all phases |
| [NAS-DEPLOYMENT-SPEC.md](NAS-DEPLOYMENT-SPEC.md) | UGREEN DXP4800+ deployment: Docker Compose, networking, UGOS quirks |

## Phase Specs

| Phase | Status | Summary | Spec | Web App Impact |
|-------|--------|---------|------|----------------|
| 0 | Done | Project scaffolding, monorepo, Docker Compose, CI | (in MONEYPULSE-PLAN.md) | None |
| 1 | Done | Auth: JWT dual tokens, Redis sessions, admin invite, password change | [PHASE1-SPEC.md](PHASE1-SPEC.md) | None |
| 2 | Done | Bank accounts, CSV/Excel ingestion, BullMQ pipeline, dedup | [PHASE2-SPEC.md](PHASE2-SPEC.md) | None |
| 3 | Done | AI categorization: Ollama, seed rules, PII sanitizer, learning loop | [PHASE3-SPEC.md](PHASE3-SPEC.md) | None |
| 4 | Done | PDF parser: Python/pdfplumber microservice, BofA + AI fallback | [PHASE4-SPEC.md](PHASE4-SPEC.md) | None |
| 5 | Done | Dashboard: Recharts, analytics endpoints, sidebar nav, CSV export | [PHASE5-SPEC.md](PHASE5-SPEC.md) | None |
| 5.5 | Done | Dashboard drill-down, URL-driven filters, imports page | (in README) | None |
| 6 | Done | Budgets, alerts, HA webhooks, email digests, savings goals | [PHASE6-SPEC.md](PHASE6-SPEC.md) | None |
| 6.5 | Done | Security hardening: AES-256-GCM encryption, CSP, AI observability | (in README) | None |
| 7 | Planned | MCP server: stdio + SSE, 8 query tools, read-only PostgreSQL | [PHASE7-SPEC.md](PHASE7-SPEC.md) | None |
| 8 | Planned | Investment tracking: manual snapshots, 4 platform parsers, net worth | [PHASE8-SPEC.md](PHASE8-SPEC.md) | None |
| 9 | Done | Firebase sync: outbox, alias mapper, HMAC signing, delivery worker | [PHASE9-SYNC-SPEC.md](PHASE9-SYNC-SPEC.md) | **Primary** — feeds moneypulse-web |
| 10 | In Progress | Feature enhancements: receipt OCR, recurring bills, anomaly alerts | [PHASE10-FEATURES-SPEC.md](PHASE10-FEATURES-SPEC.md) | Partial — some features sync to web |

## Notes

- Phases 1-6 are purely local NAS app features.
- Phase 9 is the bridge — it builds the sync pipeline that powers the moneypulse-web companion.
- Phase 10 spans both repos (local processing + web projections).
- Phase 7 and 8 specs are written but not yet implemented.
