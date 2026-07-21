# MoneyPulse Agent Guide

This repository is the local-first MoneyPulse application: NestJS API, Next.js web UI, shared TypeScript package, Python PDF parser, PostgreSQL, Redis, and MCP tooling. It is the system of record for household finance data and the upstream source for MoneyPulse Web sync.

## Working Rules

- Start from `specs/MONEYPULSE-PLAN.md` and the relevant `specs/PHASE*-SPEC.md` file before implementing or restructuring code.
- Preserve local-first privacy guarantees. Cloud sync, AI categorization, exports, and integrations must never weaken the primary local data boundary.
- Prefer vertical slices with explicit file inventories, validation commands, and acceptance criteria.
- Keep backend, frontend, shared package, and PDF parser changes coordinated in specs when a feature crosses boundaries.
- Any change to `apps/api/src/sync/` payload shapes must update the shared sync-contract schema and the matching golden fixture in the same PR.
- The shared sync-contract schemas (`packages/shared/src/sync-contracts/`) need a version-pinned mirror in the separate moneypulse-web repo (cross-repo import is impractical there) — as of 2026-07-21 that mirror does not exist yet (tracked follow-up: add `functions/src/sync-contracts.ts` there as a verbatim copy, pinned to a source commit, and wire it into ingest). Once it exists, any schema change here must also be ported to that snapshot in the same change window.
- Use the rubber-duck loop in `docs/agentic/rule-set.md` for every plan, spec, bug fix, and implementation.

## Key Paths

- `apps/api` — NestJS 11 API and business logic
- `apps/web` — Next.js 16 local web UI
- `packages/shared` — shared constants, types, and validation
- `services/pdf-parser` — Python PDF extraction service
- `db` — migrations, seeds, scripts
- `.github/copilot-instructions.md` — repo-wide Copilot guidance
- `.github/instructions` — path-specific instructions
- `.github/agents` — custom agents for VS Code and Copilot CLI
- `.github/prompts` — reusable prompts
- `.github/skills` — portable Agent Skills

## Validation Defaults

- Install: `pnpm install`
- Build: `pnpm build`
- Test: `pnpm test`
- E2E: `pnpm test:e2e`
- API migrations: `pnpm db:migrate`

Local runtime notes belong in docs and specs, not only in chat. When a workflow depends on Podman, local Postgres/Redis, or PDF parser setup, document the exact commands.
