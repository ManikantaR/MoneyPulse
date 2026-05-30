# MoneyPulse — Phase 10: Feature Enhancement Spec

> **Status**: Planning  
> **Created**: 2026-05-28  
> **Repos**: `~/repo/MyMoney` (NAS app), `~/repo/moneypulse-web` (Firebase companion)  
> **Constraint**: No secrets in code or .env files committed to Git (public repos)

---

## Architecture Principle

- **MyMoney (NAS)** = source of truth + heavy processing (AI, OCR, full data, all writes)
- **moneypulse-web (Firebase)** = read-only projection + cloud-only overlays (FCM push, preferences, saved filters)
- All sensitive data stays on NAS. Web gets sanitized projections via the existing outbox sync pipeline.
- OCR and AI run on-device via Ollama — no data leaves the NAS.

---

## Tier 0 — Quick Fixes (deploy now)

### 0.1 Big Spends card showing smallest transactions
- **Repo**: MyMoney
- **File**: `apps/web/src/app/(protected)/page.tsx`
- **Fix**: Changed `sortOrder: 'asc'` to `'desc'`, added `isCredit: 'false'` filter
- [x] Fix applied

### 0.2 isCredit filter coercing "false" to true
- **Repo**: MyMoney
- **File**: `packages/shared/src/validation/index.ts`
- **Fix**: `z.coerce.boolean()` → `z.enum(['true','false']).transform(v => v === 'true')`
- [x] Fix applied

### 0.3 Transfer categories excluded from income/expense
- **Repo**: MyMoney
- **Files**: `apps/api/src/db/schema.ts`, `apps/api/src/analytics/analytics.service.ts`, seed constants
- **Fix**: Added `is_transfer` boolean to categories table. "Credit Card Payment" and "Transfers" flagged. Analytics queries exclude `is_transfer = true` from income/expense/category breakdown/top merchants.
- [x] Schema updated
- [x] Analytics queries updated
- [x] Seed updated
- [ ] Run SQL on NAS: `UPDATE categories SET is_transfer = true WHERE name IN ('Credit Card Payment', 'Transfers');`

### 0.4 Starting balance reconciliation
- **Repo**: MyMoney
- **Files**: `apps/api/src/accounts/accounts.service.ts`, `accounts.controller.ts`, accounts page
- **Fix**: Added `POST /accounts/:id/reconcile` endpoint + UI with pencil edit button on Accounts page
- [x] API endpoint added
- [x] UI reconcile modal added
- [ ] Reconcile each account on NAS after deploy

### 0.5 Credit card payment monthly table (dashboard)
- **Repo**: MyMoney + moneypulse-web
- **Description**: New dashboard section showing monthly credit card payments per card. Query transactions with `is_transfer = true` categories, group by account + month.
- **Files to create/modify**:
  - [x] `apps/api/src/analytics/analytics.service.ts` — add `creditCardPayments()` method
  - [x] `apps/api/src/analytics/analytics.controller.ts` — add `GET /analytics/cc-payments` endpoint
  - [x] `apps/web/src/lib/hooks/useAnalytics.ts` — add `useCreditCardPayments()` hook
  - [x] `apps/web/src/components/charts/CreditCardPaymentsTable.tsx` — new component
  - [x] `apps/web/src/app/(protected)/page.tsx` — add section to dashboard
  - [ ] Sync to moneypulse-web via outbox (projected data)
  - [ ] `moneypulse-web/apps/web` — add matching component using Firestore queries

---

## Tier 1 — High-Impact Features

### 1.1 Receipt / Bill Attachment on Transactions

Attach receipts, bills, invoices (PDF/image) to any transaction. Stored locally on NAS. Searchable.

**Use cases**: warranty claims, tax deductions, expense disputes, insurance claims.

**Industry reference**: Cashlytics, Expensify, Firefly III

#### Schema Changes (MyMoney)
- [ ] New table `transaction_attachments`:
  ```
  id: uuid PK
  transaction_id: uuid FK → transactions
  user_id: uuid FK → users
  filename: varchar(255)
  original_filename: varchar(255)
  mime_type: varchar(100)
  size_bytes: integer
  storage_path: varchar(500) — local NAS path
  created_at: timestamp
  ```
- [ ] Add to shared types: `TransactionAttachment` interface

#### Two Entry Paths (converge into one pipeline)

**Path A — Manual Upload (precision)**
User is looking at a transaction → clicks "Attach Receipt" → uploads file → directly linked. No matching needed.

**Path B — Watch Folder (convenience)**
User drops receipt into `/config/receipts/incoming/` (via SMB share, phone sync, NAS app) → file watcher picks it up → moves to staging → Ollama vision OCR extracts merchant/date/amount → auto-match attempt against transactions → if confident: auto-link + notify user → if uncertain: queue for review.

**Inspired by**: DocuPulse (`~/repo/smartocrprocess`) uses this exact pattern: incoming → processing → pending_review/completed. We reuse the architecture but replace Tesseract with Ollama vision and match against MoneyPulse transactions instead of DocuPulse vendor rules.

#### Schema Changes
- [ ] `transaction_attachments` table (as above)
- [ ] `receipt_queue` table for watch folder staging:
  ```
  id: uuid PK
  user_id: uuid FK
  original_filename: varchar(255)
  staging_path: varchar(500)
  status: enum('processing', 'matched', 'pending_review', 'linked', 'failed')
  ocr_merchant: varchar(200) nullable
  ocr_date: date nullable
  ocr_amount_cents: integer nullable
  ocr_confidence: real nullable
  matched_transaction_id: uuid FK nullable
  match_candidates: jsonb nullable — top 3 candidate txn IDs with scores
  error_message: text nullable
  created_at: timestamp
  updated_at: timestamp
  ```

#### API Endpoints (MyMoney)
- [ ] `POST /transactions/:id/attachments` — manual upload (multipart), direct link
- [ ] `GET /transactions/:id/attachments` — list attachments for a transaction
- [ ] `GET /attachments/:id/download` — download file
- [ ] `DELETE /attachments/:id` — remove attachment
- [ ] `GET /receipts/queue` — list pending review items
- [ ] `POST /receipts/queue/:id/link` — confirm match to a transaction
- [ ] `POST /receipts/queue/:id/dismiss` — dismiss unmatched receipt

#### Watch Folder Service
- [ ] `apps/api/src/receipts/receipt-watcher.service.ts` — file watcher on `/config/receipts/incoming/`
- [ ] File stability check (wait for write to complete, same as DocuPulse)
- [ ] Move to staging: `/config/receipts/staging/{uuid}_{filename}`
- [ ] Trigger OCR + matching pipeline

#### Matching Algorithm
- [ ] Date match: receipt date within ±3 days of transaction date
- [ ] Amount match: receipt total within ±5% of transaction amount
- [ ] Merchant match: fuzzy string match (Levenshtein or Ollama) between OCR merchant and transaction merchant/description
- [ ] Confidence scoring: high (all 3 match) → auto-link, medium (2 of 3) → suggest, low → pending review
- [ ] Auto-link threshold: configurable (default: confidence > 0.85)

#### Frontend (MyMoney NAS app)
- [ ] Attachment upload button on transaction detail/row (Path A)
- [ ] Thumbnail/icon preview for attached files
- [ ] Click to view/download
- [ ] Attachment count badge on transaction row
- [ ] Receipt Review page: `/receipts` — shows pending queue with OCR results + match candidates
- [ ] "Link to transaction" dropdown with top matches pre-selected
- [ ] Bulk review: approve/dismiss multiple receipts

#### Storage
- [ ] Files stored at `/config/attachments/{userId}/{transactionId}/{filename}`
- [ ] Staging at `/config/receipts/staging/`
- [ ] Processed moved to attachments folder once linked
- [ ] Max file size: 10MB per file
- [ ] Allowed types: PDF, PNG, JPG, JPEG, HEIC, WEBP

#### Sync to Web (moneypulse-web)
- [ ] Attachment metadata synced via outbox (not the file itself — files stay on NAS)
- [ ] Web app shows "has attachment" indicator
- [ ] Receipt count badge on dashboard

---

### 1.2 Recurring Bill Detection + Missed Payment Alerts

Auto-detect recurring charges and alert when expected bills are missing.

**Industry reference**: Monarch's recurring calendar, Rocket Money's bill detection, Wallos

#### Detection Algorithm
- [ ] Scan transaction history for patterns:
  - Same merchant/description appearing at regular intervals (monthly, quarterly, annual)
  - Similar amounts (within 15% tolerance for variable bills like utilities)
  - Minimum 2 occurrences to establish pattern
- [ ] Store detected recurring patterns:
  ```
  recurring_bills table:
    id: uuid PK
    user_id: uuid FK
    merchant_pattern: varchar — regex or exact match
    category_id: uuid FK nullable
    expected_amount_cents: integer
    amount_tolerance_percent: integer (default 15)
    frequency: enum('weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual')
    next_expected_date: date
    last_seen_date: date
    last_amount_cents: integer
    is_active: boolean
    is_confirmed: boolean — user confirmed this is recurring
    created_at: timestamp
    updated_at: timestamp
  ```

#### Bills Page (MyMoney NAS app)
- [ ] List all detected + confirmed recurring bills
- [ ] Show: merchant, amount, frequency, next due date, status (paid/upcoming/overdue)
- [ ] Calendar view of upcoming bills
- [ ] Manual add/edit/disable recurring bill
- [ ] "Confirm" button for auto-detected patterns

#### Missed Payment Alerts
- [ ] Daily cron job checks: for each active recurring bill, if `next_expected_date` has passed and no matching transaction found within tolerance window (±3 days):
  - Create persistent notification in the app
  - Send Home Assistant webhook notification
  - Send FCM push notification (via sync to moneypulse-web)
- [ ] Alert levels:
  - **Warning**: bill is 3 days overdue
  - **Critical**: bill is 7+ days overdue

#### Frontend Components
- [ ] `apps/web/src/app/(protected)/bills/page.tsx` — Bills page
- [ ] `apps/web/src/components/BillCard.tsx` — individual bill card
- [ ] `apps/web/src/components/BillCalendar.tsx` — calendar view
- [ ] Dashboard widget showing upcoming bills (next 7 days)

#### Notifications
- [ ] Extend existing `notifications` table and `alert-engine.service.ts`
- [ ] New alert types: `bill_upcoming`, `bill_overdue`, `bill_missed`
- [ ] HA webhook integration (already wired in settings: `haWebhookUrl`)
- [ ] FCM push via sync pipeline to moneypulse-web

#### Sync to Web (moneypulse-web)
- [ ] Recurring bill metadata synced via outbox
- [ ] Bill status updates synced
- [ ] FCM notifications for missed bills
- [ ] Web app Bills page (read-only projection)

---

### 1.3 Spending Anomaly Alerts

Flag unusual transactions proactively.

**Industry reference**: Copilot's "Intelligence" platform, PocketGuard alerts

#### Detection Rules
- [ ] **Amount anomaly**: Transaction amount > 3x the user's average for that merchant or category
- [ ] **Duplicate detection**: Same merchant + similar amount (±5%) within 24 hours
- [ ] **Large debit alert**: Any debit exceeding a user-configurable threshold (default: $500)
- [ ] **New merchant alert**: First-ever transaction at a merchant above $100
- [ ] **Category overspend**: Category spending exceeds 80% of budget mid-period

#### Implementation
- [ ] Post-ingestion hook in `ingestion.processor.ts` — after inserting transactions, run anomaly checks
- [ ] `apps/api/src/analytics/anomaly-detector.service.ts` — detection logic
- [ ] Store anomaly alerts in `notifications` table with type `spending_anomaly`
- [ ] Configurable thresholds in user settings

#### Notifications
- [ ] In-app notification bell (already exists)
- [ ] HA webhook for real-time alerts
- [ ] FCM push to web app
- [ ] Example: "You spent $340 at Target — your average is $65"

---

### 1.4 Budget vs. Actual Variance Dashboard

Surface existing budget data with progress bars and alerts.

**Industry reference**: YNAB's core concept, Monarch's budget dashboard

#### Dashboard Widget
- [ ] Per-category progress bars: spent vs. budget
- [ ] Color coding: green (<70%), yellow (70-90%), red (>90%)
- [ ] Remaining amount per category
- [ ] Days remaining in period
- [ ] "On track" / "Over budget" status per category

#### Budget Alerts
- [ ] Alert at 80% threshold (configurable)
- [ ] Alert when budget is exceeded
- [ ] Push via HA webhook + FCM

#### Files
- [ ] `apps/web/src/components/BudgetProgress.tsx` — progress bar component
- [ ] `apps/web/src/app/(protected)/budgets/page.tsx` — full budgets page (may already exist)
- [ ] Dashboard integration: summary widget showing top 5 categories closest to limit

---

## Tier 2 — Smart Automation (Ollama AI on NAS)

### 2.1 OCR Receipt Scanner with Auto-Match

Upload a receipt photo → Ollama vision extracts data → auto-matches to existing transaction.

**Existing work**: `~/repo/smartocrprocess` (DocuPulse) has Tesseract OCR + file watcher + rule engine. We can absorb concepts but replace Tesseract with Ollama vision for better accuracy.

#### DocuPulse Analysis
- **What to reuse**: File watcher pattern, rule-based classification, vault folder structure concept
- **What to replace**: `pytesseract` OCR → Ollama vision (e.g., `llava` or `llama3.2-vision`)
- **What to skip**: OneDrive sync, separate Python backend (integrate into MoneyPulse NestJS instead)

#### Implementation
- [ ] New service: `apps/api/src/receipts/receipt-scanner.service.ts`
- [ ] Ollama vision API call: send image → get structured JSON (merchant, date, amount, line items)
- [ ] Prompt engineering for receipt extraction:
  ```
  Extract from this receipt: merchant name, date, total amount, line items.
  Return JSON: { merchant, date, totalCents, items: [{ name, amount }] }
  ```
- [ ] Auto-match: find transaction by date (±3 days) + amount (±5%) + merchant fuzzy match
- [ ] If match found: auto-link receipt as attachment
- [ ] If no match: prompt user to select transaction or create manual one

#### Watch Folder Integration
- [ ] Monitor `/config/receipts/incoming/` for dropped receipt photos
- [ ] Process automatically, attempt auto-match
- [ ] Move to `/config/receipts/processed/` or `/config/receipts/review/`

#### UI
- [ ] Upload button on transactions page: "Scan Receipt"
- [ ] Camera capture option (mobile-friendly)
- [ ] Review screen showing extracted data with confidence scores
- [ ] "Match to transaction" dropdown or auto-match confirmation

---

### 2.2 Natural Language Finance Chat

"How much did I spend on groceries last quarter?" → Ollama translates to SQL → returns answer with chart.

**Industry reference**: Monarch AI assistant, Copilot's chat — but fully local/private.

#### Implementation
- [ ] New module: `apps/api/src/chat/`
- [ ] `chat.controller.ts` — `POST /chat` endpoint
- [ ] `chat.service.ts` — prompt construction + Ollama call
- [ ] System prompt includes DB schema summary (not actual data)
- [ ] Ollama generates SQL → service executes → formats response
- [ ] Safety: read-only queries only (SELECT), parameter binding, query timeout

#### UI
- [ ] Chat panel (slide-over or dedicated page)
- [ ] Message history within session
- [ ] Auto-generated charts for numeric results
- [ ] Suggested questions: "What's my biggest expense this month?", "Am I on track with my grocery budget?"

---

### 2.3 Cash Flow Forecasting

Project future balances based on recurring bills + spending patterns.

**Industry reference**: Cashlytics forecasting, Copilot's "financial goals"

#### Implementation
- [ ] New service: `apps/api/src/analytics/forecast.service.ts`
- [ ] Inputs: recurring bills + average daily spending by category + known upcoming income
- [ ] Output: projected daily balance for next 30/60/90 days per account
- [ ] Alert if projected balance drops below user-configurable threshold

#### UI
- [ ] Line chart showing projected balance (dashed line = forecast, solid = actual)
- [ ] "Danger zone" highlighted when balance drops below threshold
- [ ] Dashboard widget: "Projected balance on [date]: $X"

#### Notifications
- [ ] "Your checking account will drop below $1,000 by June 15" — HA webhook + FCM

---

## Tier 3 — Polish and Delight

### 3.1 Weekly/Monthly Financial Digest

Automated summary pushed to user.

- [ ] Template: top spending categories, budget status, unusual charges, upcoming bills, net worth change
- [ ] Delivery: in-app notification + FCM push + optional email
- [ ] Leverage existing `weeklyDigestEnabled` setting
- [ ] Ollama can generate natural language summary from analytics data

### 3.2 Year-over-Year Comparison

- [ ] Compare this month vs same month last year by category
- [ ] Net worth growth timeline (monthly data points)
- [ ] "Groceries up 12% vs May 2025" insights
- [ ] Requires 12+ months of data to be useful

### 3.3 Home Assistant Dashboard Card

Custom HA sensor integration for the home dashboard.

- [ ] REST sensor exposing: today's spending, budget remaining, account balances, upcoming bills
- [ ] `GET /api/ha/sensor` — returns HA-compatible JSON
- [ ] HA automation examples: notify on big purchases, daily spending summary at 9 PM
- [ ] Template sensor YAML provided in docs

### 3.4 Tax-Ready Export

- [ ] Tag transactions as tax-deductible (new boolean field or tag)
- [ ] Tax categories: medical, charitable, business, education, home office
- [ ] Year-end export: CSV/PDF grouped by tax category
- [ ] Attach receipts per transaction for audit trail (builds on 1.1)

### 3.5 Subscription Manager

Dedicated view for managing recurring subscriptions.

- [ ] Auto-detect subscriptions from recurring bill data (Tier 1.2)
- [ ] Show: service name, amount, frequency, total annual cost
- [ ] "Annual cost" calculator: $15.99/mo = $191.88/year
- [ ] Flag price increases: "Netflix went from $15.99 to $17.99 last month"
- [ ] Category breakdown of subscription spending

### 3.6 Mobile-Friendly PWA Mode

Turn the NAS web app into an installable Progressive Web App. Pairs with receipt scanner (camera capture), push notifications, and on-the-go balance checks.

**Powers**: 1.1 (receipt camera capture), 1.2 (bill reminders on phone), 1.3 (anomaly push alerts)

#### Implementation
- [ ] `apps/web/public/manifest.json` — app name, icons, theme color, `display: "standalone"`
- [ ] Service worker for offline shell (app shell caching, not full offline — NAS may not be reachable)
- [ ] App icons: 192x192, 512x512 PNG (MoneyPulse logo)
- [ ] `<meta name="theme-color">` + `<link rel="manifest">`
- [ ] iOS `apple-touch-icon` + `apple-mobile-web-app-capable` meta tags
- [ ] Splash screen configuration

#### Camera Capture for Receipts
- [ ] Receipt upload button uses `<input type="file" accept="image/*" capture="environment">` on mobile
- [ ] Opens device camera directly — snap receipt, auto-uploads to watch folder pipeline
- [ ] Preview before submit

#### PIN/Biometric Lock (optional)
- [ ] App-level PIN lock for financial data on shared devices
- [ ] Web Authentication API (WebAuthn) for fingerprint/Face ID on supported devices
- [ ] Auto-lock after configurable inactivity timeout (default: 5 minutes)
- [ ] Stored in localStorage (PIN hash) or credential store (WebAuthn)

#### Offline Dashboard Cache
- [ ] Cache last-fetched dashboard data in IndexedDB
- [ ] Show stale data with "Last updated: X ago" badge when NAS is unreachable
- [ ] Auto-refresh when connection restored

---

### 3.7 Quick-Add Transaction Widget

Fast manual transaction entry from the PWA home screen or dashboard.

- [ ] Floating "+" button on mobile (FAB — floating action button)
- [ ] Minimal form: amount, merchant, category (typeahead), date (defaults to today)
- [ ] Optional: snap receipt photo inline
- [ ] Saves as `isManual: true` transaction
- [ ] Category typeahead reuses the combobox component from Tier 0

---

### 3.8 Spending Streak & Gamification

Lightweight behavioral nudges to encourage healthy financial habits.

- [ ] "No-spend day" streak counter on dashboard
- [ ] "Under budget" streak per category (consecutive days/weeks within budget)
- [ ] Monthly savings milestone badges
- [ ] Not gamification for its own sake — tied to real budget goals
- [ ] Optional: push notification celebrating streaks ("5 consecutive no-spend days!")

---

## Foundational Enhancements (support multiple features above)

### F.1 Merchant Name Normalization

Raw bank descriptions ("SAMPAY DUNKIN GLEN ALLEN VA", "HLU*HULUPLUS HULU.COM/BIL") produce messy groupings in top merchants, recurring detection, and receipt matching. A normalization layer produces clean names ("Dunkin'", "Hulu").

**Powers**: Tier 1.2 (recurring detection), 1.3 (anomaly alerts), 2.1 (receipt matching), 3.5 (subscription manager)

#### Implementation
- [x] New service: `apps/api/src/categorization/merchant-normalizer.service.ts`
- [x] Phase 1 — Rule-based: regex strip common suffixes (city/state, card network prefixes like "SQ *", "TST *", "PAYPAL *")
- [ ] Phase 2 — AI-assisted: Ollama batch normalizes unrecognized merchants
- [x] New column on transactions: `normalized_merchant_name` (derived, not user-editable)
- [x] Post-ingestion hook: normalize after import
- [x] Backfill command for existing transactions (`POST /transactions/normalize-merchants`)
- [x] Merchant alias table for user overrides: "AMZN*" → "Amazon"
- [x] Top merchants analytics uses normalized names
- [x] Normalize Merchants button on Sync Admin page

#### Schema
- [x] Add `normalized_merchant_name: varchar(200)` to transactions table
- [x] New table `merchant_aliases`:
  ```
  id: uuid PK
  user_id: uuid FK
  pattern: varchar(200) — regex or prefix
  display_name: varchar(200)
  created_at: timestamp
  ```

---

### F.2 Account Balance History Snapshots

Store periodic balance snapshots so net worth history and balance trend charts use real data points, not just current computed balance.

**Powers**: Tier 2.3 (cash flow forecast), 3.2 (YoY comparison), net worth trend charts

#### Implementation
- [ ] New table `account_balance_snapshots`:
  ```
  id: uuid PK
  account_id: uuid FK
  balance_cents: integer
  snapshot_date: date
  created_at: timestamp
  UNIQUE(account_id, snapshot_date)
  ```
- [ ] Daily cron job (or post-import hook): compute current balance per account, insert snapshot
- [ ] `GET /analytics/balance-history?accountId=&from=&to=` — return time series
- [ ] Dashboard: net worth history chart uses snapshots instead of recomputing
- [ ] Backfill: compute snapshots from transaction history for past months

---

### F.3 Import Deduplication Improvement

When re-importing a statement that overlaps with previously imported transactions (common after reconciling starting balances), the dedup service must handle gracefully.

**Current state**: Dedup uses `txn_hash = SHA256(accountId|date|amount|description)`. This catches exact duplicates but can miss edge cases.

#### Enhancements
- [ ] Add `external_id` matching (bank reference numbers) as primary dedup key when available
- [ ] Fuzzy window dedup: same account + same amount + date within ±1 day + description similarity > 80%
- [ ] Import preview: show "X new, Y duplicates (will skip), Z potential conflicts" before committing
- [ ] Conflict resolution UI: when fuzzy match is uncertain, show side-by-side comparison
- [ ] Import history: track which file produced which transactions, allow "undo import" (soft-delete batch)

---

## Cross-Cutting Concerns

### Security
- [ ] No secrets in code or .env files committed to Git
- [ ] Receipt/attachment files stored on NAS only, never synced to Firebase
- [ ] Ollama runs locally — no data sent to external AI services
- [ ] Existing HMAC signing + Firebase Auth for sync pipeline

### Testing (TDD mandate continues)
- [ ] Each feature: write failing test → implement → refactor
- [ ] Anomaly detection: unit tests with mock transaction data
- [ ] Recurring bill detection: test with synthetic patterns
- [ ] OCR: test with sample receipt images
- [ ] Forecast: test with deterministic recurring data

### Sync Pipeline Updates (moneypulse-web)
For each feature that affects the web companion:
- [ ] Define outbox event types (e.g., `recurring_bill.projected.v1`)
- [ ] Update `ingestSyncEvent` Cloud Function fan-out
- [ ] Add Firestore collections + security rules
- [ ] Add web app UI components (read-only projections)
- [ ] Update `firestore.indexes.json` if new queries needed

---

## Implementation Order

| Order | Feature | Effort | Depends On |
|-------|---------|--------|------------|
| 0.5 | CC payment table | 1 day | 0.3 (is_transfer) |
| F.1 | Merchant name normalization | 2 days | — (foundational, do early) |
| 1.1 | Receipt/bill attachment (upload + watch folder) | 3-4 days | — |
| 1.2 | Recurring bill detection + alerts | 3-4 days | F.1 (clean merchant names) |
| 1.3 | Spending anomaly alerts | 2 days | F.1, 1.2 |
| 1.4 | Budget vs actual dashboard | 1-2 days | — |
| F.2 | Account balance snapshots | 1 day | — |
| F.3 | Import dedup improvement | 2 days | — |
| 2.1 | OCR receipt scanner (Ollama vision) | 3-4 days | 1.1 (attachments), F.1 |
| 2.2 | NL finance chat | 3-4 days | — |
| 2.3 | Cash flow forecasting | 2-3 days | 1.2 (recurring), F.2 (snapshots) |
| 3.1 | Weekly digest | 1-2 days | 1.2, 1.3, 1.4 |
| 3.2 | YoY comparison | 1 day | F.2 (snapshots) |
| 3.3 | HA dashboard card | 1 day | — |
| 3.4 | Tax-ready export | 2 days | 1.1 (attachments) |
| 3.5 | Subscription manager | 1-2 days | 1.2 (recurring detection) |
| 3.6 | PWA mode + camera capture | 2 days | — (pairs with 1.1 receipt upload) |
| 3.7 | Quick-add transaction widget | 1 day | 3.6 (PWA) |
| 3.8 | Spending streaks & gamification | 1 day | 1.4 (budgets) |

---

## Notes

- DocuPulse (`~/repo/smartocrprocess`) has useful patterns (file watcher, rule engine) but its Python/Tesseract stack is separate from MoneyPulse's NestJS/Ollama stack. We'll absorb the concepts into MoneyPulse rather than integrating the codebase directly.
- The existing Ollama integration in MoneyPulse (used for AI categorization) provides the foundation for receipt OCR and NL chat.
- All features follow the one-way sync principle: NAS → Firebase, never reverse.
