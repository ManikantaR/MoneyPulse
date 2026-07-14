# MoneyPulse — Phase 11: Financial Awareness Spec

> **Status**: Planning
> **Created**: 2026-07-12
> **Repos**: `~/repo/MyMoney` (NAS app); moneypulse-web impact is minimal (see per-feature Sync verdicts)
> **Constraint**: No secrets in code or committed .env files (public repos)

---

## North Star

**The app comes to you; you don't go to the app.** Every stat the system can compute should be able to reach the user through a notification channel without the user opening a dashboard. The LLM narrates; deterministic code computes; every number is traceable (same contract as the Phase-7/AI-advisor epic #36).

## Architecture Principles (authoritative for every stage below)

1. **Local-first unchanged.** All new computation runs on the NAS. The only *outbound* cloud traffic remains the existing aggregates-only advisor path. External market data is *inbound* public data (EIA/FRED) — no PII in requests beyond an API key.
2. **Every new stat is an aggregate MCP tool first.** UI cards, briefs, digests, watchdog alerts, and the advisor all consume the same tool/service — one implementation, five delivery surfaces.
3. **Insights are rows, not side effects.** Everything the system "notices" (watchdog hit, freshness warning, market alert, AI observation) is persisted as a notification-taxonomy row and rendered in one Insights feed. Channels (Telegram, Web Push, email, HA, in-app) are delivery *views* over that row, governed by per-user preferences.
4. **Alert fatigue is a first-class failure mode.** Notification preferences (instant vs. batch-into-brief, quiet hours, per-type opt-out) ship *with* the first new detectors (11.3 ≤ 11.5), not after.
5. **Detectors are deterministic and dedupe-keyed.** Same pattern as `alert-engine.service.ts` budget alerts: pure detector → dedupe key → notification row. AI is never the detector of record; it may only narrate detector output (11.9).
6. **Sync verdict discipline** (Phase-10 rule): every feature states `web: none | field-only | summary+push`. Default for Phase 11 is **web: none** — awareness features are NAS-first; push reach comes from Telegram + Web Push, not Firestore.

## Execution Order & Dependency Graph

| Order | Stage | Depends on | Folds in / unblocks |
|-------|-------|-----------|---------------------|
| 0 | Pre-flight: merge dependabot PR #27, triage #42, prune merged branches | — | — |
| 1 | 11.1 Sync contract hardening | #97 landed (done) | Protects all later emitters |
| 2 | 11.2 Data freshness monitor | — | Trust foundation for every stat |
| 3 | 11.3 Insights feed + notification preferences + Web Push | — | Home for 11.4–11.9 output |
| 4 | 11.4 Daily morning brief | 11.2, 11.3 | Loan payoff nudges (#88 leftovers) |
| 5 | 11.5 Watchdog detectors | 11.3 | — |
| 6 | 11.6 Market-data module (EIA + FRED) | — (parallel-safe after 11.1) | Unblocks #40 goal planners' FRED needs |
| 7 | 11.7 Market-joined insights | 11.3, 11.6, loans (#91) | — |
| 8 | 11.8 Core stat tools | 11.2 (freshness caveats) | Absorbs #22 (YoY) |
| 9 | 11.9 Proactive advisor | 11.3, 11.8; advisor (#38, shipped) | Epic #36 "real-time nudges / insights feed" deferred items |
| 10 | 11.10 Local semantic search | — (independent; do last) | Better categorization suggestions |

Rationale for the order: 11.1 makes later sync-adjacent changes safe; 11.2 ensures every downstream number is computed over known-fresh data; 11.3 must exist before anything starts emitting new alert types; 11.4–11.5 are the daily value; 11.6–11.7 add market context; 11.8–11.10 deepen the stat and AI layers.

---

## 11.1 Sync Contract Hardening — Executable Allowlist

**Problem.** PHASE9 promised "strict allowlist and denylist"; `sanitizer-v2.service.ts` shipped denylist-only (`SYNC_BANNED_FIELDS` + PII regexes). Denylists fail open: issue #90 (raw category UUIDs projected) was exactly this. #97 fixed the instance, not the class.

**Design.**
- New `packages/shared/src/sync-contracts/` — one Zod schema per event type, `.strict()` so unknown fields are rejected:
  - `transaction.projected.v1`, `category.upserted.v1`, `account.projected.v1`, `budget.projected.v1`, … (enumerate from current emitters in `sync.controller.ts` / `transaction-projection.service.ts` / `categories.service.ts`).
- Sanitizer step 0 becomes `schema.parse(payload)` → schema failure = `POLICY_FAIL_SCHEMA` (new policy reason), event dead-letters with the Zod issue list in `policy_reason`.
- Alias-shape assertions inside schemas: any `*Id` field bound for the cloud must match the alias format emitted by `alias-mapper.service.ts` (e.g. `z.string().regex(ALIAS_ID_PATTERN)`) — raw UUIDv4 is a schema *failure*, not just a regex sanitizer catch.
- **Golden fixtures**: `apps/api/src/sync/__tests__/fixtures/<event-type>.golden.json` — one canonical payload per event type. Table-driven policy test asserts: fixture parses, fixture with an extra field fails, fixture with a raw UUID in an id field fails.
- moneypulse-web ingest imports the same schemas from the shared package (or a copied, version-pinned snapshot if cross-repo import is impractical — document which).
- AGENTS.md addition: *"Any change to `apps/api/src/sync/` payload shapes must update the shared sync-contract schema + golden fixture in the same PR."*

**Files.** `packages/shared/src/sync-contracts/*.ts`, `apps/api/src/sync/sanitizer-v2.service.ts`, `sync.constants.ts`, `__tests__/sync-policy.spec.ts` + fixtures, `AGENTS.md`.

**Acceptance.**
- Adding an undeclared field to any projected payload fails CI.
- A raw local UUID in any cloud-bound id field fails CI and dead-letters at runtime.
- All existing emitters pass against their schemas (proves current contract is captured).

**Sync verdict**: field-only (contract layer; no new data).

---

## 11.2 Data Freshness Monitor

**Problem.** Insights over stale data are worse than no insights. Nothing today tells the user "Chase checking has no data since June 20."

**Design.**
- `AccountFreshnessService` (in `analytics/`): per active account compute `lastTransactionDate`, `lastImportAt` (join `file_uploads`), `staleDays`, and a status: `fresh` (≤ threshold), `stale`, `dormant` (user-flagged expected-inactive).
- `user_settings.freshness_threshold_days` (default **14**); per-account `accounts.expected_import_cadence_days` nullable override; `accounts.is_dormant` boolean (excludes from nagging and from "coverage" math).
- `GET /api/analytics/freshness` returns per-account status + an overall **coverage** summary (`N of M active accounts fresh`).
- Dashboard: compact coverage banner (green/amber) linking to per-account detail on the Accounts page; amber lists the stale accounts.
- Detector (runs in nightly `alert-cron`): account crosses threshold → insight row `data_freshness` with dedupe key `freshness_<accountId>_<isoWeek>` (max one nag per account per week).
- Every aggregate MCP tool response gains an optional `dataCaveat` field when the involved accounts include a stale one (e.g. `"Chase checking has no data since 2026-06-20; figures may be incomplete"`). The advisor system prompt is extended: *always relay a dataCaveat when present.*
- Ties into bank-statement-watcher as the feeder; document the watch-folder path as the automation hook.

**Files.** `apps/api/src/analytics/account-freshness.service.ts` (+spec), `analytics.controller.ts`, `apps/api/src/jobs/alert-cron.processor.ts`, `apps/api/src/db/schema.ts` + migration, `apps/web` dashboard banner + accounts page column, MCP tool plumbing for `dataCaveat`.

**Acceptance.**
- Account with newest transaction 20 days old (threshold 14) shows `stale` in API + dashboard and produces exactly one weekly insight.
- Dormant accounts never nag and are excluded from coverage denominator.
- `get_spending_summary` over a period touching a stale account includes `dataCaveat`; advisor answer mentions it.

**Sync verdict**: none.

---

## 11.3 Insights Feed + Notification Preferences + Web Push

**Problem.** Alerts land in a bell dropdown and scatter across channels; 11.4–11.9 will multiply volume. One home + user-controlled delivery is prerequisite.

**Design — feed.**
- Extend `notifications` table rather than a new table: add `severity` (`info|insight|warning|critical`), `source` (`watchdog|freshness|market|advisor|budget|system`), `data` jsonb (structured payload for rendering, e.g. `{merchant, oldAmount, newAmount}`), `dismissed_at`.
- New page `apps/web/src/app/(protected)/insights/page.tsx`: reverse-chron feed, filter chips by source/severity, unread state, dismiss, "explain" affordance that deep-links into the advisor with the insight as context. `NotificationBell` badge counts undismissed `warning|critical`.

**Design — preferences.**
- `notification_preferences` table: `(user_id, notification_type)` → `{channels: {inApp, telegram, webPush, email, haWebhook}, mode: instant|brief|off}`. Defaults seeded per type (e.g. `duplicate_charge` → instant/telegram; `market_update` → brief).
- `user_settings.quiet_hours_start/end` (local time): instant deliveries queue during quiet hours, flush after.
- `NotificationsService.dispatch()` becomes the single choke point: reads preferences → routes to channel services → `mode: brief` rows are held for the next morning brief (11.4).
- Settings UI: matrix of type × channel + quiet hours.

**Design — Web Push channel.**
- Self-hosted VAPID (`web-push` npm lib); keys via `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env (generate with `npx web-push generate-vapid-keys`).
- `push_subscriptions` table (user_id, endpoint, keys, user_agent, created_at); `POST/DELETE /api/notifications/push-subscription`.
- Service worker (`SwRegister` already registers one) gains a `push` handler; subscribe prompt on Settings page. Fully third-party-free phone notifications for the PWA.

**Files.** `apps/api/src/notifications/{notifications.service.ts, web-push.service.ts, preferences.service.ts}` (+specs), schema + migration, `apps/web` insights page, settings matrix, sw push handler.

**Acceptance.**
- Every notification created anywhere appears in the feed with correct source/severity.
- A type set to `brief` does not send instantly and appears in the next brief.
- Quiet hours delay instant Telegram/push delivery; flush occurs after the window.
- Web Push arrives on a phone with the PWA installed, NAS-only infrastructure.

**Sync verdict**: none (deliberate — FCM path in moneypulse-web remains separate; do not dual-write).

---

## 11.4 Daily Morning Brief

**Design.**
- `BriefService` (in `analytics/`, sibling of `digest.service.ts`) composes, per user, entirely from existing services/tools:
  1. **Safe-to-spend today** — from `forecast.service.ts` minimum-balance projection minus remaining bills (precursor of #40's engine; keep the math in one exported function the goal planner will later reuse).
  2. Yesterday: total spend, txn count, largest txn.
  3. Budget pace: any budget whose projected month-end > 100% (from `alert-engine` math), days left.
  4. Bills due ≤ 7 days (existing `bills.service`), incl. loan payments (#94 detector data).
  5. Batched `mode: brief` insights from 11.3 (watchdog hits, market notes, freshness).
- Delivery 7:00 AM user-local (BullMQ repeatable job; reuse `reminder.processor.ts` scheduling pattern), channels per preferences (default Telegram + Web Push + feed row `type: daily_brief`).
- Formatting: compact plain-text/MarkdownV2 for Telegram (reuse #95 formatting helpers); no LLM required. Optional later: one-line LLM narrative on top (11.9 infra).
- `user_settings.daily_brief_enabled` (default off until user enables), `daily_brief_hour`.
- Empty-day rule: if nothing notable (no spend, no items), send the one-liner version or skip per preference — never a long empty template.

**Acceptance.** Enabled user receives one message at the configured hour containing the five sections with numbers matching the dashboard for the same dates (calendar-date semantics per #96); disabled user receives nothing; brief-batched insights are marked delivered and don't re-send.

**Sync verdict**: none.

---

## 11.5 Watchdog Detectors

Six deterministic detectors, each: pure function over Postgres → insight row (11.3 taxonomy) with dedupe key. Trigger points: post-import hook in `ingestion.processor.ts` (txn-scoped detectors) + nightly `alert-cron` (period-scoped).

| Detector | Type key | Rule (defaults; constants in shared package) | Dedupe key |
|---|---|---|---|
| Duplicate charge | `duplicate_charge` | Same account + normalized merchant + exact amount, 2 txns within 48h, not a known recurring pair | `dup_<txnHashA>_<txnHashB>` |
| Subscription price creep | `price_creep` | Recurring merchant (existing subscriptions detection) whose latest amount deviates > max(2%, $1) from trailing-3 modal amount | `creep_<merchantId>_<newAmountCents>` |
| New recurring merchant | `new_recurring` | Merchant hits recurring criteria (≥3 occurrences, modal interval) for the first time | `newrec_<merchantId>` |
| Fee/interest detected | `fee_detected` | Description matches fee/interest/penalty pattern set (shared constant, per-bank additions) and category ∉ expected-fee set | `fee_<txnHash>` |
| Budget pace | `budget_pace` | Day ≥ 7 of period and linear projection > 110% of budget (distinct from existing 80%/100% *actual* alerts) | `pace_<budgetId>_<periodKey>` |
| Statistical anomaly | `stat_anomaly` | Txn amount z-score > 3 vs 6-month per-category (fallback per-account) distribution, min 20 samples, amount > $25 | `anom_<txnHash>` |

Notes: upgrade/absorb `anomaly-detector.service.ts` where it overlaps rather than duplicating; every detector unit-tested with fixture transactions including the no-fire cases; all thresholds live in `packages/shared` constants so UI can later expose them as settings.

**Acceptance.** Golden-path + no-fire tests per detector; importing a statement containing a duplicate pair yields exactly one insight; second import of the same file yields zero (dedupe + upload idempotency).

**Sync verdict**: none.

---

## 11.6 Market-Data Module (EIA + FRED)

**Design.**
- New `apps/api/src/market-data/` module: `eia.client.ts`, `fred.client.ts`, `market-data.service.ts`, `market-data.controller.ts` (thin, read-only), refresh processor.
- Table `market_metrics`: `(id, metric_key varchar, region varchar nullable, period_date date, value numeric, unit varchar, source varchar, fetched_at timestamptz)`, unique `(metric_key, region, period_date)`. Append-only time series.
- Seed series (env-configurable list):
  - EIA: regular gasoline retail $/gal, state-level weekly (`MARKET_GAS_STATE`, e.g. `WA`); residential electricity ¢/kWh, state monthly.
  - FRED: `MORTGAGE30US` (30-yr mortgage weekly), `CPIAUCSL` (CPI monthly), `FEDFUNDS`; HYSA benchmark series id via `MARKET_HYSA_FRED_SERIES` (default a national deposit-rate series, documented in .env.example).
- Env: `EIA_API_KEY`, `FRED_API_KEY` (both free-tier keys; NAS .env only, never committed).
- Refresh: daily BullMQ repeatable job with jitter; per-series cadence awareness (don't refetch weekly series daily unless past expected release); on API failure log + keep serving last stored values — **an external outage must never break any consumer**.
- MCP tool `get_market_context` (aggregate; add to `AGGREGATE_TOOL_ALLOWLIST`): returns latest value + 4-week/12-month deltas per series. Public data — safe for cloud advisor by definition.
- **Explicitly not scraping.** GasBuddy/AAA scraping rejected (brittle, TOS). If a series has no API, we skip the series.

**Acceptance.** Fresh NAS boot with keys set populates all series within one job run; killing outbound network serves cached values with `fetchedAt` visible; `get_market_context` callable from advisor and returns deltas; unit tests use recorded API fixtures (no live calls in CI).

**Sync verdict**: none.

---

## 11.7 Market-Joined Insights

The payoff of 11.6 — joins against the user's own data. All are detectors in the 11.3 taxonomy, run weekly/monthly in `alert-cron`.

1. **Refi watcher** (`refi_opportunity`, monthly): for each active loan (#91 schema) where `loan.apr − MORTGAGE30US_latest ≥ REFI_SPREAD_THRESHOLD` (default 0.75pp): compute est. monthly savings via existing amortization math at the market rate, same remaining term. Insight: "30-yr avg is X%, your mortgage is Y% — refi could save ~$Z/mo". Dedupe per loan per quarter; auto loans compare against the configured auto-rate series if enabled.
2. **Idle cash detector** (`idle_cash`, monthly): sum checking+savings balances above `IDLE_CASH_BUFFER` (default: 1 month of trailing-3-month avg expenses, overridable in settings) × HYSA benchmark APY = foregone $/yr. Fires when foregone ≥ $100/yr. Requires fresh balance data (11.2 gate — skip + note if stale).
3. **Personal vs market fuel** (`fuel_vs_market`, monthly): user's Gas/Auto fuel-station spend MoM% vs EIA state gas price MoM%; fire when divergence > 10pp with ≥ 3 fuel txns/month. Message distinguishes price vs behavior.
4. **Utility vs market power** (`power_vs_market`, monthly): same join for the electric-utility recurring merchant vs state ¢/kWh trend.
5. **Gas dip note** (`market_update`, weekly, mode `brief` by default): state gas price moved > 3% week-over-week.

Each insight's `data` jsonb carries the inputs (rates, balances, deltas) so the feed's "explain" hand-off gives the advisor verifiable numbers.

**Acceptance.** Deterministic tests per join with fixture loans/balances/metrics; refi insight matches an independent amortization calculation within $1/mo; idle-cash respects buffer and freshness gate.

**Sync verdict**: none.

---

## 11.8 Core Stat Tools (absorbs #22)

New analytics service methods, each exposed as REST + MCP aggregate tool (allowlist-added) + dashboard/insight consumers:

1. **Savings rate** — `(income − expenses) / income` monthly, trailing series; excludes `is_transfer`. Tool `get_savings_rate`.
2. **Cash runway** — liquid balances ÷ trailing-3-month avg monthly expenses → months. Tool `get_cash_runway`.
3. **Net-worth snapshots + deltas** — extend `balance-snapshot.service.ts` to persist monthly net-worth snapshots (accounts + investments − loans); expose 30/90/365-day deltas in `get_net_worth`. This is #22's snapshot dependency ("Prompt 11").
4. **YoY comparison** (#22) — this-month vs same-month-last-year by category + net-worth timeline; graceful < 12 months ("only N months of history"). Extends `compare_periods` or new `get_yoy_comparison`. Optional CPI-real deltas once 11.6 lands (nominal-only acceptable first cut).
5. **Subscription total headline** — monthly recurring total + 12-month trend from existing subscriptions detection. Tool `get_subscription_total`.

Dashboard: StatCards for savings rate, runway, subscription total; net-worth card gains delta chips. Every tool respects 11.2 `dataCaveat`.

**Acceptance.** Each stat has a unit test against a fixture ledger with hand-computed expected values; YoY handles the <12-months case; advisor can answer "what's my savings rate trend?" with provenance.

**Sync verdict**: field-only candidates later (headline numbers to web summary); ship NAS-only first.

---

## 11.9 Proactive Advisor (scheduled AI review)

**Design.**
- `AdvisorReviewService`: reuses the existing provider loop (`advisor.service.ts` streamTurn plumbing, same `AGGREGATE_TOOL_ALLOWLIST`, now including 11.6/11.8 tools) with a **standing prompt** instead of a user message.
- **Weekly review** (Sun evening): "Review this week's aggregates vs prior weeks; flag ≤ 3 noteworthy items: unusual category movement, goal/budget drift, waste candidates. Cite tool figures. If nothing noteworthy, say exactly `NOTHING_NOTEWORTHY`."
- **Monthly review** (1st): month vs previous month + YoY (11.8), budgets, net-worth delta, loan progress; ≤ 5 items.
- Output → one insight row (`source: advisor`, severity `insight`) + Telegram per preferences. `NOTHING_NOTEWORTHY` → no row (silence is a feature).
- Guardrails: same aggregates-only boundary (nothing new leaves the NAS — same tools, scheduled caller); full run logged to `ai-logs`; hard token/round caps as in chat; feature-gated on advisor configured + `user_settings.proactive_advisor_enabled` (default off); every insight carries the standing ADVISOR_DISCLAIMER.
- Numeric spot-check: post-process narrated dollar figures — each must appear in some tool result of the run (the epic #36 "verifier" in cheap form); mismatch → drop item + warn log.

**Acceptance.** Weekly run with fixture data produces ≤ 3 cited items in the feed and Telegram; quiet week produces nothing; a narrated number absent from tool output is dropped and logged; disabling the flag stops runs.

**Sync verdict**: none.

---

## 11.10 Local Semantic Transaction Search

**Design.**
- Postgres `pgvector` extension (compose image swap to `pgvector/pgvector:pg16` or install extension in existing volume — document migration path for NAS data).
- Embeddings via Ollama `nomic-embed-text` (768-dim) at `OLLAMA_URL`; best-effort + BullMQ retry queue per the Phase-10 AI-availability rule — ingestion never blocks on embedding.
- `transaction_embeddings` table: `(transaction_id pk/fk, embedding vector(768), model varchar, embedded_at)`; backfill job for history; hook in `ingestion.processor.ts` enqueues new txns.
- `search_transactions_semantic` MCP tool — **LOCAL-ONLY: excluded from `AGGREGATE_TOOL_ALLOWLIST`** (returns raw rows, same class as `search_transactions`). Available to the web UI and any local MCP consumer, never the cloud advisor.
- Web: Transactions page search upgraded to hybrid (keyword + semantic re-rank); "similar transactions" panel in `TransactionDetailPanel`.
- **Categorization assist**: nearest-neighbor vote among the user's own categorized history proposes a category + confidence for uncategorized txns — feeds the existing rules/AI pipeline as the cheapest, most personal suggester (runs before Ollama chat-model classification).

**Acceptance.** "coffee near the airport"-style query returns the expected fixture txn ranked top-3; Ollama down → import still completes, embeddings backfill on recovery; cloud advisor tool list demonstrably excludes the semantic tool (policy test); NN category suggestion accuracy measured against a held-out slice of already-categorized history and reported in the PR.

**Sync verdict**: none.

---

## Explicitly Out of Scope (Phase 11)

- Scraping any website for prices (GasBuddy, AAA, utility portals).
- OpenEI URDB tariff integration (candidate for a later refinement of 11.7.4).
- Web-app (Firestore) parity for insights/brief — Web Push covers off-NAS reach.
- Draft-actions-to-approve / any write-capable AI (stays deferred per epic #36).
- Multi-currency.

## Cross-Cutting Validation

- `pnpm test` unit coverage for every service/detector; Playwright specs for insights feed, settings matrix, dashboard freshness banner.
- All new thresholds/constants in `packages/shared` with JSDoc.
- Every stage lands as an independent PR chain off `main` per the work-issue flow; no stage may weaken a Phase-9 privacy invariant (11.1's tests are the guard).
