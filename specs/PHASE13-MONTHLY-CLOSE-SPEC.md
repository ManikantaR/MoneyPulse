# MoneyPulse - Phase 13: Monthly Close & Financial Health Spec

> **Status**: Decisions resolved — sliced into GitHub epic #158 (sub-issues #159–#165)
> **Created**: 2026-07-23
> **Decisions resolved**: 2026-07-24
> **Repo**: `~/repo/MyMoney` (NAS app only; web sync verdict is `none` for the first release)
> **Depends on**: Phase 8 investment tracking, Phase 10 account/bill/budget enhancements, Phase 11 core stat tools, Phase 12 advisory evidence contract where AI narration is enabled
> **Audience**: One-earner household, USD-only, local-first MoneyPulse source of truth

---

## Resolved Decisions (2026-07-24)

These were settled in a design review after the spec was drafted. **Where they conflict with the body of this spec below, these win** — the body still carries some of the original defaults (household plumbing, the events table, transaction-derived take-home, etc.) that were deliberately changed here.

| # | Topic | Decision | Effect on the spec body |
|---|---|---|---|
| 1 | Take-home denominator | **Paycheck-profile net** — gross minus the deductions already stored in `paycheck_profiles` (federal/state/SS/medicare/401k/HSA/premiums/ESPP), effective-dated like `BudgetPlanService` scales gross today. **Not** transaction-derived. | Overrides "transaction-derived when possible" in the Income metric contract. |
| 2 | Investment pricing in net worth | **Holdings × latest EOD close** (`getPortfolioValue`) when holdings exist for an account, **else** the manual `investment_snapshots` value. Never sum both. | Resolves the spec's ambiguous "snapshots and/or holdings". |
| 3 | Manual assets & loan statement balances | **Carry-forward** the last entered value with an "as of Mon YYYY" age badge; nudge only when stale, **capped to once every 2 months**. | Replaces "nudge monthly until fresh". |
| 4 | Ramit "Investments" bucket | **Derived** from investment-contribution transfers + paycheck 401k/HSA deductions. Do **not** add a 4th `category_bucket` value or recategorize. | Clarifies "reuse or extend `category_bucket`". |
| 5 | Households | **Deferred** — scope everything to `user_id` for v1. **No** `household_id` columns on the new tables, **no** household toggle. | Removes the household toggle and `household_id` FKs from the Data Model and API. |
| 6 | Audit trail | **Lightweight** — confirmed closes stay editable; stamp `edited_at` + `is_edited`. **Do not build** the `monthly_snapshot_events` table. | Removes the Monthly Snapshot Events table. |
| 7 | Taxable brokerage liquidity | **Investments only**, not counted toward the Liquid % ratio. | Settles Open Debate #2 (no haircut for v1). |
| 8 | Draft trigger | **Monthly cron** auto-creates the previous month's draft + drives the freshness nudge (and must be verified to actually fire). | Concretizes the Monthly Close Workflow step 1. |
| 9 | AI monthly review | **In v1** (aggregate-only, evidence contract, refuses uncaveated summary on an incomplete close). | Keeps AI Review Contract in the first release. |
| 10 | Expense target | **Single band** for v1 (<60 / 60–75 / >75). | Settles Open Debate #5 (no fixed/variable split yet). |
| 11 | Historical backfill | On first run, **compute closes for as many prior months as data allows**; months missing manual asset/loan-statement values are flagged incomplete/estimated, not blank. | Adds a backfill step to the Monthly Close Workflow. |
| 12 | Employer 401k match | **Add** employer-match % (+ annual limit) to `suitability_settings` so the FOO next-dollar overlay can sequence "capture the match". | New field, not in the original Data Model. |
| 13 | Build style | **Sliced** into epic #158 with ordered children #159–#165. | — |

Open Debate Points #2 and #5 are resolved above. #1 (gold semi-liquid), #3 (gross/take-home toggle), and #4 (require a reason before editing) remain deferred/future per the decisions above.

---

## North Star

Build a monthly household CFO workspace: one dense, editable, 6-12 month view that shows whether expenses are controlled, net worth is growing, debt is falling, savings are rising, and investing is happening consistently.

The experience is inspired by Shashank Udupa's monthly net-worth accountability sheet, the Money Guy Financial Order of Operations, Ramit Sethi's Conscious Spending Plan, and Ramsey-style debt discipline as an optional mode. The product default is not a generic budget dashboard. It is a monthly close process.

The first number the user should feel is **Expenses**.

---

## Product Defaults

| Decision | Default |
|---|---|
| Scope | Household-level, optimized for a one-earner household |
| Currency | USD-only |
| View window | Toggle between 6 months and 12 months |
| Monthly close mode | Auto-created draft, user reviews/edits/confirms |
| Snapshot mutability | Confirmed snapshots remain editable and auditable |
| Income denominator | Take-home income for behavior metrics; gross income stored when available |
| Home tracking | Home market value and mortgage/loan balance tracked separately |
| Car tracking | Manual monthly value first; depreciation estimate later |
| Gold tracking | Manual dollar value first; quantity and spot-price support later |
| Loan tracking | Amortized estimate by default; manual statement balance wins when entered |
| AI review | Enabled after deterministic calculations; AI narrates, never computes |
| Notification behavior | Nudge monthly until required balances/assets are fresh |
| Web companion sync | None for v1; NAS-only full management UI |

---

## Architecture Principles

1. **Local-first unchanged.** Manual asset values, loan balances, notes, AI review inputs, and financial-health calculations stay on the NAS.
2. **Deterministic math before narration.** Every amount, ratio, target status, and trend is computed in TypeScript service code with tests. The advisor may explain the close after the facts are produced.
3. **Snapshots are accountable facts.** A monthly close row freezes the facts used for that month. Later edits are allowed, but they update an audit trail and mark the close as edited.
4. **Savings, investing, debt reduction, and net-worth growth stay separate.** Mortgage principal and car/home/gold revaluation must not inflate the headline savings rate.
5. **Credit-card payments are transfers.** Underlying purchases are expenses. Interest and fees are expenses. Principal reduction on carried credit-card debt is debt paydown.
6. **Manual assets are quality-tagged.** Homes, cars, and gold belong in net worth, but are not liquid and should not be treated as emergency reserves.
7. **Completeness is visible.** A close with stale accounts, missing manual asset values, or unverified loans is marked draft/incomplete and can trigger reminders.

---

## Rubber-Duck Review

1. **Problem.** MoneyPulse has dashboards and individual primitives, but no single monthly accountability sheet that freezes balance sheet, income statement, ratios, targets, and notes.
2. **Smallest useful change.** Add monthly close snapshots with manual asset support, a rollup API, and a spreadsheet-style `/health` UI for 6-12 months.
3. **Invariant.** The local-first privacy boundary holds, and every displayed number is traceable to transactions, account balances, manual asset snapshots, loan balance source, or investment snapshots/holdings.
4. **Validation.** Fixture tests hand-compute one household's month-end close, including manual home/car/gold values, credit-card transfer exclusion, loan override precedence, and savings/investing/debt-paydown ratios.
5. **Likely regression.** Net worth becomes flattering or wrong if loans, manual assets, credit-card transfers, or investment account types are inconsistently classified.

---

## Feature Shape

### Route

Create a new protected NAS route:

- `/health` - Monthly Close

Add a drawer nav item:

- Label: `Health`
- Icon: `Activity` or `ClipboardCheck` from `lucide-react`
- Placement: drawer, not mobile tab for v1

### Primary Screen

Top controls:

- Month picker
- 6 month / 12 month segmented control
- Household toggle if the authenticated user has a household
- `Create draft` / `Review close` / `Confirm close` button
- Freshness status

Hero metrics:

1. Expenses
2. Net Worth
3. Savings Rate
4. Investing Rate
5. Debt Paydown
6. Liquid %

Main grid:

`Metric | Current Month | Prior Month | 3M Avg | 6M Trend | 12M Trend | Target | Status`

Sections:

1. Income
2. Expenses
3. Savings
4. Investments
5. Debt Paydown
6. Assets
7. Liabilities
8. Net Worth
9. Ratios
10. Notes and AI Review

Responsive behavior:

- Desktop: dense spreadsheet-style table with sticky first column and sticky header.
- Mobile: month cards grouped by section, not a tiny unreadable table.

---

## Data Model

### Manual Assets

New table: `manual_assets`

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid not null references users(id),
household_id uuid references households(id),
name varchar(120) not null,
asset_type varchar(30) not null, -- home | car | gold | other
liquidity_class varchar(30) not null, -- liquid | semi_liquid | illiquid
is_depreciating boolean not null default false,
notes text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
deleted_at timestamptz
```

Default classifications:

| Asset type | Liquidity class | Depreciating | Included in net worth | Included in liquid assets |
|---|---|---:|---:|---:|
| Home | Illiquid | No | Yes | No |
| Car | Illiquid | Yes | Yes | No |
| Gold | Semi-liquid | No | Yes | No for v1 |
| Other | Illiquid | Configurable | Yes | No |

### Manual Asset Snapshots

New table: `manual_asset_snapshots`

```sql
id uuid primary key default gen_random_uuid(),
manual_asset_id uuid not null references manual_assets(id),
snapshot_month date not null, -- first day of month
value_cents integer not null,
source varchar(40) not null default 'manual', -- manual | estimate | imported
notes text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique (manual_asset_id, snapshot_month)
```

### Loan Balance Snapshots

New table: `loan_balance_snapshots`

```sql
id uuid primary key default gen_random_uuid(),
loan_id uuid not null references loans(id),
snapshot_month date not null,
balance_cents integer not null,
source varchar(40) not null, -- amortized | manual_statement
verified_at timestamptz,
notes text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique (loan_id, snapshot_month, source)
```

Rule:

- For a month with a `manual_statement` row, the manual balance wins.
- Otherwise use amortized balance from `packages/shared/src/loan/amortization.ts`.
- The UI shows the source beside each loan balance.

### Monthly Financial Snapshots

New table: `monthly_financial_snapshots`

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid not null references users(id),
household_id uuid references households(id),
snapshot_month date not null, -- first day of month
status varchar(20) not null default 'draft', -- draft | confirmed

take_home_income_cents integer not null default 0,
gross_income_cents integer,
expense_cents integer not null default 0,
fixed_expense_cents integer not null default 0,
variable_expense_cents integer not null default 0,

cash_savings_cents integer not null default 0,
investment_contribution_cents integer not null default 0,
debt_principal_paid_cents integer not null default 0,
extra_debt_principal_paid_cents integer not null default 0,

liquid_asset_cents integer not null default 0,
investment_asset_cents integer not null default 0,
manual_asset_cents integer not null default 0,
total_asset_cents integer not null default 0,

credit_card_liability_cents integer not null default 0,
loan_liability_cents integer not null default 0,
total_liability_cents integer not null default 0,
net_worth_cents integer not null default 0,

savings_rate_bps integer, -- cash_savings / take_home_income
investing_rate_bps integer, -- investment_contribution / take_home_income
debt_paydown_rate_bps integer, -- debt principal / take_home_income
wealth_building_rate_bps integer, -- savings + investments + principal / take_home_income
expense_ratio_bps integer, -- expenses / take_home_income
liquid_net_worth_ratio_bps integer, -- liquid assets / net worth
debt_asset_ratio_bps integer, -- total liabilities / total assets
debt_payment_income_ratio_bps integer,

target_status jsonb not null default '{}',
freshness jsonb not null default '{}',
calculation_version varchar(30) not null,
notes text,
ai_review text,
confirmed_at timestamptz,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique (user_id, snapshot_month)
```

Important:

- Store the frozen aggregate numbers to make historical review stable.
- Store enough source details in child snapshot tables and `freshness` JSON to explain what was stale or manual.
- Use integer cents and basis points. Do not store floats for money or ratios.

### Monthly Snapshot Events

New table: `monthly_snapshot_events`

```sql
id bigserial primary key,
snapshot_id uuid not null references monthly_financial_snapshots(id),
user_id uuid not null references users(id),
event_type varchar(40) not null, -- created | recalculated | edited | confirmed | reopened | ai_reviewed
old_value jsonb,
new_value jsonb,
created_at timestamptz not null default now()
```

This is an audit trail for editable confirmed snapshots.

---

## Metric Contracts

### Income

Default denominator for behavioral metrics:

```text
take_home_income_cents
```

Take-home income is transaction-derived when possible and can be reconciled with paycheck profiles later. Gross income is stored but not used by default for the household behavior score.

### Expenses

Headline:

```text
expense_cents = debit transactions excluding transfers, split parents, deleted rows, and debt-principal transfer lines
```

Credit-card payments:

- Excluded as transfers.
- The underlying card purchases are expenses.
- Interest and fees are expenses.
- Principal paid toward carried balance is debt paydown.

### Savings Rate

```text
savings_rate = cash_savings_cents / take_home_income_cents
```

Cash savings includes checking/savings/money-market growth and explicit savings transfers when categorized. It excludes:

- Home appreciation
- Car value changes
- Gold revaluation
- Mortgage principal
- Investment market appreciation

### Investing Rate

```text
investing_rate = investment_contribution_cents / take_home_income_cents
```

Includes:

- 401k/IRA/brokerage/HSA invested contributions
- 529 contributions if configured

Excludes:

- Market appreciation
- Dividend reinvestment unless the transaction feed exposes it as a contribution

### Debt Paydown Rate

```text
debt_paydown_rate = debt_principal_paid_cents / take_home_income_cents
```

Includes:

- Mortgage principal
- Auto principal
- Personal loan principal
- Carried credit-card principal payoff

Separately expose:

```text
extra_debt_principal_paid_cents
```

### Wealth-Building Rate

```text
wealth_building_rate =
  (cash_savings_cents + investment_contribution_cents + debt_principal_paid_cents)
  / take_home_income_cents
```

This is the "give me credit for progress" metric, but it must never replace the separate savings, investing, and debt paydown rates.

### Net Worth

```text
net_worth =
  liquid_assets
  + investment_assets
  + manual_assets
  - credit_card_liabilities
  - loan_liabilities
```

For Phase 13, current `AnalyticsService.netWorth()` must be corrected or replaced so it includes:

- Checking, savings, cash_sweep
- Brokerage and edu_529 account balances when stored as regular accounts
- Investment account snapshots and/or holdings priced by latest EOD close
- Manual home/car/gold/other assets
- Credit-card liabilities
- Loan liabilities

### Liquid Assets Ratio

```text
liquid_net_worth_ratio = liquid_asset_cents / net_worth_cents
```

Default target bands:

| Status | Band |
|---|---|
| Green | 25-35% |
| Yellow | 15-25% or 35-45% |
| Red | <15% |
| Informational | >45%, possible drag if long-term investing is under target |

Default target: **30%**.

V1 liquid assets:

- Checking
- Savings
- Cash sweep
- Money market style accounts if represented as cash_sweep
- Short-term CDs/Treasuries only if later tagged liquid/semi-liquid

V1 excludes:

- Home equity
- Cars
- Gold
- Retirement accounts

### Debt / Asset Ratio

```text
debt_asset_ratio = total_liability_cents / total_asset_cents
```

Default bands:

| Status | Band |
|---|---|
| Green | <25% |
| Yellow | 25-40% |
| Red | >40% |

### Required Debt Payments / Income

```text
debt_payment_income_ratio =
  required_monthly_debt_payment_cents / take_home_income_cents
```

Default bands:

| Status | Band |
|---|---|
| Green | <25% |
| Yellow | 25-35% |
| Red | >35% |

### Expense Ratio

```text
expense_ratio = expense_cents / take_home_income_cents
```

Default bands:

| Status | Band |
|---|---|
| Green | <60% |
| Yellow | 60-75% |
| Red | >75% |

The UI should also show:

- Current month expenses
- Previous month delta
- 3-month average delta
- 6-month trend
- 12-month trend

---

## Coach Overlays

### Shashank-Style Accountability

Primary view:

- Assets and liabilities on one side
- Income and expenses on the other
- Ratio strip across the top
- Month-over-month movement visible

Ratios:

- Savings-to-income
- Investing-to-income
- Wealth-building-to-income
- Liquid assets / net worth
- Debt / assets
- Debt payment / income

### Ramit Conscious Spending Plan

Group transactions into:

- Fixed costs
- Investments
- Savings
- Guilt-free / variable spending

Defaults:

| Bucket | Target |
|---|---|
| Fixed costs | 50-60% of take-home |
| Savings | 5-10% minimum |
| Investments | 10%+ minimum, configurable |
| Guilt-free / variable | 20-35% |

MoneyPulse already has `category_bucket` for the 50/30/20 view. Phase 13 should reuse or extend this mapping rather than creating a competing category taxonomy.

### Money Guy FOO

FOO means Financial Order of Operations: a "next dollar" priority system. In MoneyPulse it should be a recommendation overlay, not the main dashboard.

V1 output:

```text
Next dollar priority: Build emergency reserves / Pay high-interest debt / Capture match / Invest / Debt acceleration
```

The advisor must cite deterministic facts:

- Emergency fund months
- High-interest debt presence
- Employer match setting if known
- Investing rate
- Liquid ratio
- Debt ratio

### Ramsey Mode

Do not make Ramsey the default.

Add a future toggle:

```text
Debt Elimination Mode
```

When enabled:

- Consumer debt payoff becomes the dominant recommendation.
- Investing beyond employer match is de-emphasized until non-mortgage debt is gone.
- Emergency fund and debt snowball status are more prominent.
- Credit cards are shown as a risk surface even when paid monthly.

---

## API Design

### Manual Assets

```http
GET /manual-assets
POST /manual-assets
PATCH /manual-assets/:id
DELETE /manual-assets/:id
GET /manual-assets/:id/snapshots
PUT /manual-assets/:id/snapshots/:month
```

### Loan Balance Snapshots

```http
GET /loans/:id/balance-snapshots
PUT /loans/:id/balance-snapshots/:month
```

### Monthly Close

```http
GET /monthly-close?months=12&household=true
GET /monthly-close/:month
POST /monthly-close/:month/draft
POST /monthly-close/:month/recalculate
PATCH /monthly-close/:month
POST /monthly-close/:month/confirm
POST /monthly-close/:month/reopen
POST /monthly-close/:month/ai-review
```

Response shape for list:

```ts
interface MonthlyCloseSummary {
  month: string;
  status: 'draft' | 'confirmed';
  headline: {
    expensesCents: number;
    netWorthCents: number;
    savingsRateBps: number | null;
    investingRateBps: number | null;
    debtPaydownRateBps: number | null;
    liquidNetWorthRatioBps: number | null;
  };
  sections: MonthlyCloseSection[];
  targetStatus: Record<string, 'green' | 'yellow' | 'red' | 'info' | 'unknown'>;
  freshness: {
    isComplete: boolean;
    missingManualAssets: string[];
    staleAccounts: string[];
    unverifiedLoans: string[];
  };
  notes: string | null;
  aiReview: string | null;
}
```

---

## Backend File Inventory

Create:

- `apps/api/src/monthly-close/monthly-close.module.ts`
- `apps/api/src/monthly-close/monthly-close.controller.ts`
- `apps/api/src/monthly-close/monthly-close.service.ts`
- `apps/api/src/monthly-close/monthly-close-calculator.ts`
- `apps/api/src/monthly-close/manual-assets.controller.ts`
- `apps/api/src/monthly-close/manual-assets.service.ts`
- `apps/api/src/monthly-close/monthly-close.types.ts`
- `apps/api/src/monthly-close/__tests__/monthly-close-calculator.spec.ts`
- `apps/api/src/monthly-close/__tests__/monthly-close.service.spec.ts`
- `apps/api/src/monthly-close/__tests__/manual-assets.service.spec.ts`
- `db/migrations/0029_monthly_close.sql`

Modify:

- `apps/api/src/app.module.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `apps/api/src/loans/loans.controller.ts`
- `apps/api/src/loans/loans.service.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/validation/index.ts`
- `packages/shared/src/constants/index.ts`

Potential MCP additions:

- `apps/mcp-server/src/tools/get-monthly-close.ts`
- `apps/mcp-server/src/tools/get-financial-health.ts`

---

## Frontend File Inventory

Create:

- `apps/web/src/app/(protected)/health/page.tsx`
- `apps/web/src/components/monthly-close/MonthlyCloseGrid.tsx`
- `apps/web/src/components/monthly-close/MonthlyCloseHero.tsx`
- `apps/web/src/components/monthly-close/MonthlyCloseMonthCard.tsx`
- `apps/web/src/components/monthly-close/ManualAssetPanel.tsx`
- `apps/web/src/components/monthly-close/LoanVerificationPanel.tsx`
- `apps/web/src/components/monthly-close/CoachOverlayPanel.tsx`
- `apps/web/src/components/monthly-close/AiMonthlyReview.tsx`
- `apps/web/src/lib/hooks/useMonthlyClose.ts`
- `apps/web/src/__tests__/monthly-close.spec.tsx`

Modify:

- `apps/web/src/lib/nav-items.ts`
- `apps/web/src/lib/api.ts` only if a new helper is needed
- `apps/web/src/app/(protected)/overview/page.tsx` only to cross-link to `/health`

---

## Monthly Close Workflow

1. On the first day after a month ends, create a draft close for the previous month.
2. Pull transaction-derived income and expenses.
3. Pull account balances as of month end, using snapshots where available.
4. Pull investment snapshots or priced holdings.
5. Pull manual asset snapshots for homes, cars, gold, and other assets.
6. Compute loan balances using manual statement balance if present, otherwise amortized estimate.
7. Compute ratios and target statuses.
8. Mark freshness:
   - missing manual asset value
   - stale bank account
   - missing investment snapshot or stale holding
   - unverified loan balance
9. Notify/nudge while required facts are missing.
10. User reviews, edits, writes notes, and confirms.
11. Optional AI review summarizes:
   - expense trend
   - net-worth movement
   - debt movement
   - savings/investing consistency
   - next-dollar priority

---

## AI Review Contract

The AI monthly review consumes only aggregate close data:

- No raw transactions
- No merchant-level ledger unless explicitly drilled in locally
- No account numbers
- No manual address/location details

Prompt inputs:

- Current month close summary
- Prior 3/6/12 month trend summaries
- Target statuses
- Freshness caveats
- User notes

Required output:

- 3-5 bullets
- One expense accountability observation
- One net-worth/debt observation
- One next-dollar recommendation
- Clear caveat if the close is incomplete

Forbidden:

- Inventing numbers
- Recommending trades
- Predicting markets
- Treating home/car/gold revaluation as savings behavior
- Calling credit-card payments expenses when underlying purchases are already counted

---

## UI Details

### Dense Grid

Use a compact, professional operating-dashboard style:

- Sticky metric column
- Sticky month headers
- `tabular-nums`
- Muted grid lines
- Green/yellow/red status chips
- Drill links into transactions where a row is transaction-derived
- Inline edit affordances for manual facts

### Hero Cards

Cards should be restrained, not marketing-like:

1. Expenses
2. Net Worth
3. Savings Rate
4. Investing Rate
5. Debt Paydown
6. Liquid %

Expenses card details:

- Current month
- Previous month delta
- 3-month average delta
- Status against target

### Manual Asset Panel

Show:

- Home values
- Car values
- Gold value
- Last updated month
- Missing values
- Inline month value editor

### Loan Verification Panel

Show:

- Loan
- Amortized balance
- Manual statement balance
- Source used
- Verified this month
- Principal paid this month

---

## Acceptance Criteria

1. A user can create a draft monthly close for the previous month.
2. The close includes transaction-derived income and expenses and excludes transfer-category credit-card payments from expenses.
3. Manual home, car, and gold values are included in net worth but excluded from liquid assets.
4. Loan balances use manual statement balance when present and amortized balance otherwise.
5. Mortgage principal appears in debt paydown and wealth-building rate, but not in savings rate.
6. The 6-month and 12-month grid render correctly on desktop.
7. Mobile renders month cards without unreadable squeezed columns.
8. Missing manual asset values, stale accounts, and unverified loans mark the close incomplete.
9. Confirmed closes can be edited, and edits write `monthly_snapshot_events`.
10. AI review refuses to produce an uncaveated summary when the close is incomplete.
11. Calculator tests hand-verify all ratios for a fixture month.
12. API tests cover household scoping for a one-earner household.

---

## Validation Plan

Backend:

```bash
pnpm --filter @moneypulse/api test monthly-close
pnpm --filter @moneypulse/api test analytics
pnpm --filter @moneypulse/api build
```

Frontend:

```bash
pnpm --filter @moneypulse/web test monthly-close
pnpm --filter @moneypulse/web build
```

Full repo:

```bash
pnpm build
pnpm test
```

Manual:

1. Seed one household with one earner.
2. Add checking, savings, credit card, investment account, mortgage, car loan, home, car, and gold.
3. Create a previous-month draft close.
4. Verify expenses are the headline and credit-card payments are not double-counted.
5. Enter manual home/car/gold values and manual mortgage statement balance.
6. Confirm the close.
7. Edit a confirmed manual asset value and verify event history records the change.

---

## Out of Scope for V1

- Multi-currency assets
- Automatic home valuations
- Automatic car valuations
- Gold quantity and spot-price feed
- Brokerage trade execution
- Specific security recommendations
- Firebase/moneypulse-web sync
- Full Ramsey Baby Steps workflow
- PDF statement extraction for loan balances

---

## Open Debate Points

These are intentionally left reviewable before implementation:

1. Whether gold should become semi-liquid in the liquid-assets ratio after quantity/spot-price support exists.
2. Whether taxable brokerage should count as liquid with a haircut, or stay under investments only.
3. Whether savings rate should use take-home forever, or expose gross/take-home toggle.
4. Whether confirmed snapshots should require a reason before editing.
5. Whether the expense target should be a single household target or separate fixed/variable targets.

---

## Implementation Order

1. **Spec alignment.** Review this spec and resolve open debate points.
2. **Schema and shared contracts.** Add manual assets, asset snapshots, loan balance snapshots, monthly close snapshots, validation schemas, and shared types.
3. **Calculator first.** Build pure calculator with fixture tests before wiring controllers.
4. **API vertical slice.** Implement manual assets, monthly draft, recalc, confirm, edit, and list endpoints.
5. **Web v1.** Add `/health` grid, hero metrics, manual asset editor, and loan verification panel.
6. **Freshness nudges.** Add monthly reminder job and notification rows.
7. **AI review.** Add aggregate-only monthly review after deterministic close data is stable.
8. **MCP/advisor tools.** Expose `get_monthly_close` and `get_financial_health` only after API behavior is tested.

