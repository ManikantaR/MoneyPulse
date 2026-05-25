# Claude Code Prompts — MoneyPulse Bug Fixes

Copy-paste these prompts into Claude Code one at a time. Each is self-contained.

---

## Prompt 1: Fix Category Assignment Bug

```
## Context

MoneyPulse is a self-hosted finance app (NestJS API + Next.js UI + PostgreSQL). Read these files first:
- NAS-DEPLOYMENT-SPEC.md (Section 7.1 — Known Issues)
- AGENTS.md (for repo structure and validation commands)
- MONEYPULSE-PLAN.md (first 100 lines for architecture overview)

## Problem

Users cannot assign categories to transactions in the UI. This was noticed after a full data reset and re-import of bank statements on the NAS deployment.

## Investigation Steps

1. **Start with the API endpoint**. Read:
   - apps/api/src/transactions/transactions.controller.ts — find the PATCH endpoint and the bulkCategorize handler (around line 245)
   - apps/api/src/transactions/transactions.service.ts — find bulkCategorize method (around line 362)
   - Check what DTO/schema validation is applied (bulkCategorizeSchema)

2. **Check the frontend**. Read:
   - apps/web/src/app/(protected)/transactions/page.tsx — find the category assignment UI (select rows → categorize flow)
   - apps/web/src/lib/hooks/useTransactions.ts — find the API call for categorization
   - apps/web/src/lib/hooks/useCategories.ts — check if categories are being fetched

3. **Check categories exist in the DB**. We seeded 67 categories (13 parent groups + 54 children) after the data reset. The seed script is at apps/api/src/db/seed.ts. Verify the categories API endpoint returns data:
   - apps/api/src/categories/categories.controller.ts
   - Check if GET /api/categories returns the tree

4. **Check schema alignment**. After the data reset we ran migrations. Verify:
   - The transactions table has a category_id column (or equivalent)
   - The categories table schema matches what the API expects
   - Check apps/api/src/db/schema.ts for the transactions and categories table definitions

5. **Test locally**. Run:
   ```bash
   pnpm test -- transactions
   pnpm test -- categories
   pnpm test -- categorization
   ```

## Deliverables

- Root cause explanation
- Code fix (with tests if the fix touches service logic)
- If the bug is frontend-only, fix the component and verify the API works independently via curl example
- Update NAS-DEPLOYMENT-SPEC.md Section 7.1 to mark the issue as fixed with a one-line explanation
- Append a row to the changelog in Section 11

## Rules

- Do NOT read .env files — they contain secrets
- Do NOT hardcode any real account numbers, IPs with credentials, or PII
- Run pnpm build after changes to verify no TypeScript errors
- Run pnpm test to verify no regressions
```

---

## Prompt 2: Fix Firestore Sync Bug

```
## Context

MoneyPulse is a self-hosted finance app that syncs de-identified data to a Firebase companion web app (one-way: local → Firebase). Read these files first:
- NAS-DEPLOYMENT-SPEC.md (Section 7.2 — Known Issues)
- PHASE9-SYNC-SPEC.md (full sync architecture)
- AGENTS.md (for repo structure)

## Problem

After importing transactions on the NAS, they are NOT syncing to Firestore. The sync pipeline (Phase 9) was implemented but has never been verified working on the NAS deployment. After a full data reset, all Firestore collections (transactions, budgets, syncIngress, aiMetrics) were deleted manually — only categories and users remain in Firestore.

## Architecture (read these files)

The sync pipeline has these components in apps/api/src/sync/:
- outbox.service.ts — writes events to outbox_events table in the same transaction as domain changes
- sanitizer-v2.service.ts — strips PII with strict allowlist/denylist
- alias-mapper.service.ts — rewrites local IDs to deterministic pseudonyms
- signing.service.ts — HMAC signs payloads with nonce + timestamp
- sync-delivery.service.ts — polls outbox, processes and delivers to Firebase
- sync.module.ts — NestJS module wiring

## Investigation Steps

1. **Check if outbox events are being created**. When a transaction is created/updated, the service should write to outbox_events table. Trace the flow:
   - Where does the transaction service call the outbox service? Search for outbox references in:
     - apps/api/src/transactions/transactions.service.ts
     - apps/api/src/jobs/ingestion.processor.ts
   - If outbox.service.ts is never called from the transaction flow, that's the bug — events aren't being produced

2. **Check the delivery worker**. Read sync-delivery.service.ts:
   - Is it polling on a schedule (cron/interval)?
   - Is it registered in sync.module.ts?
   - Does it depend on env vars that might be missing? Check for: ALIAS_SECRET, SYNC_SIGNING_SECRET, FIREBASE_SYNC_ENDPOINT
   - If any of these are empty/undefined, the worker may silently skip

3. **Check the outbox_events table exists**. Look at the migration files:
   ```bash
   find apps/api/db/migrations -name "*outbox*" -o -name "*sync*" | sort
   ```
   If no migration creates the outbox_events table, that's a critical gap.

4. **Check module registration**. Is SyncModule imported into the root AppModule?
   - apps/api/src/app.module.ts — look for SyncModule in imports array

5. **Test the pipeline components**:
   ```bash
   pnpm test -- sync
   pnpm test -- signing
   pnpm test -- policy
   ```

6. **Check the Firebase endpoint**. The companion web app lives at ~/repo/moneypulse-web. The sync ingestion endpoint is a Firebase Cloud Function. Verify:
   - What URL does FIREBASE_SYNC_ENDPOINT expect?
   - Is the Cloud Function deployed?
   - Does it validate the HMAC signature?

## Deliverables

- Root cause explanation (likely one of: outbox events not produced, delivery worker not running, missing migrations, missing env vars, or Firebase endpoint not deployed)
- Code fix with tests
- If the issue is missing migrations, create them
- If the issue is missing env vars, document what's needed (but do NOT include actual values)
- Update NAS-DEPLOYMENT-SPEC.md Section 7.2 to mark the issue as fixed
- Append a row to the changelog in Section 11

## Rules

- Do NOT read .env files — they contain secrets
- Do NOT read docs/FIREBASE-SETUP-SECRETS-HANDOFF.md — it may contain Firebase credentials
- Do NOT hardcode any real secrets, account numbers, or PII
- Run pnpm build after changes
- Run pnpm test to verify no regressions
```

---

## Prompt 3: Set Up Gitleaks Pre-Commit Hook

```
## Context

MoneyPulse is a finance app that handles sensitive data (bank account numbers, transaction data). We need to prevent accidental secret/PII commits. Read NAS-DEPLOYMENT-SPEC.md Section 8 for the current security posture.

## Task

Set up gitleaks as a pre-commit hook to scan for secrets before every commit.

## Steps

1. Create .pre-commit-config.yaml at the repo root:
   ```yaml
   repos:
     - repo: https://github.com/gitleaks/gitleaks
       rev: v8.21.2
       hooks:
         - id: gitleaks
   ```

2. Create .gitleaks.toml at the repo root with rules to:
   - Scan all staged files
   - Allowlist known false positives:
     - Example hex strings in documentation (MONEYPULSE-PLAN.md, LOCAL_DEPLOYMENT.md, NAS-DEPLOYMENT-SPEC.md)
     - Test fixtures with dummy secrets (any file under __tests__/ or *.spec.ts)
     - The openssl command examples in docs (they show the command, not actual output)
   - Add custom rules to detect:
     - Firebase service account JSON patterns
     - PostgreSQL connection strings with passwords
     - 64-char hex strings that look like ENCRYPTION_KEY values

3. Add a GitHub Actions workflow at .github/workflows/secret-scan.yml:
   ```yaml
   name: Secret Scan
   on: [pull_request]
   jobs:
     gitleaks:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with:
             fetch-depth: 0
         - uses: gitleaks/gitleaks-action@v2
           env:
             GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

4. Run gitleaks against the full git history to check for any existing leaks:
   ```bash
   gitleaks detect --source . --verbose
   ```
   If it finds anything, document the findings (do NOT print the actual secret values) and add them to .gitleaksignore if they are false positives, or flag them for rotation if real.

5. Update the repo README.md "Security Notes" section to mention the pre-commit hook.

6. Update NAS-DEPLOYMENT-SPEC.md Section 8 to mark gitleaks as implemented (not just recommended).

## Rules

- Do NOT read .env files
- Do NOT print any actual secret values found by gitleaks — just note the file and line number
- If real secrets are found in git history, note them as "NEEDS ROTATION" without revealing the value
```

---

## Running Order

1. **Prompt 3 first** (gitleaks) — takes 5 minutes, protects you going forward
2. **Prompt 1** (category bug) — likely a simpler fix
3. **Prompt 2** (sync bug) — more complex, depends on Firebase companion setup
