# MoneyPulse — Phase 12: Advisory Agents Spec

> **Status**: Planning
> **Created**: 2026-07-18
> **Repo**: `~/repo/MyMoney` (NAS app only; web sync verdict is `none` for all of Phase 12)
> **Depends on**: Phase 11 core — #101 (feed/preferences), #104 (market data), #106 (fact catalog), #107 (scheduled advisor runtime). Correctness prerequisites: #114, #115.
> **Origin**: distilled from the vNext exploration (`tmp/moneypulse-vnext-architecture/`, archived as reference); adopts its recommendation-lifecycle, evidence-contract, and privacy-class ideas in lightweight form; rejects its capability runtime, internal event outbox, tool broker, and prompt registry as oversized for a single-household app.

---

## North Star

Phase 11 answers *"what is happening with my money?"* Phase 12 answers *"what should I do with it?"* — via multiple **specialist advisory agents** that compute deterministic recommendations from the user's own data plus public market data, narrate them with an LLM, and remember the user's decisions.

## Architecture Principles (authoritative)

1. **The privacy boundary IS the agent boundary.** The local "data agent" is the existing MCP server (raw data never leaves). Advisory agents are cloud-or-local LLM reasoning loops (existing provider factory: Anthropic/Google/OpenAI) that see only aggregate tools + public market data. No new agent protocol; no LLM-to-LLM dialogue. Agents share facts through tools, never by talking to each other.
2. **Deterministic engine, generative narration** (same contract as epic #36). Every dollar figure, rate comparison, and allocation delta is computed in tested code and delivered to the LLM as a tool result; the LLM explains and prioritizes, never invents. The numeric spot-check from 11.9 applies to every agent.
3. **Evidence is mandatory and machine-checkable.** A recommendation without complete evidence is not rendered and not delivered — fail closed. Evidence = every input (source, series/tool, value, observedAt), `calculationVersion`, and explicit assumptions.
4. **Advisory, never autonomous.** The app never executes, schedules, or drafts a transfer or trade — no exceptions, including "with confirmation". Recommendations are options-with-tradeoffs plus the standing disclaimer. Suitability-dependent answers require user-entered suitability settings; absent settings → the agent states what's missing instead of guessing.
5. **No market timing.** The Investment Coach structurally refuses "is now a good time" as asked and answers the policy question instead (surplus, allocation drift, DCA). This is a tested behavior, not a prompt hope.
6. **Autonomous data pull, minimal human input.** The user declares holdings (ticker + share count as-of date), suitability settings, and a rate watchlist. Agents autonomously refresh prices, benchmark rates, Treasury yields, and earned APY. Stale user-declared data is surfaced by the Phase 11 freshness monitor pattern, and recommendations carry the caveat.
7. **Alert-fatigue rules apply.** Agents emit into the 11.3 feed through the dispatch choke point; per-topic frequency caps and persisted suppression reasons (adopted from vNext decision-engine-lite) gate delivery. An agent with nothing material to say says nothing.

## Execution Order

| Order | Stage | Depends on |
|---|---|---|
| 0 | Prereqs: #114/#115 correctness; Phase 11 #101, #104 landed | — |
| 1 | 12.1 Recommendation layer + agent manifests + decision memory | #101 |
| 2 | 12.2 Holdings & security prices | #104 (module pattern) |
| 3 | 12.3 Treasury yields + rate watchlist + earned APY | #104 |
| 4 | 12.4 Suitability settings & investment policy | — (parallel-safe) |
| 5 | 12.5 Cash Manager agent | 12.1–12.4, #106 |
| 6 | 12.6 Investment Coach agent | 12.1, 12.2, 12.4, #106 |
| 7 | 12.7 Savings Coach upgrade | 12.1, #103 |

12.2/12.3/12.4 are parallel-safe after 12.1. Ship 12.5 before 12.6: cash placement is the most objective, highest-trust first advisor.

---

## 12.1 Recommendation Layer, Agent Manifests, Decision Memory

**Recommendation shape** — extends the 11.3 insight row (`notifications` table; NOT a new table):
- `kind` (`insight` | `recommendation`), `action_summary`, `expected_impact` jsonb (range, not false precision: `{minCentsPerYear, maxCentsPerYear, basis}`)
- `evidence` jsonb (array of `{source, ref, value, unit, observedAt}` — e.g. `{source:"FRED", ref:"MORTGAGE30US", value:5.9, observedAt:"2026-07-10"}` or `{source:"tool", ref:"get_account_balances", ...}`)
- `assumptions` jsonb (strings), `confidence_band` (`high|medium|low` — bands, never fake percentages), `calculation_version`, `producer` (agent id + version), `expires_at`
- Decision memory: `decision` (`accepted|rejected|dismissed|snoozed|not_applicable`), `decision_reason` (optional free text), `decided_at`, `snoozed_until`

**Render contract (fail closed):** the feed refuses to render a `recommendation` row missing evidence/assumptions/confidence; the dispatcher refuses to deliver it. Unit-tested.

**Feed UI:** decision buttons on recommendation cards; expandable "How we got this" section rendering evidence rows with source links (FRED series page, Treasury API ref, tool name + date) and the assumption list.

**Decision-aware suppression:** rejected/not-applicable recommendations with unchanged inputs (same `calculationVersion`, inputs within tolerance) are suppressed; material input change (e.g. spread widens ≥ 0.5pp beyond last-rejected level) may re-raise with reference to the prior decision. Per-topic frequency caps + suppression reasons persisted (`suppressed_reason` on the row or log).

**Agent manifest (lightweight — a typed constant, not a runtime):** each agent declares `{id, version, schedule, toolAllowlist, privacyClass: 'aggregates_cloud_ok' | 'local_only', outputTypes, featureFlag}`. The runner (extension of 11.9's `AdvisorReviewService`) enforces the tool allowlist and privacy class centrally.

**Acceptance:** recommendation without evidence never renders/delivers (test); decisions persist and suppress repeats; "How we got this" shows every input with source + date; manifests enforce tool subsets (agent calling an undeclared tool = run failure, logged).

---

## 12.2 Holdings & Security Prices

**Holdings:** extend investments module — `investment_holdings` table: `(id, investment_account_id, ticker, share_count numeric, as_of date, notes, created_at, updated_at)`. Share count is user-declared; edits keep history (new row per as-of). UI on the Investments page. Freshness: holdings older than `HOLDINGS_STALE_DAYS` (default 90) → freshness insight + `dataCaveat` on derived facts.

**Prices:** `security_prices` table `(ticker, price_date, close_cents, currency, source, fetched_at)`, unique `(ticker, price_date)`. Daily EOD refresh job (market-data module pattern: jitter, cache-and-fallback, recorded fixtures in tests, outage never breaks consumers).
- Provider adapters: **Stooq** (free, keyless, EOD — ETFs/stocks) primary; **Alpha Vantage** (free key `ALPHAVANTAGE_API_KEY`, covers mutual-fund NAVs e.g. VTSAX) fallback/secondary. Adapter interface so providers are swappable; respect free-tier rate limits (fetch only held tickers).

**Derived facts (→ #106 catalog + MCP aggregate tools):** `get_portfolio_value` (per account + total, market value = shares × latest close, with price + holdings as-of dates), `get_allocation` (percent by ticker/asset class vs targets from 12.4, drift per class).

**Acceptance:** declaring `VTI, 100 shares, as-of 2026-07-01` yields market value within one EOD close; provider outage serves last price with visible date; allocation drift matches hand-calc; stale holdings produce caveat.

---

## 12.3 Treasury Yields, Rate Watchlist, Earned APY

**Treasury adapter** (extends #104 market-data module): US Treasury fiscaldata API — 4-week/13-week/26-week/52-week bill yields + 2y/10y notes into `market_metrics` (`treasury_bill_13w` etc.). Note state-tax exemption as a stored attribute for evidence.

**Rate watchlist** — user-maintained candidate parking spots: `rate_watchlist` table `(id, user_id, institution, product_type: hysa|cd|mmf|treasury, apy_bps, term_months nullable, notes, updated_at)`. CRUD UI in Settings or Accounts. Freshness nag when `updated_at` > `WATCHLIST_STALE_DAYS` (default 45). Explicitly NOT scraped — user-entered advertised rates; Treasury/FRED rows are auto-populated.

**Earned APY (autonomous):** derive effective APY per account from interest-credit transactions (description patterns `INTEREST PAID|INTEREST PAYMENT|DIVIDEND` on checking/savings) over trailing 12 months ÷ average balance (balance-snapshot service). Exposed as `get_earned_apy` aggregate tool; evidence cites the interest transactions (dates + amounts) and the balance basis.

**Acceptance:** Treasury series refresh + fixtures; watchlist CRUD + staleness nag; earned-APY matches hand-calc on fixture ledger; all three exposed as MCP aggregate tools with `dataCaveat` support.

---

## 12.4 Suitability Settings & Investment Policy

User-entered, versioned (changes logged — a recommendation cites the policy version it used):
- `emergency_fund_target_months` (default 6), `liquidity_horizon_months`, `risk_tolerance` (`conservative|moderate|aggressive`), `tax_state` (for Treasury exemption framing), `monthly_investing_target_cents` (nullable = let the coach propose from surplus)
- **Target allocation**: list of `{assetClass, targetPercent}` (e.g. US equity 70 / intl 20 / bonds 10) + ticker→assetClass mapping for held tickers
- DCA policy: `dca_day_of_month`, `dca_amount_cents` (nullable)

Settings UI section with plain-language explanations. **Gate rule:** suitability-dependent recommendations (which vehicle, how much) require the relevant fields; missing → agent output states exactly which setting is missing instead of recommending. Tested.

---

## 12.5 Cash Manager Agent

**Schedule:** monthly + triggered by material rate moves (benchmark Δ ≥ 25bps) or balance changes (≥ 20% in liquid balances).
**Tools:** `get_account_balances`, `get_earned_apy`, `get_market_context` (FRED HYSA benchmark, Treasury yields), rate watchlist, `get_cash_runway`, suitability settings. Privacy class: `aggregates_cloud_ok`.
**Deterministic core** (`CashPlacementCalculator`, unit-tested): movable cash = liquid balances − max(emergency buffer per 12.4, 11.7 idle-cash buffer); for each watchlist/Treasury option compute annual delta vs current earned APY, after noting term/liquidity and state-tax treatment; rank by net benefit; threshold: recommend only if best option ≥ $100/yr improvement.
**Output:** recommendation with full evidence (current APY derivation, each candidate rate + as-of, buffer math, assumptions like "balances fresh as of…"), options-with-tradeoffs (liquid HYSA vs term-locked T-bill vs CD), impact range, expiry (rates move). Relationship to 11.7 idle-cash detector: detector = cheap monthly insight ("cash is idle"); Cash Manager = the full placement recommendation. Detector output links to/triggers the agent; no duplicate nagging (shared dedupe topic).

**Acceptance:** fixture scenario (idle $20k, watchlist with 4.0% HYSA, 13-week bill at 4.1%) produces ranked options with correct dollar deltas (hand-verified), citations for every number, and respects a prior "rejected: not_applicable" decision until inputs change materially.

---

## 12.6 Investment Coach Agent

**Schedule:** monthly (after month-end facts land) + on-demand from advisor chat.
**Tools:** `get_portfolio_value`, `get_allocation`, `get_savings_rate`, safe-to-spend engine (#102), suitability/policy (12.4), `get_market_context` (index levels for context only). Privacy class: `aggregates_cloud_ok`.
**Deterministic core** (`ContributionPlanner`, unit-tested):
1. Gate: emergency fund ≥ target months? If not → recommendation is "fund the buffer first" with the gap.
2. Investable surplus = trailing savings-rate surplus − goal contributions − DCA already scheduled.
3. Destination = most-underweight asset class vs target allocation (rebalance-by-contribution; never "sell X").
4. Timing = the DCA policy. **Timing-refusal contract:** prompted "is now a good time to buy?", the agent must answer with the policy framing (time-in-market, DCA schedule, allocation drift) and explicitly decline to predict — enforced by a test asserting refusal phrasing + absence of predictive claims.
**Output:** "contribute ~$X this month to <class> (currently Y% vs target Z%)" with evidence (surplus derivation, allocation math, policy version), assumptions, banded confidence, disclaimer. No specific-fund endorsements beyond funds the user already holds or has mapped in 12.4.

**Acceptance:** underfunded-emergency fixture → buffer-first recommendation; drifted-allocation fixture → correct class + amount (hand-verified); timing question → tested refusal; missing risk tolerance → "missing setting" output, no recommendation.

---

## 12.7 Savings Coach Upgrade

Upgrade existing watchdog/subscription outputs from observations to recommendations: monthly "savings actions" recommendation aggregating (a) subscription cancel/downgrade candidates with $/mo (from #103 price-creep + subscriptions detection + low-usage heuristics where derivable), (b) fee elimination candidates, (c) budget-pace trims — each with evidence rows and decision memory (rejected candidate stops reappearing). Impact stated as a range. Smallest stage; mostly composition over existing detectors.

---

## Out of Scope (Phase 12)

- Executing/drafting any transfer or trade; brokerage API write access of any kind
- Scraping bank/fund websites (incl. APY aggregator sites); per-bank live APY feeds
- Tax-loss harvesting, tax filing, insurance/mortgage-product selection
- Specific-security buy/sell calls or market predictions
- Real-time/intraday prices (EOD only)
- vNext capability runtime / event outbox / tool broker / prompt registry (rejected — see Origin)

## Cross-Cutting Validation

- Every deterministic calculator: fixture tests with hand-computed expectations; every agent: golden run + refusal/missing-settings/no-fire tests; numeric spot-check (11.9) on all narrated figures.
- Provider adapters: recorded fixtures, no live calls in CI.
- Privacy policy test: each agent's manifest tool allowlist ⊆ `AGGREGATE_TOOL_ALLOWLIST` for `aggregates_cloud_ok` agents; `local_only` agents never instantiate a cloud provider.
- Playwright: feed decision buttons, "How we got this" evidence panel, suitability settings gate.
