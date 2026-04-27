TDD workflow for a MoneyPulse feature slice. Use for any new NestJS module, service, component, or sync domain addition.

**Inputs from the user:** what to build, which phase/module it belongs to.

**The TDD cycle — do not skip steps:**

### Step 1: Define the contract
State in one sentence what the module/service/component does, its inputs, outputs, and side effects (DB writes, queue jobs, sync events).

### Step 2: Write the test file first

**API service test:**
```typescript
// apps/api/src/<module>/__tests__/<module>.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
describe('<Module>Service', () => {
  it('creates entity with correct fields', async () => { ... })
  it('throws on invalid input', async () => { ... })
  it('emits outbox event if sync-eligible', async () => { ... })
})
```

**Sync domain test:**
```typescript
// apps/api/src/sync/__tests__/<service>.spec.ts
describe('SanitizerV2Service', () => {
  it('rejects payload with banned field', () => { ... })
  it('passes clean payload', () => { ... })
})
```

Run: `pnpm test` — confirm tests **fail** (failing, not erroring — means contract is clear).

### Step 3: Implement minimum code
Write only what makes the failing tests pass.

### Step 4: Run full suite
```bash
pnpm test     # Vitest + pytest (if PDF parser changed)
pnpm build    # build passes
```

### Step 5: DB check
If schema changed:
```bash
pnpm db:generate   # produces migration
pnpm db:migrate    # applies (requires Postgres)
```

### Step 6: Rubber-duck check
- Local-first boundary intact?
- PII encrypted if new sensitive column?
- Sync events sanitized for any new data that enters sync domain?
- Shared types updated?
- Spec updated if contracts changed?
