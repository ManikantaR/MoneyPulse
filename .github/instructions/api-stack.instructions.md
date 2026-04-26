---
applyTo: "apps/api/**/*.ts,packages/shared/**/*.ts,db/**/*.ts"
---

- Preserve clear module boundaries in NestJS. Add new behavior to the owning domain module instead of creating cross-cutting shortcuts.
- Keep schema, validation, DTOs, service logic, and tests aligned in the same change.
- Prefer explicit Zod and Drizzle updates over implicit runtime assumptions.
- When changing auth, ingestion, categorization, analytics, budgets, jobs, or notifications, update the relevant phase spec or implementation notes.
- Queue behavior, idempotency, rate limits, and audit logging must be explicit for any background or external-input feature.