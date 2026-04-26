# MoneyPulse Agent Guide

This repository is the local-first MoneyPulse application: NestJS API, Next.js web UI, shared TypeScript package, Python PDF parser, PostgreSQL, Redis, and MCP tooling. It is the system of record for household finance data and the upstream source for MoneyPulse Web sync.

## Working Rules

- Start from `MONEYPULSE-PLAN.md` and the relevant `PHASE*-SPEC.md` file before implementing or restructuring code.
- Preserve local-first privacy guarantees. Cloud sync, AI categorization, exports, and integrations must never weaken the primary local data boundary.
- Prefer vertical slices with explicit file inventories, validation commands, and acceptance criteria.
- Keep backend, frontend, shared package, and PDF parser changes coordinated in specs when a feature crosses boundaries.
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