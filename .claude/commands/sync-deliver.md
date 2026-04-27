Test and validate the sync delivery pipeline from MoneyPulse outbox to Firebase ingestSyncEvent.

This is the Phase 9 sync domain end-to-end validation.

**Prerequisites:**
- Local MoneyPulse API running (`pnpm dev` or Docker Compose)
- Postgres running with outbox_events table migrated
- `.env` has: `SYNC_SIGNING_SECRET`, `ALIAS_SECRET`, `SYNC_FIREBASE_INGESTION_URL`, `SYNC_SIGNING_KEY_ID`

**Step 1 — Confirm Firebase endpoint**

The `SYNC_FIREBASE_INGESTION_URL` in `.env` must be:
```
https://ingestsyncevent-[hash]-ue.a.run.app
```
Find it: Firebase Console → Build → Functions → ingestSyncEvent → Trigger URL.

**Step 2 — Run policy tests**
```bash
pnpm --filter=@moneypulse/api test -- --testPathPattern=sync
```
All sanitizer-v2 and policy tests must pass before attempting delivery.

**Step 3 — Create a test outbox event**

Write a minimal integration test or use the NestJS REPL:
```bash
pnpm --filter=@moneypulse/api repl
# In REPL: trigger OutboxService.createEvent(...) with a sanitized transaction payload
```

Or write a test in `apps/api/src/sync/__tests__/sync-delivery.integration.spec.ts`.

**Step 4 — Trigger delivery worker**

The delivery worker polls `outbox_events` where status = 'pending'. Either:
- Let BullMQ trigger it automatically
- Or call the delivery service directly in a test

**Step 5 — Verify Firestore**

Firebase Console → Firestore → `syncIngressEvents` → confirm document:
- `status: 'accepted'`
- `payloadHash` matches computed hash
- No banned fields present (`email`, `accountNumber`, `lastFour`, etc.)

**Step 6 — Idempotency check**

Re-send same event (same `idempotencyKey`). Response must be `{ ok: true, duplicate: true }`.

**Step 7 — Audit log check**

`sync_audit_logs` table must have a row for the delivery with `policy_passed: true`.

**Pass criteria:** event delivered, stored, sanitized, idempotent, audited.
