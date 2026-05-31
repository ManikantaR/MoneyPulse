# MoneyPulse — Implementation Prompts & Execution Guide

> **Purpose**: Crystal-clear prompts for GitHub Copilot (or any AI model) to implement Phase 10 features.
> **How to use**: Copy each prompt into GitHub Copilot Chat in VS Code (with the workspace open). After each feature, follow the deployment steps.
> **Constraint**: Never read or write secrets to .env files or code — both repos are public.

---

## Execution Order

| # | Feature | Prompt | Deploy Steps | Status |
|---|---------|--------|--------------|--------|
| 1 | Merchant Aliases UI | [Prompt 1](#prompt-1--merchant-aliases-management-page) | Deploy + seed | ✅ done |
| 2 | Receipt/Bill Attachment | [Prompt 2](#prompt-2--receiptbill-attachment-on-transactions) | Deploy + SQL migration | ✅ done |
| 3 | Recurring Bill Detection | [Prompt 3](#prompt-3--recurring-bill-detection--missed-payment-alerts) | Deploy + SQL migration | ✅ done |
| 4 | Spending Anomaly Alerts | [Prompt 4](#prompt-4--spending-anomaly-alerts) | Deploy only | ✅ done |
| 5 | Budget vs Actual Dashboard | [Prompt 5](#prompt-5--budget-vs-actual-variance-dashboard) | Deploy only | ✅ done |
| **6** | **Notification Push Backbone (6a NAS + 6b Web)** | [Prompt 6](#prompt-6--notification-push-backbone-nas-emit--web-fcm-send--ha-lan-fix) | NAS deploy + web `firebase deploy` | prerequisite for alerts |
| **7** | **Remote Mac-Ollama Resilience + Retry Queue** | [Prompt 7](#prompt-7--remote-mac-ollama-resilience--retry-queue) | Config + deploy | prerequisite for AI |
| 8 | Receipt Watch Folder + OCR Auto-Match | [Prompt 8](#prompt-8--receipt-watch-folder--ollama-vision-ocr-auto-match) | Deploy + SQL migration | Tier 2 |
| 9 | Natural Language Finance Chat | [Prompt 9](#prompt-9--natural-language-finance-chat) | Deploy only | Tier 2 |
| 10 | Cash Flow Forecasting | [Prompt 10](#prompt-10--cash-flow-forecasting) | Deploy only | Tier 2 |
| 11 | Account Balance Snapshots (F.2) | [Prompt 11](#prompt-11--account-balance-history-snapshots-f2) | Deploy + SQL migration | foundational |
| 12 | Import Deduplication Improvement (F.3) | [Prompt 12](#prompt-12--import-deduplication-improvement-f3) | Deploy + SQL migration | foundational |
| 13 | Weekly/Monthly Digest | [Prompt 13](#prompt-13--weeklymonthly-financial-digest) | Deploy only | Tier 3 |
| 14 | Year-over-Year Comparison | [Prompt 14](#prompt-14--year-over-year-comparison) | Deploy only | Tier 3 |
| 15 | Home Assistant Dashboard Sensor | [Prompt 15](#prompt-15--home-assistant-dashboard-sensor) | Deploy only | Tier 3 |
| 16 | Tax-Ready Export | [Prompt 16](#prompt-16--tax-ready-export) | Deploy + SQL migration | Tier 3 |
| 17 | Subscription Manager | [Prompt 17](#prompt-17--subscription-manager) | Deploy only | Tier 3 |
| 18 | PWA Mode + Camera Capture | [Prompt 18](#prompt-18--pwa-mode--camera-capture) | Deploy only | Tier 3 |
| 19 | Quick-Add Transaction Widget | [Prompt 19](#prompt-19--quick-add-transaction-widget) | Deploy only | Tier 3 |
| 20 | Spending Streaks & Gamification | [Prompt 20](#prompt-20--spending-streaks--gamification) | Deploy only | Tier 3 |
| **21** | **moneypulse-web PWA (installable + iOS push)** | [Prompt 21](#prompt-21--moneypulse-web-pwa-installable--ios-background-push) | web `firebase deploy` | web only — pairs with 6 |
| 22 | Web Bills Glance (`bill.projected.v1`) — OPTIONAL | [Prompt 22](#prompt-22--web-bills-glance-billprojectedv1--optional) | NAS deploy + web `firebase deploy` | optional — 22a NAS + 22b Web |
| 23 | Send Test Notification (Settings button) | [Prompt 23](#prompt-23--send-test-notification-settings-button) | NAS deploy | dev/test helper — NAS only |
| 24 | Fix: exclude transfers in web KPIs (`isTransfer` projection) | [Prompt 24](#prompt-24--fix-web-kpis-exclude-transfers-istransfer-projection) | NAS deploy + web deploy + re-sync | bug fix — 24a NAS + 24b Web |

> **Architecture rules (from PHASE10 spec §F.4/§F.5) every prompt below obeys:**
> - **Web is essentials + push, not parity.** Each prompt states a **Sync verdict**: `web: none` (NAS-only), `web: field-only` (rides an existing projection), or `web: summary+push` (gets a projected summary + FCM). Do not port NAS management UIs to moneypulse-web.
> - **AI is best-effort.** Rule engine runs on NAS; Ollama (on the dev Mac) enrichment queues + retries when unreachable. OCR/bill-parse results must go through the retry queue, never silently dropped.
> - **NAS is LAN-only today.** No prompt assumes off-home reachability of the NAS.
>
> **Cross-repo convention (IMPORTANT):** Copilot can only edit files in its open workspace. From `~/repo/MyMoney` it CANNOT touch `~/repo/moneypulse-web`. So any feature that spans both repos is split into separately-copy-pasteable blocks:
> - **`Prompt Na`** — paste into Copilot with `~/repo/MyMoney` open (NAS / NestJS).
> - **`Prompt Nb`** — paste into Copilot with `~/repo/moneypulse-web` open (Firebase functions + Next.js web). That repo has its OWN Copilot agents (`mw-lead`…), specs, and TDD/data-boundary rules — the `b` block respects them.
>
> Run `a`, deploy the NAS, then run `b`, deploy the web. End-to-end tests that cross the boundary need both deployed. *(Alternative: open both repos as folders in one VS Code multi-root workspace and a single Copilot session can edit both — but the per-repo blocks above still apply.)*
>
> **Good news:** the web companion is already a mature Phase 0–6 app (notifications, transactions, budgets, categories, FCM token registration, messaging service worker all exist). Most prompts are **NAS-only** — they just emit correctly-shaped outbox events into the pipeline the web already consumes. Only Prompt 6 and Prompt 21 have a `b` (web) block.

---

## Prompt 1 — Merchant Aliases Management Page

### Prompt (copy this into Copilot Chat)

```
I need a new "Merchants" page in the MoneyPulse web app to manage merchant name aliases. Follow the existing codebase patterns exactly.

## What this feature does

The app has a `merchant_aliases` table (already exists in `apps/api/src/db/schema.ts`) with columns: id (uuid), user_id (uuid FK nullable), pattern (varchar), match_type (varchar: 'contains'|'startsWith'|'exact'|'regex'), display_name (varchar), created_at (timestamp).

Users need a page to:
1. View all merchant aliases (both global where user_id IS NULL, and user-created)
2. Add new aliases (pattern + match type + display name)
3. Edit existing aliases
4. Delete user-created aliases (cannot delete global/seeded aliases)
5. After adding/editing an alias, option to re-normalize all transactions

## Files to create/modify

### 1. API Controller: `apps/api/src/categorization/merchant-alias.controller.ts` (NEW)

Create a NestJS controller following the exact same patterns as `apps/api/src/accounts/accounts.controller.ts`:

```typescript
@ApiTags('Merchant Aliases')
@Controller('merchant-aliases')
@UseGuards(JwtAuthGuard)
```

Endpoints:
- `GET /merchant-aliases` — list all aliases for the current user + global aliases (userId IS NULL). Use `@CurrentUser()` decorator. Return `{ data: MerchantAlias[] }`.
- `POST /merchant-aliases` — create a new alias. Body: `{ pattern: string, matchType: 'contains'|'startsWith'|'exact'|'regex', displayName: string }`. Set `userId` from `@CurrentUser().sub`. Validate with Zod. Return `{ data: MerchantAlias }`.
- `PATCH /merchant-aliases/:id` — update an alias. Only allow if the alias belongs to the current user (userId matches). Body: partial of create body. Return `{ data: MerchantAlias }`.
- `DELETE /merchant-aliases/:id` — delete an alias. Only allow if userId matches current user (never delete global aliases where userId IS NULL). Return `{ data: { deleted: true } }`.

Import `ZodValidationPipe` from `../common/pipes/zod-validation.pipe`. Import `JwtAuthGuard` from `../common/guards/jwt-auth.guard`. Import `CurrentUser` from `../common/decorators/current-user.decorator`. Import `z` from `zod/v4`.

### 2. Register in module: modify `apps/api/src/categorization/categorization.module.ts`

Add the new controller to the `controllers` array in the @Module decorator. You'll need to add `controllers: [MerchantAliasController]` to the module (it currently has none — only providers and exports).

### 3. Frontend hook: `apps/web/src/lib/hooks/useMerchantAliases.ts` (NEW)

Follow the exact pattern of `apps/web/src/lib/hooks/useAccounts.ts`:

```typescript
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
```

Hooks to create:
- `useMerchantAliases()` — `useQuery` fetching `GET /merchant-aliases`, queryKey: `['merchant-aliases']`
- `useCreateMerchantAlias()` — `useMutation` posting to `/merchant-aliases`, invalidates `['merchant-aliases']`
- `useUpdateMerchantAlias()` — `useMutation` patching `/merchant-aliases/:id`, invalidates `['merchant-aliases']`
- `useDeleteMerchantAlias()` — `useMutation` deleting `/merchant-aliases/:id`, invalidates `['merchant-aliases']`

### 4. Frontend page: `apps/web/src/app/(protected)/merchants/page.tsx` (NEW)

Follow the layout pattern of `apps/web/src/app/(protected)/categories/page.tsx` or `apps/web/src/app/(protected)/accounts/page.tsx`.

Page structure:
- Header: "Merchant Aliases" title + "Add Alias" button (top right, same style as accounts page "Add Account" button)
- Table listing all aliases with columns: Pattern, Match Type (badge), Display Name, Source (badge: "Global" for userId=null, "Custom" for user-created), Actions (edit/delete buttons)
- Global aliases should show a lock icon and not have delete button
- Inline edit form or modal when clicking edit
- Add form (modal or collapsible form like the accounts page "New Account" form):
  - Pattern input (text, required)
  - Match Type select: contains, startsWith, exact, regex
  - Display Name input (text, required)
  - Submit button
- After successful create/edit, show a prompt: "Re-normalize all transactions? This will apply the new alias." with Yes/No buttons. If Yes, call `POST /transactions/normalize-merchants` with `{ force: true }`.

Use these CSS patterns from the existing app:
- Card/surface: `bg-[var(--card)]`, `bg-[var(--surface-container-low)]`
- Border: `border border-[var(--border)]`
- Rounded: `rounded-2xl` for cards, `rounded-xl` for inputs
- Text colors: `text-[var(--muted-foreground)]` for secondary text
- Primary button: `bg-[var(--primary)] text-[var(--primary-foreground)]`
- Add `'use client';` at the top of the file

### 5. Add to sidebar: modify `apps/web/src/components/Sidebar.tsx`

Add a new entry to the `navItems` array after the "Categories" entry:
```typescript
{ href: '/merchants', label: 'Merchants', icon: Store },
```
Import `Store` from `lucide-react` (add it to the existing import statement at the top).

## Important patterns to follow
- All API responses wrap data in `{ data: ... }`
- All pages use `'use client';` directive
- Use `cn()` from `@/lib/utils` for conditional classNames
- Use lucide-react icons only
- Use `formatCents` from `@/lib/format` for money formatting where needed
- Do NOT use shadcn/ui components — this app uses custom-styled native elements
- Do NOT read .env files or include secrets

## After implementation — verification steps (MANDATORY)

Complete ALL of these steps before considering this feature done:

### Step 1: Build
Run `pnpm build` from the repo root. Fix ALL TypeScript errors. Do not skip this.

### Step 2: Tests
Write at least one test per new service method. Test files go in `__tests__/` directories adjacent to the source file. Follow existing test patterns — see `apps/api/src/transactions/__tests__/transactions.service.spec.ts` as a reference. Run `pnpm test` and ensure all tests pass.

### Step 3: Rubber duck code review
Review your own work for:
- Missing input validation (all endpoints must use ZodValidationPipe)
- Missing ownership checks (never return/modify another user's data)
- SQL injection risks (always use parameterized queries via Drizzle `sql` template)
- Missing error handling (what if DB insert fails? what if file not found?)
- Missing imports or module registrations
- Consistency with existing patterns (response format, naming conventions)
List any issues found and fix them.

### Step 4: Deploy to NAS
Run these commands:
```bash
cd ~/repo/MyMoney
./deploy-to-nas.sh
```

### Step 5: Post-deploy SQL and setup
```bash
ssh nas
docker exec -i moneypulse-api node dist/db/seed.js
```

### Step 6: Manual test checklist
- [ ] Navigate to /merchants in the sidebar
- [ ] See seeded global aliases listed
- [ ] Add a custom alias (e.g., pattern: "costar", displayName: "CoStar Group")
- [ ] Click re-normalize → verify Top Merchants on dashboard uses clean names
- [ ] Verify global aliases cannot be deleted (only user-created ones)
```

---

## Prompt 2 — Receipt/Bill Attachment on Transactions

### Prompt (copy this into Copilot Chat)

```
I need to add receipt and bill attachment functionality to transactions in MoneyPulse. Users should be able to upload PDF/image files and attach them to transactions.

## Schema

### New table: `transaction_attachments`

Add to `apps/api/src/db/schema.ts` after the `transactions` table definition:

```typescript
export const transactionAttachments = pgTable('transaction_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  filename: varchar('filename', { length: 255 }).notNull(),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### Update shared types: `packages/shared/src/types/index.ts`

Add after the Transaction interface:

```typescript
export interface TransactionAttachment {
  id: string;
  transactionId: string;
  userId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}
```

## API: `apps/api/src/transactions/attachment.controller.ts` (NEW)

Create a new NestJS controller:

```typescript
@ApiTags('Attachments')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
```

Use `@nestjs/platform-express` for file upload with `FileInterceptor`:

```typescript
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
```

Storage config — save files to `/config/attachments/{userId}/{transactionId}/`:
```typescript
const storage = diskStorage({
  destination: (req, file, cb) => {
    const userId = (req as any).user.sub;
    const txnId = req.params.transactionId;
    const dir = join('/config/attachments', userId, txnId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});
```

Endpoints:

1. `POST /transactions/:transactionId/attachments` — upload file
   - Use `@UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter }))` 
   - `fileFilter`: allow only PDF, PNG, JPG, JPEG, WEBP, HEIC
   - Verify the transaction belongs to the current user before accepting
   - Insert into `transactionAttachments` table
   - Return `{ data: TransactionAttachment }`

2. `GET /transactions/:transactionId/attachments` — list attachments
   - Verify transaction ownership
   - Return `{ data: TransactionAttachment[] }`

3. `GET /attachments/:id/download` — serve file
   - Verify ownership (join through transactionAttachments → transactions → userId)
   - Use `@Res()` with `res.sendFile(attachment.storagePath)`

4. `DELETE /attachments/:id` — remove attachment
   - Verify ownership
   - Delete file from disk (`unlinkSync`)
   - Delete DB row
   - Return `{ data: { deleted: true } }`

Register this controller in `apps/api/src/transactions/transactions.module.ts` — add it to the `controllers` array.

## Frontend

### Hook: `apps/web/src/lib/hooks/useAttachments.ts` (NEW)

```typescript
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useAttachments(transactionId: string | undefined) {
  return useQuery({
    queryKey: ['attachments', transactionId],
    queryFn: () => api.get(`/transactions/${transactionId}/attachments`),
    enabled: !!transactionId,
  });
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ transactionId, file }: { transactionId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${baseUrl}/transactions/${transactionId}/attachments`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['attachments', vars.transactionId] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
```

### Transaction row attachment indicator

Modify `apps/web/src/app/(protected)/transactions/page.tsx`:

1. In the transaction table, add a paperclip icon (from lucide-react: `Paperclip`) next to the description when the transaction has attachments. You'll need to include an attachment count in the transaction query response.

2. Add a click handler on each transaction row that opens a slide-over panel showing:
   - Transaction details (date, amount, description, category)
   - List of attached files with download links and delete buttons
   - Upload button: `<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic">` — on file select, call `useUploadAttachment`
   - Mobile-friendly: `<input type="file" accept="image/*" capture="environment">` for camera capture

For the slide-over panel, create a new component `apps/web/src/components/TransactionDetailPanel.tsx`:
- Fixed right panel (similar to the `NetWorthDrilldown` component pattern in `apps/web/src/components/NetWorthDrilldown.tsx`)
- Show transaction info at top
- Attachments list below with thumbnails for images, PDF icon for PDFs
- Upload area at bottom
- Close button (X) at top right

## Important
- Files are stored on the NAS filesystem at `/config/attachments/` — NOT in the database
- The Docker container needs this path volume-mounted (it's under `/config/` which is already mounted)
- Do NOT store file contents in the database — only metadata
- Do NOT sync actual files to Firebase — only metadata via the outbox
- Do NOT read .env files or include secrets

## After implementation — verification steps (MANDATORY)

Complete ALL of these steps before considering this feature done:

### Step 1: Build
Run `pnpm build` from the repo root. Fix ALL TypeScript errors. Do not skip this.

### Step 2: Tests
Write tests for the attachment controller/service:
- Test upload with valid file type (PNG/PDF) returns attachment metadata
- Test upload with invalid file type (e.g., .exe) is rejected
- Test listing attachments for a transaction returns correct data
- Test delete removes both the DB record and the file
- Test ownership: cannot access another user's attachments
Test files go in `__tests__/` directories adjacent to source. Run `pnpm test` and ensure all pass.

### Step 3: Rubber duck code review
Review your own work for:
- Missing input validation (all endpoints must use ZodValidationPipe where applicable)
- Missing ownership checks (never return/modify another user's attachments)
- File system error handling (disk full, permission denied, file not found)
- Multer configuration correctness (file size limits, type filtering)
- Missing imports or module registrations
List any issues found and fix them.

### Step 4: Deploy to NAS
```bash
cd ~/repo/MyMoney
./deploy-to-nas.sh
```

### Step 5: Post-deploy SQL and setup
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  CREATE TABLE IF NOT EXISTS transaction_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_attachment_txn ON transaction_attachments(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_attachment_user ON transaction_attachments(user_id);
"
docker exec -i moneypulse-api mkdir -p /config/attachments
```

### Step 6: Manual test checklist
- [ ] Go to Transactions page → click a transaction row → detail panel opens
- [ ] Upload a receipt image (PNG/JPG) → appears in attachments list with thumbnail
- [ ] Upload a PDF bill → appears with PDF icon
- [ ] Click download → file downloads correctly
- [ ] Delete an attachment → removed from list and disk
- [ ] Try uploading a file > 10MB → should be rejected
- [ ] On mobile: camera capture button opens device camera
```

---

## Prompt 3 — Recurring Bill Detection + Missed Payment Alerts

### Prompt (copy this into Copilot Chat)

```
I need to add recurring bill detection and missed payment alerts to MoneyPulse. The system should auto-detect recurring charges from transaction history and alert when expected bills haven't appeared.

## Schema

### New table: `recurring_bills`

Add to `apps/api/src/db/schema.ts`:

```typescript
export const recurringBills = pgTable('recurring_bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  merchantPattern: varchar('merchant_pattern', { length: 200 }).notNull(),
  normalizedName: varchar('normalized_name', { length: 200 }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  expectedAmountCents: integer('expected_amount_cents').notNull(),
  amountTolerancePercent: integer('amount_tolerance_percent').notNull().default(15),
  frequency: varchar('frequency', { length: 20 }).notNull().default('monthly'),
  nextExpectedDate: timestamp('next_expected_date', { withTimezone: true }),
  lastSeenDate: timestamp('last_seen_date', { withTimezone: true }),
  lastAmountCents: integer('last_amount_cents'),
  isActive: boolean('is_active').notNull().default(true),
  isConfirmed: boolean('is_confirmed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### Update shared types: `packages/shared/src/types/index.ts`

```typescript
export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

export interface RecurringBill {
  id: string;
  userId: string;
  merchantPattern: string;
  normalizedName: string;
  categoryId: string | null;
  expectedAmountCents: number;
  amountTolerancePercent: number;
  frequency: BillFrequency;
  nextExpectedDate: string | null;
  lastSeenDate: string | null;
  lastAmountCents: number | null;
  isActive: boolean;
  isConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## API

### Service: `apps/api/src/bills/bills.service.ts` (NEW)

Create a NestJS injectable service.

**Detection algorithm** — `detectRecurring(userId: string)`:
1. Query all non-deleted, non-split-parent transactions for the user, grouped by `normalized_merchant_name` (or `merchant_name` if normalized is null)
2. For each merchant group with 2+ transactions:
   a. Sort by date ascending
   b. Calculate intervals between consecutive transactions (in days)
   c. Check if intervals are consistent (within 20% of the median interval)
   d. If consistent, classify frequency:
      - 5-9 days → weekly
      - 12-18 days → biweekly
      - 25-35 days → monthly
      - 80-100 days → quarterly
      - 170-200 days → semi_annual
      - 340-400 days → annual
   e. Calculate expected amount (average of last 3 occurrences)
   f. Calculate next expected date (last date + interval)
   g. Insert into `recurring_bills` if not already exists (match by userId + merchantPattern)
3. Return `{ detected: number, newBills: number, existingSkipped: number }`

**Check for missed bills** — `checkMissedBills(userId: string)`:
1. Query all active, confirmed recurring bills where `nextExpectedDate < NOW() - 3 days` and no matching transaction exists within the tolerance window
2. For each missed bill, create a notification using the existing `notifications` table:
   - Type: `bill_overdue`
   - Title: `Missed bill: {normalizedName}`
   - Message: `Expected ${formatCents(expectedAmountCents)} around ${formatDate(nextExpectedDate)}. No matching transaction found.`
3. Also trigger Home Assistant webhook if the user has `haWebhookUrl` set in their settings
4. Return `{ missedCount: number, notified: number }`

**CRUD methods:**
- `findAll(userId)` — list all recurring bills for the user, ordered by nextExpectedDate
- `confirm(id, userId)` — set isConfirmed = true
- `deactivate(id, userId)` — set isActive = false
- `update(id, userId, input)` — update expectedAmountCents, frequency, normalizedName, etc.
- `delete(id, userId)` — hard delete

### Controller: `apps/api/src/bills/bills.controller.ts` (NEW)

```typescript
@ApiTags('Bills')
@Controller('bills')
@UseGuards(JwtAuthGuard)
```

Endpoints:
- `GET /bills` — list all recurring bills. Return `{ data: RecurringBill[] }`
- `POST /bills/detect` — run detection algorithm. Return `{ data: { detected, newBills, existingSkipped } }`
- `POST /bills/check-missed` — check for missed bills and send notifications. Return `{ data: { missedCount, notified } }`
- `POST /bills/:id/confirm` — confirm a detected bill
- `PATCH /bills/:id` — update bill details
- `DELETE /bills/:id` — remove a bill

### Module: `apps/api/src/bills/bills.module.ts` (NEW)

Standard NestJS module. Import the notifications module if needed for creating alerts.

Register the module in `apps/api/src/app.module.ts`.

## Frontend

### Hook: `apps/web/src/lib/hooks/useBills.ts` (NEW)

Follow the pattern of `apps/web/src/lib/hooks/useAccounts.ts`:
- `useBills()` — useQuery, queryKey `['bills']`, GET `/bills`
- `useDetectBills()` — useMutation, POST `/bills/detect`, invalidates `['bills']`
- `useCheckMissedBills()` — useMutation, POST `/bills/check-missed`, invalidates `['bills', 'notifications']`
- `useConfirmBill()` — useMutation, POST `/bills/:id/confirm`, invalidates `['bills']`
- `useUpdateBill()` — useMutation, PATCH `/bills/:id`, invalidates `['bills']`
- `useDeleteBill()` — useMutation, DELETE `/bills/:id`, invalidates `['bills']`

### Page: `apps/web/src/app/(protected)/bills/page.tsx` (NEW)

Page layout:
- Header: "Recurring Bills" title + two buttons: "Detect Bills" (scans transactions) and "Check Missed" (runs missed bill check)
- Success feedback banners (same pattern as Sync Admin page)
- Two sections:

**Confirmed Bills** — table/card list:
- Columns: Merchant (normalized name), Amount, Frequency (badge), Next Due, Last Paid, Status (badge: upcoming/overdue/paid), Actions (edit/deactivate)
- Status logic: if nextExpectedDate is in the past and no matching recent txn → "Overdue" (red badge). If within 7 days → "Upcoming" (yellow). Otherwise "On Track" (green).
- Deactivate button (soft disable, not delete)

**Detected (Unconfirmed)** — separate section below:
- Same columns but with "Confirm" and "Dismiss" buttons instead of edit/deactivate
- Help text: "These recurring charges were auto-detected from your transaction history. Confirm to enable alerts."

### Add to sidebar: modify `apps/web/src/components/Sidebar.tsx`

Add after the "Budgets" entry:
```typescript
{ href: '/bills', label: 'Bills', icon: CalendarClock },
```
Import `CalendarClock` from `lucide-react`.

### Dashboard widget: modify `apps/web/src/app/(protected)/page.tsx`

Add a small "Upcoming Bills" card to the dashboard showing the next 5 bills due within 7 days. Create a component `apps/web/src/components/charts/UpcomingBillsCard.tsx`:
- Show: merchant name, amount, days until due
- Link to /bills page
- If any bills are overdue, show a red alert count

## Important
- The detection algorithm uses `normalized_merchant_name` from the transactions table (from Feature F.1)
- Notification creation uses the existing `notifications` table and schema in the app
- HA webhook uses the user's `haWebhookUrl` from `user_settings` table
- The `notifications` table already exists — check schema.ts for its structure
- Do NOT read .env files or include secrets

## After implementation — verification steps (MANDATORY)

### Step 1: Build
Run `pnpm build` from the repo root. Fix ALL TypeScript errors.

### Step 2: Tests
Write tests for:
- Detection algorithm: given 5 monthly transactions from same merchant, should detect as recurring with monthly frequency
- Detection algorithm: given 2 transactions with irregular intervals, should NOT detect as recurring
- Missed bill check: given a confirmed bill with nextExpectedDate 5 days ago and no matching transaction, should create notification
- CRUD: confirm, deactivate, delete
Run `pnpm test` and ensure all pass.

### Step 3: Rubber duck code review
Review for: ownership checks on all endpoints, correct date arithmetic in detection, edge cases (what if only 1 transaction for a merchant?), module registration in app.module.ts. Fix any issues.

### Step 4: Deploy to NAS
```bash
cd ~/repo/MyMoney
./deploy-to-nas.sh
```

### Step 5: Post-deploy SQL
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  CREATE TABLE IF NOT EXISTS recurring_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    merchant_pattern VARCHAR(200) NOT NULL,
    normalized_name VARCHAR(200) NOT NULL,
    category_id UUID REFERENCES categories(id),
    expected_amount_cents INTEGER NOT NULL,
    amount_tolerance_percent INTEGER NOT NULL DEFAULT 15,
    frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
    next_expected_date TIMESTAMPTZ,
    last_seen_date TIMESTAMPTZ,
    last_amount_cents INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_confirmed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_bills_user ON recurring_bills(user_id);
  CREATE INDEX IF NOT EXISTS idx_bills_next ON recurring_bills(next_expected_date);
"
```

### Step 6: Manual test checklist
- [ ] Navigate to /bills in the sidebar
- [ ] Click "Detect Bills" → should find recurring patterns in your transactions
- [ ] Confirm detected bills → moves to confirmed section
- [ ] Click "Check Missed" → should alert on any overdue bills
- [ ] Verify notification bell shows missed bill alerts
- [ ] Dashboard shows "Upcoming Bills" card with next 5 due bills
```

---

## Prompt 4 — Spending Anomaly Alerts

### Prompt (copy this into Copilot Chat)

```
I need to add spending anomaly detection to MoneyPulse. The system should flag unusual transactions after each import and create notifications.

## Service: `apps/api/src/analytics/anomaly-detector.service.ts` (NEW)

Create a NestJS injectable service. Inject DATABASE_CONNECTION.

### Detection Rules

Implement these methods in the service:

**`detectAnomalies(userId: string, transactionIds: string[])`**

For each transaction ID provided, check against these rules:

1. **Amount anomaly**: Query the user's average amount for the same `normalized_merchant_name` (or `merchant_name`). If the current transaction's amount is > 3x the average, flag it. SQL:
```sql
SELECT AVG(amount_cents) as avg_cents, COUNT(*) as txn_count
FROM transactions
WHERE user_id = $userId
  AND normalized_merchant_name = $merchantName
  AND deleted_at IS NULL
  AND id != $currentTxnId
```
Only flag if txn_count >= 3 (need enough history). Create notification with message: `Unusual spend at {merchant}: {amount} — your average is {avg}`.

2. **Duplicate detection**: Check if another transaction exists with the same account + similar amount (within 5%) + same merchant + within 24 hours. SQL:
```sql
SELECT id FROM transactions
WHERE account_id = $accountId
  AND ABS(amount_cents - $amountCents) <= $amountCents * 0.05
  AND normalized_merchant_name = $merchantName
  AND date BETWEEN $date - INTERVAL '1 day' AND $date + INTERVAL '1 day'
  AND id != $currentTxnId
  AND deleted_at IS NULL
LIMIT 1
```
If found, create notification: `Possible duplicate: {amount} at {merchant} on {date}`.

3. **Large debit alert**: If the transaction is a debit (is_credit = false) and amount > user-configurable threshold (default: 50000 cents = $500). Check user settings for a custom threshold (add `largeDebitThresholdCents` to user_settings if not present, default 50000). Create notification: `Large purchase: {amount} at {merchant}`.

4. **Category overspend**: If the transaction has a category and a budget exists for that category, check if the category's month-to-date spending now exceeds 90% of the budget. Query:
```sql
SELECT SUM(amount_cents) as spent
FROM transactions
WHERE user_id = $userId
  AND category_id = $categoryId
  AND is_credit = false
  AND date >= date_trunc('month', CURRENT_DATE)
  AND deleted_at IS NULL
```
Compare with the budget amount from the `budgets` table. If spent > budget * 0.9, create notification: `{category} spending at {percent}% of budget ({spent} / {budget})`.

**Creating notifications**: Use the existing `notifications` table in `apps/api/src/db/schema.ts`. Insert with:
- `userId`: the user's ID
- `type`: `'spending_anomaly'`
- `title`: short title (e.g., "Unusual spend detected")
- `message`: detailed message
- `isRead`: false
- `webhookSent`: false

After inserting the notification, if the user has `haWebhookUrl` in their settings, send a webhook POST with `{ title, message }` to that URL.

### Integration with ingestion

Modify `apps/api/src/jobs/ingestion.processor.ts`:
- Import and inject `AnomalyDetectorService`
- After transactions are inserted and categorized (after the auto-categorize step), call `anomalyDetector.detectAnomalies(userId, insertedTransactionIds)`
- This runs automatically on every file import

### Module: `apps/api/src/analytics/analytics.module.ts`

Add `AnomalyDetectorService` to providers and exports. The analytics module may need to import the notifications module or directly use the DB.

## No frontend changes needed

Anomaly alerts appear via the existing notification bell (`NotificationBell` component in the top bar) which already queries the `notifications` table. The alerts also go to Home Assistant via webhook.

## Important
- Use `normalized_merchant_name` for merchant matching (from Feature F.1)
- The `notifications` table already exists — check `apps/api/src/db/schema.ts` for its exact column names
- The `budgets` table already exists — check schema for its structure
- The `user_settings` table already has `haWebhookUrl` column
- Do NOT add a `largeDebitThresholdCents` column to user_settings — instead, use a hardcoded default of 50000 (can be made configurable later)
- Do NOT read .env files or include secrets

## After implementation — verification steps (MANDATORY)

### Step 1: Build
Run `pnpm build` from the repo root. Fix ALL TypeScript errors.

### Step 2: Tests
Write tests for `AnomalyDetectorService`:
- Amount anomaly: mock a transaction at 4x average → should create notification
- Amount anomaly: mock a transaction at 1.5x average → should NOT create notification
- Duplicate detection: mock two transactions same merchant/amount/day → should flag
- Large debit: mock a $600 debit → should trigger, $400 debit → should NOT
- Category overspend: mock spending at 95% of budget → should flag
Run `pnpm test` and ensure all pass.

### Step 3: Rubber duck code review
Review for: SQL injection safety, correct threshold logic, notification deduplication (don't create duplicate alerts for same transaction), module registration, ingestion processor integration doesn't break existing flow. Fix any issues.

### Step 4: Deploy to NAS
```bash
cd ~/repo/MyMoney
./deploy-to-nas.sh
```

### Step 5: Post-deploy SQL
No SQL migration needed — uses existing tables.

### Step 6: Manual test checklist
- [ ] Import a bank statement with a large transaction (>$500) → notification bell shows alert
- [ ] If HA webhook is configured, verify the push notification arrives
- [ ] Check notification bell for any anomaly alerts on existing transactions
```

---

## Prompt 5 — Budget vs Actual Variance Dashboard

### Prompt (copy this into Copilot Chat)

```
I need to add a budget progress visualization to the MoneyPulse dashboard and budgets page. Show per-category progress bars with spent vs. budget amounts.

## API: New endpoint in `apps/api/src/analytics/analytics.controller.ts`

Add a new endpoint:

```typescript
@Get('budget-progress')
@ApiOperation({ summary: 'Budget vs actual progress per category' })
async budgetProgress(
  @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  @CurrentUser() user: AuthTokenPayload,
) {
  const data = await this.analyticsService.budgetProgress(
    user.sub,
    query,
    user.householdId,
  );
  return { data };
}
```

### Service method: add to `apps/api/src/analytics/analytics.service.ts`

Add a `budgetProgress` method:

```typescript
async budgetProgress(userId: string, query: AnalyticsQuery, householdId?: string | null) {
```

SQL logic:
1. Get all active budgets for the user (from `budgets` table)
2. For each budget, calculate month-to-date spending in that category:
```sql
SELECT
  b.id as budget_id,
  b.category_id,
  c.name as category_name,
  c.icon as category_icon,
  c.color as category_color,
  b.amount_cents as budget_cents,
  b.period,
  COALESCE(SUM(t.amount_cents), 0) as spent_cents
FROM budgets b
JOIN categories c ON b.category_id = c.id
LEFT JOIN transactions t ON t.category_id = b.category_id
  AND t.is_credit = false
  AND t.is_split_parent = false
  AND t.deleted_at IS NULL
  AND t.user_id = $userId
  AND t.date >= $periodStart::date
  AND t.date <= $periodEnd::date
WHERE (b.user_id = $userId OR b.household_id = $householdId)
GROUP BY b.id, b.category_id, c.name, c.icon, c.color, b.amount_cents, b.period
ORDER BY spent_cents DESC
```

Where `$periodStart` and `$periodEnd` come from the query params (from/to), defaulting to start of current month and today.

Exclude categories where `c.is_transfer = true`.

Return array of:
```typescript
{
  budgetId: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  budgetCents: number;
  spentCents: number;
  period: 'monthly' | 'weekly';
  percentUsed: number; // Math.round((spentCents / budgetCents) * 100)
  remainingCents: number; // budgetCents - spentCents (can be negative if over)
  status: 'on_track' | 'warning' | 'over_budget'; // <70% = on_track, 70-100% = warning, >100% = over_budget
}
```

## Frontend

### Hook: add to `apps/web/src/lib/hooks/useAnalytics.ts`

```typescript
export interface BudgetProgressItem {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  budgetCents: number;
  spentCents: number;
  period: 'monthly' | 'weekly';
  percentUsed: number;
  remainingCents: number;
  status: 'on_track' | 'warning' | 'over_budget';
}

export function useBudgetProgress(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'budget-progress', params],
    queryFn: () =>
      api.get<{ data: BudgetProgressItem[] }>('/analytics/budget-progress', { params }),
  });
}
```

### Component: `apps/web/src/components/charts/BudgetProgressCard.tsx` (NEW)

Create a card component that shows budget progress bars:

```
Budget Progress
-----------------------------------------
🛒 Groceries          $420 / $600    70%
[██████████████░░░░░░] ← green bar

🍽️ Dining             $280 / $300    93%
[██████████████████░░] ← yellow bar (warning)

⛽ Gas/Auto            $350 / $250   140%
[████████████████████] ← red bar (over budget)
                        $100 over ←  red text
-----------------------------------------
```

Structure for each row:
- Left: icon + category name
- Center: progress bar using a `<div>` with percentage width
  - Background: `var(--muted)` track
  - Fill color: green (`#22c55e`) for <70%, yellow (`#eab308`) for 70-100%, red (`#ef4444`) for >100%
  - Bar width: `min(percentUsed, 100)%`
- Right: `$spent / $budget` + percentage
- If over budget: show "over by $X" in red below the bar

Props: `{ data: BudgetProgressItem[] }`

### Dashboard integration: modify `apps/web/src/app/(protected)/page.tsx`

Add the budget progress card to the dashboard. Import `useBudgetProgress` hook and `BudgetProgressCard` component. Add after the KPI cards section:

```tsx
{budgetData?.data && budgetData.data.length > 0 && (
  <BudgetProgressCard data={budgetData.data} />
)}
```

Show max 5 categories (closest to or over budget first — sort by percentUsed descending). Add a "View all" link to `/budgets`.

### Budgets page enhancement: modify `apps/web/src/app/(protected)/budgets/page.tsx`

Add the same `BudgetProgressCard` component to the budgets page but show ALL categories (not limited to 5).

## Important
- The `budgets` table already exists — check `apps/api/src/db/schema.ts` for column names
- Use `formatCents` from `@/lib/format` for money display
- Follow the existing card styling: `rounded-2xl bg-[var(--card)] p-6 shadow-sm`
- Do NOT read .env files or include secrets

## After implementation — verification steps (MANDATORY)

### Step 1: Build
Run `pnpm build` from the repo root. Fix ALL TypeScript errors.

### Step 2: Tests
Write tests for the `budgetProgress` analytics service method:
- Given a budget of $500 for Groceries and $350 spent → returns percentUsed=70, status='warning'
- Given no budgets → returns empty array
- Given spending exceeds budget → returns status='over_budget', negative remainingCents
- Verify is_transfer categories are excluded from spending calculations
Run `pnpm test` and ensure all pass.

### Step 3: Rubber duck code review
Review for: correct period date calculations (month-to-date vs custom range), handling of weekly vs monthly budget periods, null safety on category joins, dashboard component handles empty data gracefully. Fix any issues.

### Step 4: Deploy to NAS
```bash
cd ~/repo/MyMoney
./deploy-to-nas.sh
```

### Step 5: Post-deploy SQL
No SQL migration needed — uses existing tables.

### Step 6: Manual test checklist
- [ ] Dashboard shows "Budget Progress" card (requires at least one budget to exist)
- [ ] Progress bars show correct colors: green (<70%), yellow (70-100%), red (>100%)
- [ ] Over-budget categories show "over by $X" in red
- [ ] Navigate to /budgets → shows full budget progress for ALL categories
- [ ] "View all" link on dashboard navigates to /budgets page
- [ ] If no budgets exist, card does not render (no empty state error)
```

---

## Prompt 6 — Notification Push Backbone (NAS emit + Web FCM send + HA LAN fix)

> **Why first**: This is the backbone for EVERY alert feature (anomalies, missed bills, forecasts, digest, subscriptions, streaks). Once it lands, those features get phone push for free — they just call the NAS notification chokepoint.
>
> **Reality check (already built — do NOT rebuild):** moneypulse-web ALREADY handles `notification.projected.v1` (`functions/src/index.ts` → `fanOutNotification` writes `users/{userAliasId}/notifications/{notificationAliasId}`), ALREADY registers FCM device tokens (`apps/web/src/lib/fcm/use-fcm-token.ts` → `users/{uid}/deviceTokens/{tokenId}`), and ALREADY has the messaging service worker (`public/firebase-messaging-sw.js`). **The two real gaps:** (1) the NAS never *emits* the event, and (2) nothing ever *sends* an FCM push — device tokens are collected but never used, which is why alerts only show when the app is open.
>
> **This prompt has TWO copy-paste blocks. Run 6a from `~/repo/MyMoney`. Run 6b from `~/repo/moneypulse-web` (separate Copilot session, that repo has its own agents/specs).** Sync verdict: this IS the sync contract.

### Prompt 6a — NAS side (copy this into Copilot Chat with `~/repo/MyMoney` open)

```
I need MoneyPulse to emit notification events to the sync outbox in the EXACT shape the moneypulse-web companion already expects, and fix the Home Assistant webhook that's silently blocked for LAN addresses. Follow existing codebase patterns exactly. Do NOT read .env files or include secrets.

## Critical contract — match the web fan-out EXACTLY
The moneypulse-web `ingestSyncEvent` function (already deployed) expects `notification.projected.v1` payloads with these fields:
- `notificationAliasId` (string) — the doc id; producer MUST set it via the alias mapper
- `type` (string), `title` (string), `body` (string)  ← NOTE: the field is `body`, NOT `message`
- `userAliasId` is added automatically by the delivery layer from the outbox row's `userId` — do NOT set it yourself.
The web IGNORES `message`, `metadata`, and raw `id`. The sync sanitizer (`apps/api/src/sync/sanitizer-v2.service.ts`) will police the payload, so keep it to the fields above.

How existing producers shape entity aliases: see `apps/api/src/sync/sync.controller.ts` (~line 210) — it sets `transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id)`. Do the same for notifications: `notificationAliasId: this.aliasMapper.toAliasId('notification', row.id)`.

## 1. Notification chokepoint: `apps/api/src/notifications/notifications.service.ts` (NEW or extend)

A single `create()` that ALL notification producers call:

async create(input: { userId: string; type: string; title: string; message: string; metadata?: Record<string, unknown> }): Promise<Notification> {
  // 1. Domain write — must always succeed
  const [row] = await this.db.insert(schema.notifications).values({ ...input }).returning();

  // 2. Best-effort outbox projection — NEVER inside a tx around the insert (alias/signing secrets may be absent in dev → would roll back the notification). Match the web contract:
  try {
    await this.outbox.enqueue({
      eventType: 'notification.projected.v1',
      aggregateType: 'notification',
      aggregateId: row.id,
      userId: input.userId,                       // delivery layer maps this → userAliasId
      payload: {
        notificationAliasId: this.aliasMapper.toAliasId('notification', row.id),
        type: row.type,
        title: row.title,
        body: row.message,                        // web field is `body`
      },
    });
  } catch (err) { this.logger.warn(`notification outbox enqueue failed: ${(err as Error).message}`); }

  // 3. Best-effort HA webhook, then mark webhookSent
  try {
    await this.webhook.sendWebhook(input.userId, { title: input.title, message: input.message, type: input.type });
    await this.db.update(schema.notifications).set({ webhookSent: true }).where(eq(schema.notifications.id, row.id));
  } catch (err) { this.logger.warn(`HA webhook failed: ${(err as Error).message}`); }

  return row;
}

Inject `OutboxService`, `AliasMapperService`, `WebhookService`. Register `NotificationsService` in the notifications module providers + exports, and import it wherever producers live.

## 2. Migrate existing producers
Grep for direct inserts into the notifications table (e.g. `anomaly-detector.service.ts`, `bills.service.ts`, any digest/forecast code) and route them ALL through `notificationsService.create(...)`. After this, every alert automatically reaches web + push + HA.

## 3. HA webhook LAN allowlist fix — `apps/api/src/notifications/webhook.service.ts`
`isUrlSafe()` currently blocks localhost/127.*/10.*/192.168.*/172.16-31.*/.local/.internal, so LAN Home Assistant webhooks are silently dropped.
- Read `HA_WEBHOOK_ALLOWED_HOSTS` (comma-separated hostnames/IPs, e.g. `homeassistant.local,192.168.1.50`) from env.
- In `isUrlSafe()`, BEFORE the private-IP rejection, return true if the URL's hostname is in the allowlist. Keep rejecting every other private/LAN host — this is a narrow, explicit exception, NOT removal of the SSRF guard.

## After implementation — verification (MANDATORY)
### Step 1: Build — `pnpm build`, fix all TS errors.
### Step 2: Tests
- `create()` inserts a row AND enqueues a `notification.projected.v1` event whose payload has `notificationAliasId`/`type`/`title`/`body` (and NOT `message`/`metadata`).
- When `outbox.enqueue` throws, `create()` still returns the inserted row (no rollback).
- `isUrlSafe()` returns true for a host in `HA_WEBHOOK_ALLOWED_HOSTS`, false for a non-allowlisted `192.168.x.x`.
### Step 3: Rubber duck — enqueue NOT in a tx; every legacy notification insert migrated; allowlist doesn't permit arbitrary LAN hosts; payload matches the web contract (field is `body`).
### Step 4: Deploy — `cd ~/repo/MyMoney && ./deploy-to-nas.sh`, then set `HA_WEBHOOK_ALLOWED_HOSTS` on the NAS env.
> **HA voice notifications**: if you use the Home Assistant webhook (voice announcements / home automations — see `docs/home-assistant-notifications.md`), `HA_WEBHOOK_ALLOWED_HOSTS` MUST include your HA host IP (e.g. `192.168.30.10`) or the webhook stays blocked by `isUrlSafe()`. Then set the webhook URL in MoneyPulse Settings (`http://<HA_IP>:8123/api/webhook/<id>`).
### Step 5: No NAS schema change.
### Step 6: Manual
- [ ] Trigger an anomaly (import a >$500 debit) → notification row created
- [ ] Sync Admin shows a `notification.projected.v1` event delivered
- [ ] The doc appears in Firestore under `users/{alias}/notifications`
- [ ] HA webhook fires to the LAN Home Assistant (check HA logbook)
- [ ] A `192.168.x.x` URL NOT in the allowlist is still blocked
```

### Prompt 6b — Web side (copy this into Copilot Chat with `~/repo/moneypulse-web` open)

```
I need moneypulse-web to actually SEND an FCM push when a synced notification arrives, so alerts reach my phone even when the web app is closed. Today notifications are written to Firestore by `fanOutNotification` but no push is ever sent (device tokens at users/{uid}/deviceTokens are collected but never used). Follow this repo's TDD mandate and data-boundary contract (see CLAUDE.md). Read specs/ first.

## What already exists (verify, don't rebuild)
- `functions/src/index.ts` → `fanOutNotification` writes `users/{userAliasId}/notifications/{notificationAliasId}`.
- `apps/web/src/lib/fcm/use-fcm-token.ts` registers tokens at `users/{uid}/deviceTokens/{tokenId}` (fields: token, platform, platformDetail, userAliasId, lastSeenAt).
- `public/firebase-messaging-sw.js` is the background messaging service worker.

## The gap: send FCM on new notification

### Option (preferred): a Firestore onCreate trigger
Add a new Cloud Function in `functions/src/` (e.g. `onNotificationCreated`) using Firebase Functions v2 `onDocumentCreated('users/{userAliasId}/notifications/{notificationId}', ...)`:
1. Read the new notification doc (type, title, body).
2. Read the user's tokens: `db.collection('users/{userAliasId}/deviceTokens')`.
3. `getMessaging().sendEachForMulticast({ tokens, notification: { title, body }, webpush: { fcmOptions: { link: '/notifications' }, notification: { icon: '/icons/icon-192.png' } }, data: { type, notificationId } })`.
4. Prune dead tokens: on `messaging/registration-token-not-registered` per-response errors, delete that deviceToken doc.
Keep using Firebase Admin (server-side) — never expose messaging to the browser. No secrets in code.

(If you prefer doing the send inside `fanOutNotification` instead of a separate trigger, that's acceptable — but a dedicated trigger keeps ingest fast and isolates push failures. Pick one; don't double-send.)

### Ensure the service worker shows background pushes
Verify `public/firebase-messaging-sw.js` has an `onBackgroundMessage` handler that calls `self.registration.showNotification(title, { body, icon, data })` and an `notificationclick` handler that focuses/open the `/notifications` route. Add if missing.

## Verification (MANDATORY — this repo: pnpm test then pnpm build)
### Tests
- Unit test the trigger: given a notification doc + 2 device tokens, it calls `sendEachForMulticast` with the right title/body and token list.
- A `token-not-registered` error deletes that token doc.
- No PII beyond title/body/type is sent (data-boundary contract).
### Rubber duck (use /rubber-duck) — no browser write path added; Firestore rules unchanged for deviceTokens; idempotent (don't resend on doc updates, only onCreate).
### Deploy — `firebase deploy --only functions` (and rules if touched).
### Manual
- [ ] Trigger a NAS notification (Prompt 6a) → phone receives a real push with app CLOSED
- [ ] Tapping the push opens the notifications view
- [ ] Removing the device → its token is pruned on next send
```

> **Companion checklist for you (the human):** run 6a from MyMoney → deploy NAS → run 6b from moneypulse-web → `firebase deploy`. The end-to-end test (anomaly on NAS → push on phone) needs BOTH deployed. For real iOS background push, also do **Prompt 21** (installable PWA).

---

## Prompt 7 — Remote Mac-Ollama Resilience + Retry Queue

> **Why second**: All AI features (phase-2 normalization, OCR, chat) assume Ollama. It now runs on the dev Mac (M1), which is intermittent. This prompt makes AI best-effort with a retry queue so OCR/bill-parse results are never lost and ingestion never blocks. **Sync verdict: `web: none`.**

### Prompt (copy this into Copilot Chat)

```
I need to make MoneyPulse's AI (Ollama) calls resilient to Ollama running on a separate, intermittently-available machine (my dev Mac, reached over the LAN). Today Ollama is assumed local; I'm pointing it at the Mac. Follow existing patterns.

## Background (current state — verify before coding)

- `apps/api/src/categorization/ai-categorizer.service.ts` reads `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`, batch size, timeout. It already returns nulls gracefully when Ollama is unreachable.
- `apps/api/src/health/health.controller.ts` already probes `${OLLAMA_URL}/api/tags`.
- The app already uses BullMQ + Redis for the sync delivery queue (see `apps/api/src/sync/sync-delivery.service.ts` and the jobs module).

## Goal

Rule engine always runs on the NAS. AI enrichment is best-effort: when the Mac/Ollama is unreachable, work that needs AI is QUEUED and reprocessed when it returns — never dropped, never blocking ingestion.

## Part A — Health gate

### `apps/api/src/categorization/ollama-health.service.ts` (NEW)

A small injectable that caches Ollama reachability (probe `${OLLAMA_URL}/api/tags`, cache result ~30s to avoid hammering). Expose `isAvailable(): Promise<boolean>`. Reuse this in the AI categorizer and the new queue processor so we skip AI work fast instead of waiting for per-item timeouts when the Mac is asleep.

## Part B — AI enrichment retry queue (BullMQ)

### `apps/api/src/jobs/ai-enrichment.queue.ts` + processor (NEW)

Register a new BullMQ queue `ai-enrichment` (follow the existing queue registration pattern in the jobs module). Job types:
- `normalize-merchant` — { transactionIds: string[] } (lossy-OK: rule engine already gave a usable name; AI just improves it)
- `ocr-receipt` — { receiptQueueId: string } (MUST-RETRY: no result without AI — used by Prompt 8)
- `parse-bill` — { ... } (MUST-RETRY)

Processor behavior:
1. Check `ollamaHealth.isAvailable()`. If false → throw a retryable error so BullMQ backs off (do NOT mark the job failed permanently).
2. If available → run the AI step, persist the result.
3. Backoff: exponential, e.g. `{ attempts: 10, backoff: { type: 'exponential', delay: 60_000 } }`. After max attempts, move to a dead-letter state that is VISIBLE (log + a queryable status), not a silent drop. For must-retry jobs, prefer a longer/again-schedulable strategy over hard failure.

### Enqueue points

- In `ingestion.processor.ts`: after the rule-engine + (attempted) inline AI categorization, enqueue `normalize-merchant` for any transactions whose merchant wasn't confidently normalized — instead of relying solely on the inline call. If Ollama was up and inline succeeded, no job needed.
- Receipt OCR (Prompt 8) and bill parsing enqueue their must-retry jobs here.

## Part C — Reconcile-on-return

Add a lightweight scheduled check (the app already runs scheduled jobs — follow that pattern) that, when Ollama transitions unreachable→reachable, ensures the `ai-enrichment` queue is being drained (BullMQ retries handle most of this; the scheduled nudge re-promotes any delayed jobs). Keep it simple — do not build a custom queue.

## Part D — Config & docs

- `OLLAMA_URL=http://<mac-hostname>.local:11434` (mDNS). Add a short doc note (e.g. in `docs/`) on:
  - Setting `OLLAMA_HOST=0.0.0.0:11434` on the Mac so it listens on the LAN.
  - DHCP reservation / static IP fallback if the NAS Docker container can't resolve `.local` (document a docker-compose `extra_hosts: ["machost:192.168.x.x"]` example).
  - Firewall: restrict 11434 to the LAN subnet; never expose to WAN.
- Do NOT hardcode the Mac's IP in code. It's env-only.

## Important
- Do NOT read .env files or include secrets.
- Categorization/normalization are lossy-OK (rule engine fallback). Receipt OCR + bill parsing are must-retry.
- Do NOT block ingestion waiting on AI — enqueue and move on.

## After implementation — verification steps (MANDATORY)

### Step 1: Build
`pnpm build` from repo root. Fix ALL TypeScript errors.

### Step 2: Tests
- `OllamaHealthService.isAvailable()` returns false when the probe fails, true when it returns ok; result is cached within the TTL.
- AI-enrichment processor throws a retryable error (does NOT permanently fail) when Ollama is unavailable.
- Enqueue: importing transactions when Ollama is down enqueues `normalize-merchant` jobs.
Run `pnpm test` — all pass.

### Step 3: Rubber duck code review
Review for: ingestion never blocks on AI; must-retry jobs never silently dropped; health probe cached (not hammered); no hardcoded Mac IP; backoff sane. Fix issues.

### Step 4: Deploy
```bash
cd ~/repo/MyMoney && ./deploy-to-nas.sh
# On the NAS, set OLLAMA_URL to the Mac's mDNS/IP. On the Mac: OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

### Step 5: Manual test checklist
- [ ] With the Mac AWAKE: import a statement → transactions get AI-normalized merchant names
- [ ] Put the Mac to SLEEP, import again → ingestion completes immediately, `ai-enrichment` jobs are queued (rule-engine names used meanwhile)
- [ ] Wake the Mac → queued jobs drain, merchant names get AI-improved
- [ ] `GET /health` shows ollama: connected when Mac is up, unavailable when asleep
```

---

## Prompt 8 — Receipt Watch Folder + Ollama Vision OCR Auto-Match

> Builds on Prompt 2 (manual attachments) and Prompt 7 (AI resilience). Adds the "drop a receipt in a folder, it auto-links to a transaction" pipeline, modeled on DocuPulse (`~/repo/smartocrprocess`) but with Ollama vision instead of Tesseract. **Sync verdict: `web: field-only`** (web shows the existing "has attachment" indicator; review queue is NAS-only).

### Prompt (copy this into Copilot Chat)

```
I need a watch-folder receipt pipeline for MoneyPulse: drop a receipt image/PDF into a folder → Ollama vision OCR extracts merchant/date/amount → auto-match to an existing transaction → link as attachment if confident, else queue for review. Follow existing patterns. AI must be resilient (Ollama runs on my Mac and may be asleep — use the ai-enrichment retry queue from Prompt 7).

## Schema

### New table: `receipt_queue`

Add to `apps/api/src/db/schema.ts`:

```typescript
export const receiptQueue = pgTable('receipt_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  stagingPath: varchar('staging_path', { length: 500 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('processing'), // processing|matched|pending_review|linked|failed
  ocrMerchant: varchar('ocr_merchant', { length: 200 }),
  ocrDate: timestamp('ocr_date', { withTimezone: true }),
  ocrAmountCents: integer('ocr_amount_cents'),
  ocrConfidence: real('ocr_confidence'),
  matchedTransactionId: uuid('matched_transaction_id').references(() => transactions.id),
  matchCandidates: jsonb('match_candidates'), // top 3 {transactionId, score}
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add a `ReceiptQueueItem` interface to `packages/shared/src/types/index.ts`.

## Watch folder service: `apps/api/src/receipts/receipt-watcher.service.ts` (NEW)

- Watch `/config/receipts/incoming/` (use `chokidar` or `fs.watch`; DocuPulse uses a stability check — wait until the file size is stable for ~2s before processing, so partial uploads aren't picked up).
- On a stable new file: move it to `/config/receipts/staging/{uuid}_{filename}`, insert a `receipt_queue` row (status `processing`), and enqueue an `ocr-receipt` job on the `ai-enrichment` queue (Prompt 7). Do NOT OCR inline — the Mac may be asleep.
- Note: which user owns a watch-folder drop? For a single-user NAS, default to the primary user; document this. (Multi-user: use per-user subfolders `/config/receipts/incoming/{userId}/`.)

## OCR + match: `apps/api/src/receipts/receipt-scanner.service.ts` (NEW)

`processReceipt(receiptQueueId)` — invoked by the `ocr-receipt` queue processor:
1. Check `ollamaHealth.isAvailable()` (Prompt 7). If down → throw retryable (job backs off).
2. Read the staged file. Call Ollama vision (`OLLAMA_VISION_MODEL`, e.g. `llama3.2-vision` or `llava`) via `/api/generate` with the image base64-encoded and prompt:
   `Extract from this receipt and return ONLY JSON: { "merchant": string, "date": "YYYY-MM-DD", "totalCents": number, "items": [{ "name": string, "amountCents": number }] }`
3. Parse JSON robustly (reuse the JSON-extraction approach in `ai-categorizer.service.ts`). Store ocrMerchant/ocrDate/ocrAmountCents/ocrConfidence.
4. **Match** against the user's transactions:
   - Date within ±3 days, amount within ±5%, merchant fuzzy match (Levenshtein or compare against `normalized_merchant_name`).
   - Score each candidate; keep top 3 in `matchCandidates`.
   - Confidence > 0.85 (all three strong) → auto-link: create a `transaction_attachments` row (move file to `/config/attachments/{userId}/{txnId}/`), set status `linked`, and create a notification via `NotificationsService.create()` ("Receipt auto-linked to {merchant} {amount}").
   - 2 of 3 → status `pending_review` with candidates.
   - Else → status `pending_review` with no strong candidate.

## API: `apps/api/src/receipts/receipts.controller.ts` (NEW)

```typescript
@ApiTags('Receipts') @Controller('receipts') @UseGuards(JwtAuthGuard)
```
- `GET /receipts/queue` — list pending-review items for the current user. `{ data: ReceiptQueueItem[] }`
- `POST /receipts/queue/:id/link` — body `{ transactionId }`; verify ownership of both; create attachment, set status `linked`. `{ data: { linked: true } }`
- `POST /receipts/queue/:id/dismiss` — set status `failed`/dismissed, optionally delete staged file. `{ data: { dismissed: true } }`

Register controller + services in a `receipts.module.ts`; register module in `app.module.ts`. Import the ai-enrichment queue.

## Frontend (NAS app only)

### Hook `apps/web/src/lib/hooks/useReceipts.ts` (NEW): `useReceiptQueue()`, `useLinkReceipt()`, `useDismissReceipt()` — follow useBills pattern.

### Page `apps/web/src/app/(protected)/receipts/page.tsx` (NEW)
- Header "Receipt Review" + count of pending items.
- Card per pending receipt: thumbnail, OCR'd merchant/date/amount + confidence, and a "Link to transaction" dropdown pre-filled with the top candidates (show date/amount/merchant per candidate). Confirm or Dismiss.
- Bulk approve/dismiss optional.

### Sidebar: add `{ href: '/receipts', label: 'Receipts', icon: ReceiptText }` after Bills. Import `ReceiptText` from lucide-react.

## Important
- OCR MUST go through the Prompt 7 retry queue (must-retry — no result without AI). Never drop a receipt because the Mac was asleep.
- Files stay on NAS; only attachment metadata syncs (web shows the paperclip indicator from Prompt 2). Do NOT sync receipt images.
- `/config/receipts/incoming|staging` must exist and be volume-mounted (under `/config`, already mounted).
- Do NOT read .env files or include secrets.

## After implementation — verification steps (MANDATORY)

### Step 1: Build — `pnpm build`, fix all TS errors.
### Step 2: Tests
- Match scoring: a transaction within date/amount/merchant tolerance scores high → auto-link path; a far-off one → pending_review.
- Processor throws retryable when Ollama down (does not lose the receipt).
- `link` endpoint enforces ownership of both receipt and transaction.
### Step 3: Rubber duck review — file stability check, ownership on link/dismiss, retry-not-drop, module registration.
### Step 4: Deploy — `./deploy-to-nas.sh`
### Step 5: Post-deploy SQL
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  CREATE TABLE IF NOT EXISTS receipt_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    original_filename VARCHAR(255) NOT NULL,
    staging_path VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    ocr_merchant VARCHAR(200), ocr_date TIMESTAMPTZ, ocr_amount_cents INTEGER, ocr_confidence REAL,
    matched_transaction_id UUID REFERENCES transactions(id),
    match_candidates JSONB, error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_receipt_queue_user ON receipt_queue(user_id);
  CREATE INDEX IF NOT EXISTS idx_receipt_queue_status ON receipt_queue(status);
"
docker exec -i moneypulse-api mkdir -p /config/receipts/incoming /config/receipts/staging
# Pull the vision model on the Mac: ollama pull llama3.2-vision
```
### Step 6: Manual test checklist
- [ ] Drop a receipt JPG into `/config/receipts/incoming/` (via SMB) → appears in queue
- [ ] With Mac awake: OCR runs, strong match auto-links + notification fires
- [ ] Ambiguous receipt → lands in /receipts review with candidate dropdown
- [ ] With Mac asleep: receipt stays queued, processes when Mac wakes (not lost)
- [ ] Linked receipt shows as attachment (paperclip) on the transaction
```

---

## Prompt 9 — Natural Language Finance Chat

> "How much did I spend on groceries last quarter?" → Ollama → safe read-only SQL → answer + chart. NAS-only. **Sync verdict: `web: none`** (chat is a heavy NAS feature; not projected).

### Prompt (copy this into Copilot Chat)

```
I need a natural-language finance chat for MoneyPulse: the user asks a question, Ollama (on my Mac) translates it to a READ-ONLY SQL query against my finance DB, the API runs it safely and returns a formatted answer with an optional chart. Local/private only. Follow existing patterns. Ollama may be asleep — degrade gracefully.

## Module: `apps/api/src/chat/` (NEW)

### `chat.service.ts`
- `ask(userId, question)`:
  1. If `ollamaHealth.isAvailable()` is false → return `{ answer: "AI assistant is offline (the model host is unreachable). Try again shortly.", offline: true }`. (Chat is interactive — do NOT queue; just degrade.)
  2. Build a system prompt containing the DB SCHEMA SUMMARY ONLY (table + column names for transactions, categories, budgets, accounts — NEVER actual data). Instruct: "Generate a single read-only PostgreSQL SELECT. The query MUST filter `user_id = $1`. No INSERT/UPDATE/DELETE/DDL. No semicolons beyond one statement."
  3. Send to Ollama (`/api/generate`), extract the SQL.
  4. **Safety gate (critical)** before executing:
     - Reject if it doesn't start with `SELECT` (case-insensitive, after trim).
     - Reject if it contains `INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|;.*\S|--|/*` (any second statement or comment).
     - Force the `user_id` bind to the authenticated user (pass as a parameter; do NOT trust the model to inject the right id — append/validate a `user_id = $1` predicate).
     - Wrap execution in a read-only transaction with a statement timeout (e.g. `SET LOCAL statement_timeout = '5s'`).
  5. Format the result rows into a concise natural-language answer + a `chartData` payload when the result is numeric/groupable (e.g. category → amount).

### `chat.controller.ts`
```typescript
@ApiTags('Chat') @Controller('chat') @UseGuards(JwtAuthGuard)
```
- `POST /chat` — body `{ question: string }` (Zod-validated, max length). Returns `{ data: { answer, sql, chartData?, offline? } }`. Include the generated SQL in the response (transparency/debug), but NEVER expose other users' data.

Register module in `app.module.ts`.

## Frontend (NAS app)

### Hook `apps/web/src/lib/hooks/useChat.ts` — `useAskChat()` mutation POST `/chat`.

### Page `apps/web/src/app/(protected)/chat/page.tsx` (NEW)
- Message history within the session (local state).
- Input box + send. Show the answer; if `chartData` present, render with the existing chart library used elsewhere (check `apps/web/src/components/charts/`).
- Suggested-question chips: "What's my biggest expense this month?", "Am I on track with my grocery budget?", "How much did I spend on dining last quarter?"
- If `offline`, show a muted "assistant offline" state.

### Sidebar: `{ href: '/chat', label: 'Ask', icon: MessageCircle }`.

## Important
- READ-ONLY enforcement is non-negotiable: SELECT-only, single statement, forced user scoping, statement timeout, read-only tx. Add a unit test for each rejection case.
- Schema summary in the prompt must contain NO real data — only structure.
- Do NOT read .env files or include secrets.

## After implementation — verification steps (MANDATORY)
### Step 1: Build — fix all TS errors.
### Step 2: Tests
- Safety gate rejects: a query with `DELETE`, a second statement (`; DROP`), a comment (`--`), a query missing user scoping.
- A valid SELECT is allowed and parameterized with the authenticated user id.
- When Ollama is down, `ask()` returns `offline: true` and does NOT execute anything.
### Step 3: Rubber duck review — can the model ever read another user's rows? statement timeout set? no write path? Fix.
### Step 4: Deploy — `./deploy-to-nas.sh`
### Step 5: Manual test checklist
- [ ] Ask "How much did I spend on groceries last month?" → correct number + chart
- [ ] Ask something that would need a write → refused safely
- [ ] Mac asleep → graceful "assistant offline" message
```

---

## Prompt 10 — Cash Flow Forecasting

> Project future account balances from recurring bills (Prompt 3) + average spending + known income. **Sync verdict: `web: summary+push`** (dashboard widget glance + low-balance push alert).

### Prompt (copy this into Copilot Chat)

```
I need cash-flow forecasting in MoneyPulse: project each account's daily balance for the next 30/60/90 days using recurring bills, average daily spending, and known income, and alert if a projected balance drops below a threshold. Follow existing analytics patterns.

## Service: `apps/api/src/analytics/forecast.service.ts` (NEW)

`forecast(userId, days = 90)`:
1. Start from each account's current balance.
2. Subtract upcoming recurring bills (from `recurring_bills`, active+confirmed, by `nextExpectedDate` and `frequency`, rolling forward within the window).
3. Subtract average daily discretionary spend (compute from the last ~90 days of non-transfer debits, excluding amounts already represented by recurring bills to avoid double-counting).
4. Add known recurring income (recurring credits detected the same way as bills).
5. Produce a daily series per account: `[{ date, projectedCents }]`, plus a combined net-worth projection.
6. Flag the first date (if any) each account drops below `forecastLowBalanceThresholdCents` (default 100000 = $1000; document as a future user setting, hardcode default for now).

Return `{ accounts: [{ accountId, accountName, series, lowBalanceDate? }], netWorthSeries, alerts: [{ accountId, date, projectedCents }] }`.

## Controller: add to `apps/api/src/analytics/analytics.controller.ts`
- `GET /analytics/forecast?days=` → `{ data }` (Zod-validate days ∈ {30,60,90}). Use `@CurrentUser()`.

## Alert integration
- A scheduled daily job runs `forecast()` for each user; for any new low-balance alert, call `NotificationsService.create({ type: 'cashflow_low', ... })` (Prompt 6 → projects to web + FCM + HA). De-dupe: don't re-alert the same account/threshold crossing within the same window.

## Frontend (NAS app)
### Hook: add `useForecast(days)` to `useAnalytics.ts`.
### Component `apps/web/src/components/charts/CashFlowForecastChart.tsx` (NEW)
- Line chart: solid line = historical/actual balance, dashed = forecast. Highlight a red "danger zone" band below the threshold; mark the low-balance date.
### Dashboard: add a "Projected balance" widget to `apps/web/src/app/(protected)/page.tsx` — "Checking projected to drop below $1,000 by {date}" or "On track for next 90 days."

## Sync verdict: web: summary+push
- The low-balance NOTIFICATION rides Prompt 6's `notification.projected.v1` → FCM. (No separate forecast-series projection — the full chart stays on NAS.)

## Important
- Avoid double-counting recurring bills in the discretionary average.
- Use `is_transfer = false` non-credit txns for discretionary spend.
- Do NOT read .env files or secrets.

## After implementation — verification steps (MANDATORY)
### Step 1: Build. ### Step 2: Tests
- Deterministic: given 1 monthly $1000 bill + $50/day spend + $5000 balance → projected series decreases correctly and low-balance date is right.
- No recurring bills → forecast still works from spending average.
- Threshold crossing produces exactly one alert (de-dupe).
### Step 3: Rubber duck — double-counting, timezone/date math, empty-account handling.
### Step 4: Deploy. ### Step 5: No SQL migration (uses existing tables).
### Step 6: Manual
- [ ] Dashboard shows projected balance widget
- [ ] Forecast chart shows dashed projection + danger zone
- [ ] A low projected balance triggers a notification + FCM push
```

---

## Prompt 11 — Account Balance History Snapshots (F.2)

> Store periodic balance snapshots so net-worth/trend charts use real data points. Foundational for Prompt 10 (forecast) and Prompt 14 (YoY). **Sync verdict: `web: field-only`** (net-worth trend rides existing account projection; no new web UI).

### Prompt (copy this into Copilot Chat)

```
I need account balance history snapshots in MoneyPulse so net-worth and trend charts use stored data points instead of always recomputing. Follow existing patterns.

## Schema — new table `account_balance_snapshots`

Add to `apps/api/src/db/schema.ts`:
```typescript
export const accountBalanceSnapshots = pgTable('account_balance_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  balanceCents: integer('balance_cents').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique().on(t.accountId, t.snapshotDate) }));
```

## Service: `apps/api/src/analytics/balance-snapshot.service.ts` (NEW)
- `snapshotAll()` — for each account, compute current balance (reuse the existing balance computation in `accounts.service.ts`), upsert a row for today (`ON CONFLICT (account_id, snapshot_date) DO UPDATE`).
- `backfill(accountId)` — replay transaction history to compute end-of-month (and end-of-day for the recent window) balances historically; insert snapshots. Idempotent.
- `history(userId, { accountId?, from, to })` — return the time series.

## Triggers
- Post-import hook in `ingestion.processor.ts`: after a successful import, call `snapshotAll()` for the affected user (best-effort).
- Daily scheduled job: `snapshotAll()` (follow existing scheduled-job pattern).

## Controller: add to `analytics.controller.ts`
- `GET /analytics/balance-history?accountId=&from=&to=` → `{ data }`.

## Frontend
- Update the net-worth/trend chart on the dashboard to consume `/analytics/balance-history` instead of recomputing client-side. Keep the existing chart component; just swap the data source.

## Important
- Backfill must be idempotent (NOT EXISTS / upsert — see the project's backfill lessons).
- Do NOT read .env files or secrets.

## After implementation — verification steps (MANDATORY)
### Step 1: Build. ### Step 2: Tests
- `snapshotAll` upserts one row per account per day (running twice doesn't duplicate).
- `backfill` produces monotonic month-end snapshots for a known transaction set.
- `history` returns the series within range.
### Step 3: Rubber duck — unique constraint upsert, idempotent backfill, timezone of snapshot_date.
### Step 4: Deploy. ### Step 5: Post-deploy SQL
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  CREATE TABLE IF NOT EXISTS account_balance_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    balance_cents INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(account_id, snapshot_date)
  );
  CREATE INDEX IF NOT EXISTS idx_snapshot_account ON account_balance_snapshots(account_id, snapshot_date);
"
# Then trigger a backfill via the new endpoint/command.
```
### Step 6: Manual
- [ ] Net-worth chart shows real historical points
- [ ] New import adds today's snapshot
- [ ] Backfill populates past months
```

---

## Prompt 12 — Import Deduplication Improvement (F.3)

> Make re-imports of overlapping statements graceful: external-id matching, fuzzy-window dedup, import preview, and undo-import. **Sync verdict: `web: none`** (import is a NAS-only operation).

### Prompt (copy this into Copilot Chat)

```
I need to improve MoneyPulse import deduplication. Today dedup uses txn_hash = SHA256(accountId|date|amount|description), which misses near-duplicates after reconciling/overlapping statements. Follow existing import patterns in `apps/api/src/jobs/ingestion.processor.ts` and the dedup logic.

## Enhancements

### 1. external_id matching (primary key when available)
- Add `external_id varchar(200)` to the `transactions` table (bank reference number) if not present. When the source file provides a bank reference, dedup on (account_id, external_id) FIRST — it's authoritative. Fall back to txn_hash otherwise.

### 2. Fuzzy-window dedup
- Same account + amount within ±0 (exact cents) + date within ±1 day + description similarity > 80% (Levenshtein ratio or trigram) → treat as a probable duplicate.
- Classify each incoming row as: `new` | `exact_duplicate` (skip) | `potential_conflict` (needs decision).

### 3. Import preview (before committing)
- Add a preview step: parse the file, classify every row, return `{ new: n, duplicates: n, conflicts: [{ incoming, existingCandidate }] }` WITHOUT inserting.
- New endpoint: `POST /imports/preview` (multipart) → returns the classification. The existing import endpoint gains a `?commit=true` (or a separate confirm call) that performs the insert using the preview's decisions.

### 4. Conflict resolution + import history
- New table `import_batches` (id, user_id, filename, source, row counts, created_at). Tag each inserted transaction with `import_batch_id`.
- `POST /imports/:batchId/undo` → soft-delete all transactions from that batch (set deleted_at). Idempotent.

## Frontend (NAS app)
- Import flow: after selecting a file, show the preview summary ("X new, Y duplicates will be skipped, Z conflicts"). For conflicts, show side-by-side incoming vs existing with keep/skip toggles. Confirm to commit.
- Import history list with an "Undo import" button per batch.

## Important
- Soft-delete only for undo (set deleted_at); never hard-delete imported transactions.
- Outbox: undo should emit `transaction.projected.v1` updates so web reflects the soft-deletes.
- Do NOT read .env files or secrets.

## After implementation — verification steps (MANDATORY)
### Step 1: Build. ### Step 2: Tests
- external_id present → dedup on it, ignores hash differences.
- Fuzzy: same amount, +1 day, 90%-similar description → flagged potential_conflict, not auto-inserted.
- Preview returns correct counts without inserting.
- Undo soft-deletes exactly the batch's rows and is idempotent.
### Step 3: Rubber duck — preview/commit consistency, similarity threshold, batch tagging, outbox on undo.
### Step 4: Deploy. ### Step 5: Post-deploy SQL
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id VARCHAR(200);
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id UUID;
  CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    filename VARCHAR(255), source VARCHAR(50),
    rows_new INTEGER, rows_duplicate INTEGER, rows_conflict INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_txn_external ON transactions(account_id, external_id);
  CREATE INDEX IF NOT EXISTS idx_txn_batch ON transactions(import_batch_id);
"
```
### Step 6: Manual
- [ ] Re-import an overlapping statement → preview shows duplicates as skip
- [ ] A near-duplicate shows as conflict with side-by-side
- [ ] Undo import soft-deletes the batch and web reflects it
```

---

## Prompt 13 — Weekly/Monthly Financial Digest

> Automated summary pushed to the user. Builds on Prompts 3/4/5/10. **Sync verdict: `web: summary+push`** (the digest is a notification → FCM; optional email).

### Prompt (copy this into Copilot Chat)

```
I need an automated weekly/monthly financial digest in MoneyPulse. Generate a summary (top categories, budget status, unusual charges, upcoming bills, net-worth change) and deliver via in-app notification + FCM push + optional email. Use Ollama (on my Mac) to write the natural-language summary, but degrade gracefully to a templated summary if it's offline. Follow existing patterns.

## Service: `apps/api/src/analytics/digest.service.ts` (NEW)
- `buildDigest(userId, period: 'weekly'|'monthly')`: gather top spending categories, budget progress (reuse `budgetProgress`), anomalies in the period, upcoming bills (next 7 days), net-worth change (reuse balance snapshots from Prompt 11).
- Narrative: if `ollamaHealth.isAvailable()`, ask Ollama to turn the structured data into a friendly paragraph; else fall back to a deterministic template. NEVER block on AI.
- Deliver via `NotificationsService.create({ type: 'digest', title, message })` (→ web + FCM via Prompt 6). If `notificationEmail` is set, also send email (reuse any existing mailer; if none, skip with a TODO).

## Trigger
- Scheduled job honoring the existing `weeklyDigestEnabled` user setting. Weekly on a fixed day (e.g. Monday 8am in the user's `timezone`); monthly on the 1st. Use the user's `timezone` from user_settings.

## Frontend (NAS app)
- Optional: a "Digests" view or just rely on the notification bell. Add a "Send digest now" button on the settings/dashboard for testing.

## Important
- Respect `weeklyDigestEnabled`. Degrade to template if Ollama offline. Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — buildDigest returns all sections from mock data; falls back to template when Ollama down; respects weeklyDigestEnabled. ### 3: Rubber duck — timezone scheduling, no AI block, dedupe per period. ### 4: Deploy. ### 5: No SQL. ### 6: Manual — [ ] "Send digest now" produces a notification + FCM push; [ ] content accurate; [ ] disabled setting suppresses it.
```

---

## Prompt 14 — Year-over-Year Comparison

> Compare this month vs the same month last year, by category, plus a net-worth growth timeline. Needs Prompt 11 snapshots + 12+ months of data. **Sync verdict: `web: none`** (analytical deep-dive stays on NAS).

### Prompt (copy this into Copilot Chat)

```
I need year-over-year comparison analytics in MoneyPulse. Compare a period to the same period last year by category, and show net-worth growth over time. Follow existing analytics patterns.

## Service: add to `apps/api/src/analytics/analytics.service.ts`
- `yearOverYear(userId, { month })`: for each category, sum non-transfer debits for {month, this year} vs {month, last year}; return `[{ categoryName, thisYearCents, lastYearCents, deltaCents, deltaPercent }]` sorted by absolute delta.
- `netWorthTimeline(userId, { months })`: monthly net-worth points from `account_balance_snapshots` (Prompt 11).

## Controller: add to `analytics.controller.ts`
- `GET /analytics/year-over-year?month=YYYY-MM` and `GET /analytics/net-worth-timeline?months=`.

## Frontend (NAS app)
- Hook additions in `useAnalytics.ts`.
- A YoY section (could live on an Analytics/Insights page or the budgets page): per-category bars or a table with up/down deltas ("Groceries up 12% vs May 2025"). Net-worth growth line chart.
- Gracefully handle <12 months of data ("Not enough history yet for year-over-year").

## Important — exclude is_transfer; use normalized data. Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — YoY deltas correct for a two-year mock set; insufficient-history path returns empty/flag; transfers excluded. ### 3: Rubber duck — month boundary/timezone, divide-by-zero on deltaPercent. ### 4: Deploy. ### 5: No SQL (uses snapshots from Prompt 11). ### 6: Manual — [ ] YoY shows correct deltas; [ ] net-worth timeline renders; [ ] graceful with little history.
```

---

## Prompt 15 — Home Assistant Dashboard Sensor

> Expose finance metrics as an HA-friendly REST sensor for the home dashboard. **Sync verdict: `web: none`** (HA pulls directly from the NAS on the LAN).

### Prompt (copy this into Copilot Chat)

```
I need a Home Assistant REST sensor endpoint in MoneyPulse exposing finance metrics for my home dashboard. Follow existing patterns.

## Endpoint: `GET /api/ha/sensor`
- Returns HA-friendly JSON: `{ today_spending_cents, month_spending_cents, budget_remaining_cents, account_balances: [{ name, balanceCents }], upcoming_bills: [{ name, amountCents, dueDate }], overdue_bill_count }`.
- AUTH: HA can't easily send a JWT cookie. Use a long-lived API token (header `X-HA-Token`) validated against an env var `HA_SENSOR_TOKEN`, scoped to the primary user. Do NOT expose this without the token. Rate-limit.
- Put it in a small `ha.controller.ts` (new `ha` module) — NOT behind the cookie JwtAuthGuard, but behind a dedicated token guard.

## Docs
- Provide a `docs/home-assistant.md` with: the REST sensor YAML, a template sensor example, and two automation examples (notify on big purchase, daily 9pm spending summary). Use `homeassistant.local`/LAN host placeholders, no real tokens.

## Important
- Token in env only (`HA_SENSOR_TOKEN`), never committed. This endpoint is LAN-only by deployment; document not exposing it to WAN. Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — endpoint returns 401 without/with wrong token; returns correct aggregates with valid token. ### 3: Rubber duck — token comparison constant-time-ish, no PII leakage, rate limit. ### 4: Deploy (set HA_SENSOR_TOKEN on NAS). ### 5: No SQL. ### 6: Manual — [ ] curl with token returns JSON; [ ] HA sensor populates; [ ] no token → 401.
```

---

## Prompt 16 — Tax-Ready Export

> Tag transactions as tax-deductible by tax category; export a year-end CSV/PDF with attached receipts for audit. Builds on Prompt 2 (attachments). **Sync verdict: `web: field-only`** (the tax flag rides the transaction projection; export is NAS-only).

### Prompt (copy this into Copilot Chat)

```
I need tax-ready export in MoneyPulse: tag transactions with a tax category and export a year-end report grouped by tax category, including attached receipts. Follow existing patterns.

## Schema
- Add to `transactions`: `tax_category varchar(50)` nullable (values: medical|charitable|business|education|home_office|other), `is_tax_deductible boolean default false`.

## API
- `PATCH /transactions/:id/tax` — set tax_category / is_tax_deductible (ownership-checked, Zod-validated). Emits `transaction.projected.v1`.
- `GET /tax/export?year=YYYY&format=csv|pdf` — returns transactions where is_tax_deductible=true in that tax year, grouped by tax_category, with totals. CSV: one row per txn + group subtotals. PDF: grouped report (reuse any existing PDF/report util; if none, CSV first and stub PDF).
- `GET /tax/summary?year=YYYY` — totals per tax category for a dashboard card.

## Frontend (NAS app)
- Transaction detail panel (from Prompt 2): add a "Tax" toggle + tax-category select.
- A `/tax` page: per-category deductible totals for the selected year, list of tagged transactions (with receipt links), and Export CSV/PDF buttons.
- Sidebar: `{ href: '/tax', label: 'Tax', icon: FileText }`.

## Important — receipts stay on NAS; the export bundles them by reference/path locally (optionally zip with the CSV). Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — tax tagging persists + emits outbox; export includes only deductible txns in the year, grouped with correct subtotals; ownership enforced. ### 3: Rubber duck — tax-year boundary, format validation, attachment path safety. ### 4: Deploy. ### 5: Post-deploy SQL:
```bash
ssh nas
docker exec -i moneypulse-db psql -U moneypulse -d moneypulse -c "
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_category VARCHAR(50);
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_tax_deductible BOOLEAN NOT NULL DEFAULT false;
"
```
### 6: Manual — [ ] tag a txn deductible; [ ] /tax shows totals; [ ] CSV export correct; [ ] receipts referenced.
```

---

## Prompt 17 — Subscription Manager

> Dedicated view over recurring-bill data (Prompt 3) focused on subscriptions: annual cost, price-increase flags. **Sync verdict: `web: summary+push`** (price-increase alert → FCM; subscription glance card).

### Prompt (copy this into Copilot Chat)

```
I need a Subscription Manager in MoneyPulse built on the recurring-bills data. Show service, amount, frequency, annualized cost, and flag price increases. Follow existing patterns.

## API
- Reuse `recurring_bills`. Add a derived `GET /subscriptions` that returns active recurring bills classified as subscriptions (heuristic: monthly/annual frequency + known subscription merchants, OR just expose all recurring with annualized cost). Each item: `{ name, amountCents, frequency, annualCostCents, lastAmountCents, priceIncreased: boolean, category }`.
- `annualCostCents`: monthly×12, weekly×52, etc.
- Price-increase detection: compare `last_amount_cents` vs `expected_amount_cents` (or previous occurrence). If it rose beyond tolerance, set `priceIncreased` and create a `NotificationsService.create({ type: 'subscription_price_increase', ... })` (→ FCM via Prompt 6). De-dupe per subscription per change.

## Frontend (NAS app)
- `/subscriptions` page: list with annual cost, total annual subscription spend, category breakdown, price-increase badges ("Netflix $15.99 → $17.99").
- Dashboard glance card: "Subscriptions: $X/mo ($Y/yr)".
- Sidebar: `{ href: '/subscriptions', label: 'Subscriptions', icon: Repeat }`.

## Important — no new table (derive from recurring_bills). Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — annualization math per frequency; price-increase flagged when amount rises beyond tolerance and alert de-duped; empty when no recurring bills. ### 3: Rubber duck — double-alerting, annualization rounding. ### 4: Deploy. ### 5: No SQL. ### 6: Manual — [ ] subscriptions listed with annual cost; [ ] a price bump flags + pushes; [ ] dashboard card shows monthly/annual total.
```

---

## Prompt 18 — PWA Mode + Camera Capture

> Make the NAS web app installable; enable camera receipt capture; prep for push. Pairs with Prompts 2/8 (receipts) and 6 (push). **Sync verdict: n/a (NAS web app shell).** Note: NAS is LAN-only today, so the PWA is installable/usable on the home network now; off-home use awaits Tailscale.

### Prompt (copy this into Copilot Chat)

```
I need to turn the MoneyPulse NAS web app into an installable PWA with camera receipt capture and an offline app shell. Next.js app in `apps/web`. Follow existing patterns.

## PWA basics
- `apps/web/public/manifest.json`: name, short_name, theme_color, background_color, `display: standalone`, icons 192/512.
- App icons (192x192, 512x512) + `apple-touch-icon`. Add `<link rel="manifest">`, `<meta name="theme-color">`, iOS `apple-mobile-web-app-capable` meta in the root layout.
- Service worker for an app-shell cache (cache the shell/static assets; DO NOT aggressively cache API data — the NAS may be unreachable off-LAN). Use `next-pwa` or a hand-written SW; keep it minimal.

## Camera capture
- Receipt upload button uses `<input type="file" accept="image/*" capture="environment">` on mobile → opens the camera → uploads to the watch-folder/attachment pipeline (Prompts 2/8). Preview before submit.

## Offline shell
- Cache last dashboard payload in IndexedDB; when the NAS is unreachable show stale data with a "Last updated X ago" badge; auto-refresh on reconnect.

## (Optional, document only) PIN/biometric lock
- Note WebAuthn / PIN auto-lock as a follow-up; do not fully implement unless quick.

## Important — do NOT cache sensitive API responses beyond the IndexedDB stale-dashboard shell; clear on logout. Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — manifest served, SW registers (or a smoke test of the offline cache util). ### 3: Rubber duck — no sensitive data over-cached, logout clears cache, iOS meta present. ### 4: Deploy. ### 5: No SQL. ### 6: Manual — [ ] "Add to Home Screen" works on phone (on home network); [ ] camera capture opens + uploads a receipt; [ ] offline shows stale dashboard with timestamp.
```

---

## Prompt 19 — Quick-Add Transaction Widget

> Fast manual transaction entry from the PWA/dashboard. Builds on Prompt 18. **Sync verdict: `web: field-only`** (manual txn rides the transaction projection).

### Prompt (copy this into Copilot Chat)

```
I need a quick-add manual transaction widget in MoneyPulse. Follow existing patterns.

## API
- Reuse the existing create-transaction path; ensure it accepts `isManual: true`. If a manual-create endpoint doesn't exist, add `POST /transactions` (Zod-validated: amountCents, merchant, categoryId?, date default today, accountId). Emits `transaction.projected.v1` (already wired in transactions.service).

## Frontend (NAS app)
- Floating "+" FAB on mobile (and a button on the dashboard). Minimal form: amount, merchant, category typeahead (reuse the existing category combobox), date (default today), account select. Optional: snap a receipt inline (Prompt 18 capture → attaches via Prompt 2).
- On submit, invalidate `['transactions']` and relevant analytics queries.

## Important — runs through normal categorization/normalization (rule engine + best-effort AI). Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — manual create persists with isManual=true + emits outbox; validation rejects bad input. ### 3: Rubber duck — account ownership, date/timezone, optimistic UI. ### 4: Deploy. ### 5: No SQL (unless isManual column missing — then add it). ### 6: Manual — [ ] FAB opens form; [ ] add a txn; [ ] appears in list + analytics; [ ] optional receipt attaches.
```

---

## Prompt 20 — Spending Streaks & Gamification

> Lightweight behavioral nudges tied to real budgets. Builds on Prompt 5. **Sync verdict: `web: summary+push`** (streak milestone → optional FCM; streak glance on dashboard).

### Prompt (copy this into Copilot Chat)

```
I need lightweight spending streaks / gamification in MoneyPulse, tied to real budget goals (not vanity points). Follow existing patterns.

## Service: `apps/api/src/analytics/streaks.service.ts` (NEW)
- `computeStreaks(userId)`:
  - No-spend-day streak: consecutive days (ending today) with zero non-transfer discretionary debits.
  - Under-budget streak per category: consecutive periods within budget (reuse budgetProgress).
  - Savings milestones: net-worth increase thresholds (reuse balance snapshots, Prompt 11).
- Return `{ noSpendStreakDays, underBudgetStreaks: [{ category, periods }], milestones: [...] }`.

## Controller: add `GET /analytics/streaks` to analytics.controller.

## Notifications (optional, opt-in)
- On a streak milestone (e.g. 5 consecutive no-spend days), `NotificationsService.create({ type: 'streak', ... })` (→ FCM via Prompt 6). De-dupe per milestone. Keep it gentle/infrequent.

## Frontend (NAS app)
- Dashboard streak card: "🔥 5 no-spend days", under-budget streaks, latest milestone badge.

## Important — must reflect REAL budget/spend data, not arbitrary points. Opt-in pushes. Do NOT read .env or secrets.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — no-spend streak counts consecutive zero-debit days correctly; breaks on a spend day; under-budget streak per category; milestone de-duped. ### 3: Rubber duck — timezone day boundaries, transfer exclusion, off-by-one on streaks. ### 4: Deploy. ### 5: No SQL. ### 6: Manual — [ ] streak card shows on dashboard; [ ] a no-spend day increments; [ ] a milestone (opt-in) pushes once.
```

---

## Prompt 21 — moneypulse-web PWA (installable + iOS background push)

> **Why**: Today web notifications only show when you have the app open. Prompt 6b makes the server SEND a push; this prompt makes moneypulse-web an **installable PWA** so pushes land like a native app notification — and so iOS (16.4+) web push works at all (it requires the site be added to the Home Screen). **Web repo only — there is no NAS half.** Run from `~/repo/moneypulse-web`.

### Prompt 21 (copy this into Copilot Chat with `~/repo/moneypulse-web` open)

```
I need to turn moneypulse-web into an installable PWA so FCM push notifications behave like native app notifications (especially on iOS, which only allows web push for Home-Screen-installed PWAs). Follow this repo's TDD mandate, data-boundary contract, and existing patterns (see CLAUDE.md). The Next.js app is in apps/web; the messaging service worker already exists at apps/web/public/firebase-messaging-sw.js.

## 1. Web app manifest
- Add `apps/web/public/manifest.webmanifest`: name "MoneyPulse", short_name "MoneyPulse", `display: standalone`, theme_color/background_color matching the app theme, `start_url: "/"`, scope "/", and icons (192x192, 512x512, plus a 512 maskable). Add the icon PNGs under `apps/web/public/icons/`.
- Link it in the root layout `<head>` (apps/web/src/app/layout.tsx or equivalent): `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color">`, and iOS tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` (180x180).

## 2. Service worker coexistence
- The app already registers `/firebase-messaging-sw.js` (see apps/web/src/lib/fcm/use-fcm-token.ts). Ensure that SW handles `onBackgroundMessage` → `self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', data })` and a `notificationclick` listener that opens/focuses `/notifications`. Add these if missing.
- Keep ONE service worker (the firebase-messaging SW). If you add app-shell caching, do it inside the same SW or a clearly separate scope — do NOT cache authenticated API/Firestore responses. Clear caches on logout.

## 3. Install affordance + iOS guidance
- Add a small "Install app" prompt/button (listen for `beforeinstallprompt` on Android/desktop). For iOS, show brief "Add to Home Screen" instructions since iOS has no install event.
- After install on iOS, the existing `useFcmToken` permission/token flow should run inside the installed PWA context.

## Data boundary (non-negotiable, per CLAUDE.md)
- The manifest/icons contain NO user data. Do not cache PII. No reverse-sync. No secrets in code (Firebase web config is public env only).

## Verification (MANDATORY — pnpm test then pnpm build)
### Tests — manifest is served and well-formed; SW registers; (if added) cache layer excludes Firestore/auth responses; logout clears caches.
### Rubber duck (/rubber-duck) — single SW, no sensitive caching, iOS meta present, install prompt degrades gracefully.
### Deploy — `firebase deploy --only hosting` (and functions if SW changes need it).
### Manual
- [ ] Android Chrome: "Install app" works; app opens standalone
- [ ] iOS Safari: Add to Home Screen; open installed app; grant notifications
- [ ] With app CLOSED/backgrounded: a NAS-triggered notification (Prompt 6) arrives as a system push
- [ ] Tapping the push opens the notifications view
```

---

## Prompt 22 — Web Bills Glance (`bill.projected.v1`) — OPTIONAL

> **Why optional**: Bills are detected/managed on the NAS (Prompt 3, done). Missed-bill *alerts* already reach the phone via the Prompt 6 notification backbone. This adds a read-only "upcoming bills" glance to moneypulse-web so you can see the schedule (not just alerts) when away. Net-new on both sides → two blocks. **Sync verdict: `web: summary` (read-only projection, no push of its own).**
>
> **Run 22a from `~/repo/MyMoney`, then 22b from `~/repo/moneypulse-web`.**

### Prompt 22a — NAS side (copy into Copilot Chat with `~/repo/MyMoney` open)

```
I need MoneyPulse to project confirmed recurring bills to the sync outbox so the moneypulse-web companion can show an upcoming-bills glance. Follow existing patterns (see how `sync.controller.ts` shapes `transaction.projected.v1` with `aliasMapper.toAliasId`, and how `bills.service.ts` already works). Do NOT read .env or include secrets.

## Context (verify)
- `recurring_bills` table (schema.ts ~line 343): id, userId, merchantPattern, normalizedName, categoryId, expectedAmountCents, amountTolerancePercent, frequency, nextExpectedDate, lastSeenDate, lastAmountCents, isActive, isConfirmed, createdAt, updatedAt.
- `apps/api/src/bills/bills.service.ts` already manages bills and already injects `NotificationsService`. It does NOT currently emit outbox events.
- Aliasing/userAliasId is auto-added at delivery; producers set entity aliases via `AliasMapperService.toAliasId(...)`.

## Emit `bill.projected.v1`
Inject `OutboxService` + `AliasMapperService` into `BillsService`. Add a private best-effort helper and call it whenever a bill becomes (or stays) confirmed & active — i.e. at the end of `confirm()`, `update()`, and after detection upserts that produce a confirmed bill:

private async projectBill(bill: RecurringBillRow): Promise<void> {
  if (!bill.isActive || !bill.isConfirmed) return; // only project live, confirmed bills
  try {
    await this.outbox.enqueue({
      eventType: 'bill.projected.v1',
      aggregateType: 'recurring_bill',
      aggregateId: bill.id,
      userId: bill.userId,                          // → userAliasId at delivery
      payload: {
        billAliasId: this.aliasMapper.toAliasId('bill', bill.id),
        normalizedName: bill.normalizedName,
        amountCents: bill.expectedAmountCents,
        frequency: bill.frequency,
        nextExpectedDate: bill.nextExpectedDate ? new Date(bill.nextExpectedDate).toISOString() : null,
        categoryId: bill.categoryId ?? null,
      },
    });
  } catch (err) { this.logger.warn(`bill projection enqueue failed: ${(err as Error).message}`); }
}

NOTES:
- Best-effort: never wrap the enqueue in a tx around the domain write (same rule as transactions/notifications).
- When a bill is deactivated/deleted, emit `bill.projected.v1` with a `deleted: true` flag (or a separate `bill.deleted.v1` — pick the simplest the web can honor; 22b removes the doc on that signal). Keep the chosen contract consistent.
- The sanitizer (`sanitizer-v2.service.ts`) will police the payload. `normalizedName` is allowed (sanitized merchant data), no PII.

## Verification (MANDATORY)
### 1: Build. ### 2: Tests — confirming a bill enqueues a `bill.projected.v1` event with `billAliasId`/`normalizedName`/`amountCents`/`frequency`/`nextExpectedDate`; an unconfirmed or inactive bill is NOT projected; deactivate emits the delete signal; enqueue failure does not roll back the bill write. ### 3: Rubber duck — only confirmed+active projected, alias used, best-effort. ### 4: Deploy `./deploy-to-nas.sh`. ### 5: No SQL. ### 6: Manual — [ ] confirm a bill → Sync Admin shows `bill.projected.v1` delivered; [ ] doc lands in Firestore (after 22b).
```

### Prompt 22b — Web side (copy into Copilot Chat with `~/repo/moneypulse-web` open)

```
I need moneypulse-web to consume `bill.projected.v1` and show a read-only upcoming-bills glance. Follow this repo's TDD mandate + data-boundary contract (CLAUDE.md) and mirror the EXISTING budgets projection exactly (fanOutBudget, the budgets Firestore rule, use-budgets hook). Read specs/ first.

## 1. Fan-out (functions/src/index.ts)
Add `fanOutBill(db, body)` mirroring `fanOutBudget`, and an `else if (req.body.eventType === 'bill.projected.v1')` branch in `ingestSyncEvent`:
- Require `billAliasId` + `userAliasId` (string) else return.
- If `body.deleted === true` → `db.collection('bills').doc(`${userAliasId}_${billAliasId}`).delete()` and return.
- Else upsert `db.collection('bills').doc(`${userAliasId}_${billAliasId}`).set({ billAliasId, normalizedName, amountCents, frequency, nextExpectedDate (string|null), categoryId (string|null), userAliasId, syncedAt: serverTimestamp() })`.
Use the Admin SDK (bypasses rules), same as the other fan-outs.

## 2. Firestore rules (firestore.rules)
Add a block mirroring the `budgets` rule — read-only from browser, writes denied:
  match /bills/{billDocId} {
    allow read: if request.auth != null && resource.data.userAliasId == request.auth.uid;
    allow write: if false;
  }

## 3. Index (firestore.indexes.json)
Add a composite index: collectionGroup `bills`, fields `userAliasId` ASC + `nextExpectedDate` ASC.

## 4. Types + hook
- Add `BillDoc` to `apps/web/src/lib/types/firestore.ts`.
- Add `apps/web/src/lib/queries/use-bills.ts` mirroring `use-budgets.ts`: query `collection(db, 'bills')` where `userAliasId == uid`, ordered/sorted by `nextExpectedDate`.

## 5. UI (essentials glance — NOT management)
- Add an "Upcoming Bills" card to the dashboard (and/or a `/bills` read-only route under `(dashboard)`): list next bills with normalizedName, amount (cents → currency), frequency, days-until-due; show an overdue count badge (nextExpectedDate in the past). NO add/edit/confirm/delete — management stays on the NAS.

## Data boundary (CLAUDE.md) — only alias-based ids + sanitized merchant name + amount/frequency/date. No raw account data. No reverse sync. No browser writes to `bills`.

## Verification (MANDATORY — pnpm test then pnpm build)
### Tests — fanOutBill upserts the doc with the right fields; `deleted:true` removes it; rules deny browser writes to bills and cross-user reads; use-bills returns sorted bills. ### Rubber duck (/rubber-duck) — read-only collection, index present, no PII. ### Deploy — `firebase deploy --only functions,firestore:rules,firestore:indexes,hosting`. ### Manual — [ ] confirm a bill on NAS → appears in web Upcoming Bills; [ ] overdue bill shows the badge; [ ] deactivating on NAS removes it from web.
```

---

## Prompt 23 — Send Test Notification (Settings button)

> **Why**: There's no one-click way to verify the notification pipeline (in-app bell → outbox → FCM push → HA voice/webhook). Today you must import a >$500 debit to trigger an anomaly. This adds a Settings button that fires a dummy notification through the **real** `NotificationsService.createAndDispatch` chokepoint — so it exercises the entire stack at once. **Sync verdict: `web: none`** (the test notification rides the existing `notification.projected.v1` projection, so it also validates FCM + HA automatically — that's the point).

### Prompt (copy this into Copilot Chat with `~/repo/MyMoney` open)

```
I need a "Send test notification" feature in MoneyPulse to verify the full notification pipeline (in-app bell, outbox → FCM push, HA webhook/voice) with one click. It must go through the existing NotificationsService.createAndDispatch chokepoint so it exercises the real path. Follow existing patterns exactly. Do NOT read .env or include secrets.

## API: add an endpoint to `apps/api/src/notifications/notifications.controller.ts`

Match the existing controller patterns (it uses `@Controller('notifications')`, `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`, `@ApiOperation`, and wraps responses in `{ data }`).

Add:

@Post('test')
@HttpCode(200)
@ApiOperation({ summary: 'Send a test notification through the full pipeline' })
async sendTest(@CurrentUser() user: AuthTokenPayload) {
  const notification = await this.notificationsService.createAndDispatch({
    userId: user.sub,
    type: 'test',
    title: 'MoneyPulse test',
    message: `Test notification sent at ${new Date().toLocaleTimeString()}.`,
  });
  return { data: { id: notification.id } };
}

- `createAndDispatch(input)` already exists and takes `{ userId, type, title, message, metadata? }`. It inserts the row, best-effort enqueues `notification.projected.v1` (→ web/FCM), and best-effort fires the HA webhook. Reuse it AS-IS — do not duplicate that logic.
- No new Zod schema needed (no request body). Keep it `@UseGuards(JwtAuthGuard)` like the rest of the controller (current user only — not admin-restricted, since it only creates the caller's own notification).

## Frontend: add a button to the MoneyPulse web Settings page

Find the existing settings page under `apps/web/src/app/(protected)/settings/` (the one with the HA webhook URL field). Add a small "Notifications" / "Diagnostics" section with a **"Send test notification"** button.

- Add a hook in `apps/web/src/lib/hooks/useNotifications.ts` (or the existing notifications hook file): `useSendTestNotification()` — a `useMutation` that POSTs to `/notifications/test` and on success invalidates `['notifications']` and `['notifications','unread-count']` so the bell updates.
- Button behavior: on click, call the mutation; show a transient success message like "Test sent — check your phone, Home Assistant, and the bell." and a failure message on error. Use the existing button/feedback styling on that page.
- Place it near the HA webhook URL setting so it reads as "configure webhook → test it".

## Important
- This intentionally hits the SAME code path as real alerts, so a successful test proves the in-app bell, the outbox projection (FCM push on the web companion), and the HA webhook/voice all work.
- Type is `test` — the HA automation announces it by default (no `moneypulse_mute_test` toggle exists), which is the desired behavior for a test.
- Do NOT bypass createAndDispatch (e.g., don't insert directly or call the webhook directly) — the whole value is testing the real chokepoint.

## After implementation — verification (MANDATORY)

### Step 1: Build — `pnpm build`, fix all TS errors.
### Step 2: Tests
- Controller test: `POST /notifications/test` calls `notificationsService.createAndDispatch` with `{ userId: <caller>, type: 'test', ... }` and returns `{ data: { id } }`.
- Ownership: the created notification uses the authenticated user's id (not a passed-in one).
### Step 3: Rubber duck — reuses createAndDispatch (no duplicated dispatch logic), guarded by JwtAuthGuard, response shape `{ data }`, hook invalidates the bell queries.
### Step 4: Deploy — `./deploy-to-nas.sh`.
### Step 5: No SQL migration (uses existing notifications table).
### Step 6: Manual test checklist
- [ ] Settings page shows a "Send test notification" button
- [ ] Click it → success message appears
- [ ] Notification bell shows the "MoneyPulse test" alert
- [ ] Sync Admin shows a `notification.projected.v1` event delivered
- [ ] Phone receives the FCM push (if a device token exists)
- [ ] Home Assistant speaks it + creates a persistent notification (if not quiet hours)
```

---

## Prompt 24 — Fix: web KPIs exclude transfers (`isTransfer` projection)

> **The bug**: The NAS dashboard excludes transfer/credit-card-payment categories from income/expense (Tier 0.3 `is_transfer` fix — `AND COALESCE(c.is_transfer, false) = false` throughout `analytics.service.ts`). The moneypulse-web companion does **not**: `use-kpis.ts` sums *all* credits as income and *all* debits as expenses, so both are inflated by transfer amounts (observed: web Income $7,936 / Expenses $7,436 vs NAS $7,100 / $6,097). Root cause: the sync projection never carries the transfer flag, and `TransactionDoc`/`fanOutTransaction` have no `isTransfer` field.
>
> **The fix**: denormalize `isTransfer` onto each projected transaction (NAS), persist + filter it on the web. **Two blocks; deploy both, then re-sync.** Sync verdict: this corrects an existing projection field.

### Prompt 24a — NAS side (copy into Copilot Chat with `~/repo/MyMoney` open)

```
I need MoneyPulse to include an `isTransfer` flag on every `transaction.projected.v1` sync payload, so the moneypulse-web companion can exclude transfer/credit-card-payment categories from income/expense (matching the NAS analytics). The flag comes from the transaction's category: categories.is_transfer (COALESCE false); a transaction with no category is not a transfer. Follow existing patterns. Do NOT read .env or include secrets.

## Add `isTransfer` to ALL three places that emit transaction.projected.v1

1. `apps/api/src/sync/sync.controller.ts` (backfill/replay, ~line 175-220):
   - The SELECT that loads transactions must LEFT JOIN categories to read is_transfer, e.g. add `COALESCE(c.is_transfer, false) AS is_transfer` and `LEFT JOIN categories c ON c.id = t.category_id`.
   - Add `is_transfer: boolean` to the row type.
   - Add `isTransfer: txn.is_transfer` to the payload object (next to isCredit).

2. `apps/api/src/transactions/transactions.service.ts` (manual create ~line 80-95 and update ~line 300-310 enqueue):
   - When building the projected payload, include `isTransfer`. Derive it from the transaction's category is_transfer. If the category isn't already loaded, look it up (SELECT is_transfer FROM categories WHERE id = categoryId); null/absent category → false.

3. `apps/api/src/jobs/ingestion.processor.ts` (the transaction.projected.v1 emit after import, ~line 552):
   - Same: include `isTransfer` derived from the category's is_transfer.

Keep the existing best-effort/no-rollback behavior. Do not change unrelated payload fields.

## Tests
- The backfill query result includes is_transfer and the payload carries `isTransfer` (true for a transfer-category txn, false otherwise, false when category is null).
- Manual create/update and ingestion emit include isTransfer.

## After implementation — verification (MANDATORY)
### 1: Build — pnpm build, fix all TS errors.
### 2: Tests (above) pass.
### 3: Rubber duck — COALESCE false default; null category → false; all 3 emit sites updated; no other payload fields changed.
### 4: Deploy — ./deploy-to-nas.sh
### 5: No SQL migration (is_transfer column already exists on categories).
### 6: RE-SYNC existing transactions (critical — existing Firestore docs lack the field):
   - Deploy 24b FIRST (so the web fan-out persists isTransfer), THEN trigger a re-projection of ALL transactions from the Sync Admin page — use **Replay** (not Backfill: backfill's NOT EXISTS skips already-synced txns). This re-emits every transaction.projected.v1 with the new isTransfer, and fanOutTransaction's .set() overwrites each web doc.
   - Verify in the Firestore console that transaction docs now have `isTransfer`.
```

### Prompt 24b — Web side (copy into Copilot Chat with `~/repo/moneypulse-web` open)

```
I need moneypulse-web to store and respect an `isTransfer` flag on transactions so income/expense KPIs exclude transfers (matching the NAS app). The NAS now sends `isTransfer` on transaction.projected.v1 (Prompt 24a). Follow this repo's patterns + data-boundary contract (CLAUDE.md). Read specs/ first.

## 1. Persist the field — functions/src/index.ts → fanOutTransaction
In the transactions doc `.set(...)`, add:
  isTransfer: body.isTransfer === true,
(mirrors how isCredit/isManual are read.) No other fan-out changes.

## 2. Type — apps/web/src/lib/types/firestore.ts
Add `isTransfer?: boolean;` to `TransactionDoc`.

## 3. Exclude transfers from KPIs — apps/web/src/lib/queries/use-kpis.ts
Before the income/expenses reduce, filter out transfers (treat a missing field as NOT a transfer, so older un-resynced docs still behave):
  const spendable = transactions.filter((t) => !t.isTransfer);
  const income = spendable.filter((t) => t.isCredit).reduce((s, t) => s + t.amountCents, 0);
  const expenses = spendable.filter((t) => !t.isCredit).reduce((s, t) => s + t.amountCents, 0);

## 4. Same exclusion anywhere else that aggregates transactions
Find Spending-by-Category and Top-Merchants computations (e.g. apps/web/src/components/dashboard/spending-by-category.tsx and any use-transactions-based aggregation) and apply the same `!t.isTransfer` filter so they match the NAS (which also excludes is_transfer there).

## Important
- Client-side `!t.isTransfer` (not a Firestore `where`) — older docs may lack the field until the NAS re-sync (Prompt 24a step 6) completes; falsy = included, which is correct for non-transfers.
- Data boundary unchanged: isTransfer is a boolean derived flag, no PII.

## Verification (MANDATORY — pnpm test then pnpm build)
### Tests — fanOutTransaction persists isTransfer; useKpis excludes isTransfer txns (mock a transfer credit + normal credit → income counts only the normal one); missing isTransfer is treated as included.
### Rubber duck (/rubber-duck) — KPIs + category + merchants all filter transfers; no Firestore where on isTransfer (avoids dropping un-resynced docs).
### Deploy — firebase deploy --only functions,hosting
### Manual — after the NAS re-sync: web Income/Expenses/Cash Flow match the NAS dashboard for the same month.
```

> **Run order**: deploy **24b** (so `fanOutTransaction` stores the field) → deploy **24a** → **Replay** all transactions from Sync Admin → web numbers should now match the NAS.

---

## General Tips for Copilot

1. **If Copilot creates a file but misses an import**: Tell it "You forgot to import X from Y in the file Z"
2. **If module registration is wrong**: Tell it "Register {ServiceName} in the providers array of {ModuleName} in {file path}"
3. **If the build fails**: Paste the error message and say "Fix this TypeScript error in {file}"
4. **If styles look wrong**: Say "Use the same CSS pattern as {existing page} for the {element}"
5. **Run `pnpm build` after each feature** to catch TypeScript errors before deploying
6. **Always test locally first** with `pnpm dev` if possible before deploying to NAS
