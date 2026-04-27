Review a MoneyPulse spec, plan, or implementation for correctness, security, and completeness.

**Inputs from the user:** target (spec file, files changed, or change summary), focus area (bugs, security, tests, architecture, or all).

**Review checklist — present findings ordered by severity:**

**Privacy and data boundary (always check):**
- [ ] No full account numbers stored anywhere
- [ ] PII columns use AES-256-GCM encryption
- [ ] New sync events pass sanitizer-v2 before delivery
- [ ] No reverse-sync endpoint introduced
- [ ] Cloud AI opt-in is OFF by default if new AI call added
- [ ] Audit log entry created for new security events

**Tests:**
- [ ] Tests written before implementation (TDD)
- [ ] All edge cases covered per spec acceptance criteria
- [ ] `pnpm test` passes (Vitest + pytest if PDF parser changed)
- [ ] `pnpm build` passes

**DB and schema:**
- [ ] Migration generated if schema changed (`pnpm db:generate`)
- [ ] Shared types in `packages/shared/` updated if contracts changed
- [ ] Integer cents used for all monetary amounts (never float)
- [ ] Soft delete pattern (`deleted_at`) preserved on new entities

**Architecture:**
- [ ] NestJS module structure preserved (controller → service → repository)
- [ ] BullMQ jobs used for async work (no synchronous long operations in request cycle)
- [ ] Drizzle schema matches migration

**Sync domain (if touched):**
- [ ] Banned-field policy test covers new fields
- [ ] No-reverse-route e2e test passes
- [ ] Alias mapper produces stable IDs for the same input

After findings, state: what must be fixed before merge, what is advisory.
