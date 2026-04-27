Implement the smallest validated slice for MoneyPulse using TDD.

**Inputs from the user:** phase, slice description, validation command.

**Steps:**

1. Read the owning `PHASE<N>-SPEC.md`. Confirm the slice is in scope.
2. Read the directly impacted files before touching anything.
3. If a DB schema change is needed: update `packages/shared/` schema first, then generate migration:
   ```bash
   pnpm db:generate   # produces a migration file in db/migrations/
   pnpm db:migrate    # applies it (requires Postgres running)
   ```
4. If shared types change: update `packages/shared/` before API or UI code.
5. **Write the test first.**
   - API: `apps/api/src/<module>/__tests__/<module>.spec.ts`
   - Web: `apps/web/src/__tests__/<component>.test.tsx`
   - Sync: `apps/api/src/sync/__tests__/<service>.spec.ts`
   - Run test — confirm it **fails** for the right reason.
6. Implement minimum code to pass the test.
7. Run `pnpm test` — all tests must pass.
8. Run `pnpm build` — build must succeed.
9. Rubber-duck review:
   - Local-first boundary intact?
   - Migration generated if schema changed?
   - Shared types updated?
   - Sync events sanitized if new data enters the sync domain?

**For sync domain slices:** always run the policy tests after any sanitizer or alias mapper change:
```bash
pnpm --filter=@moneypulse/api test -- --testPathPattern=sync
```

**Do not skip the test-first step.**
