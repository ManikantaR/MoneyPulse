Route a MoneyPulse (local) task through the correct phase and specialist path.

You are orchestrating delivery for **MoneyPulse** — the local-first NestJS + Next.js + PostgreSQL app in this repo.

**Inputs from the user:** phase number or area, goal/task description, constraints.

**Steps:**

1. Read `PHASE<N>-SPEC.md` for the target phase. State its current status.
2. Check `MONEYPULSE-PLAN.md` for the relevant architectural decision (38 decisions documented there).
3. Classify the work: API, web UI, shared package, DB migration, PDF parser, sync domain, or cross-cutting.
4. Identify impacted files across all layers: API module, shared types, DB schema, web components, tests.
5. State the smallest validated slice and the validation command.
6. Check if a DB migration is needed — if so, name the migration file and state `pnpm db:generate` step.
7. Run the rubber-duck checkpoint before implementation:
   - What is the exact problem?
   - What is the smallest change across all layers?
   - What local-first invariant must stay true?
   - What test proves success?
   - What breaks next?
8. State whether Docker services are required locally (Postgres, Redis, Ollama).

**Hard constraints:**
- TDD: tests first, then implementation.
- No full account numbers in any DB column.
- Sync events must pass sanitizer-v2 before delivery.
- No reverse-sync endpoint introduced.
- All PII columns must use AES-256-GCM encryption.
