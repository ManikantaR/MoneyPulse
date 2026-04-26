# Project Overview

MoneyPulse is a privacy-first, self-hosted personal finance application. It runs locally with a NestJS API, Next.js web frontend, PostgreSQL, Redis, a Python PDF parser, and optional local AI categorization via Ollama. This repository is the source of truth for household finance data and the upstream publisher for MoneyPulse Web sync.

## Architecture

- `apps/api` is the main business logic surface. It owns auth, ingestion, accounts, transactions, categories, analytics, budgets, notifications, audit, and jobs.
- `apps/web` is the local UI surface for dashboards, imports, settings, and management flows.
- `packages/shared` contains shared types, constants, and Zod validation used across API and web.
- `services/pdf-parser` is a Python service for PDF extraction.
- `db` contains migrations, seeds, and related scripts.

## Build And Validation

- Use Node 22 and pnpm 10.32.1.
- Always run `pnpm install` before `pnpm build`, `pnpm test`, or `pnpm test:e2e`.
- Repo-level scripts are defined in `package.json` and fan out through Turbo.
- CI runs build, unit tests, e2e tests, Docker builds, and PDF parser tests.
- The PDF parser uses Python 3.12 in CI.

## Known Runtime Facts

- Podman is the local container runtime in this environment, even if some docs still mention Docker.
- The API may need `rm tsconfig.tsbuildinfo` if stale incremental artifacts block emission.
- The shared package uses ESM and `NodeNext`; the API uses CommonJS.
- Zod v4 imports use `zod/v4`.

## Editing Expectations

- For cross-cutting features, update the relevant phase spec along with code.
- For backend features, document schema changes, queue behavior, auth impact, and validation.
- For frontend features, keep the UI information-dense and task-oriented.
- For Python parser work, keep tests and parser heuristics explicit.
- For docs, prefer decisions tables, file inventories, dependency commands, validation commands, and acceptance criteria over broad prose.

## Search Guidance

- Start from `MONEYPULSE-PLAN.md` and the relevant `PHASE*-SPEC.md` file.
- For DB and validation work, inspect `apps/api/src/db`, `packages/shared/src`, and `db/migrations`.
- For PDF work, inspect `services/pdf-parser/src` and its tests.

## Required Review Discipline

- Every plan, spec, implementation, and fix must pass a rubber-duck review against `docs/agentic/rule-set.md`.
- When documentation contains validated commands and repo facts, trust it before broad searching.