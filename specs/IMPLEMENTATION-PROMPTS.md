# MoneyPulse — Implementation Prompts & Execution Guide

> **Purpose**: Crystal-clear prompts for GitHub Copilot (or any AI model) to implement Phase 10 features.
> **How to use**: Copy each prompt into GitHub Copilot Chat in VS Code (with the workspace open). After each feature, follow the deployment steps.
> **Constraint**: Never read or write secrets to .env files or code — both repos are public.

---

## Execution Order

| # | Feature | Prompt | Deploy Steps |
|---|---------|--------|--------------|
| 1 | Merchant Aliases UI | [Prompt 1](#prompt-1--merchant-aliases-management-page) | Deploy + seed |
| 2 | Receipt/Bill Attachment | [Prompt 2](#prompt-2--receiptbill-attachment-on-transactions) | Deploy + SQL migration |
| 3 | Recurring Bill Detection | [Prompt 3](#prompt-3--recurring-bill-detection--missed-payment-alerts) | Deploy + SQL migration |
| 4 | Spending Anomaly Alerts | [Prompt 4](#prompt-4--spending-anomaly-alerts) | Deploy only |
| 5 | Budget vs Actual Dashboard | [Prompt 5](#prompt-5--budget-vs-actual-variance-dashboard) | Deploy only |

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

## General Tips for Copilot

1. **If Copilot creates a file but misses an import**: Tell it "You forgot to import X from Y in the file Z"
2. **If module registration is wrong**: Tell it "Register {ServiceName} in the providers array of {ModuleName} in {file path}"
3. **If the build fails**: Paste the error message and say "Fix this TypeScript error in {file}"
4. **If styles look wrong**: Say "Use the same CSS pattern as {existing page} for the {element}"
5. **Run `pnpm build` after each feature** to catch TypeScript errors before deploying
6. **Always test locally first** with `pnpm dev` if possible before deploying to NAS
