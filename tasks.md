# MoneyPulse — Roadmap & Tasks

Living index of in-flight work. GitHub issues are the source of truth; this is the map.
**Deploy:** `echo "y" | ./deploy-to-nas.sh [api|web|all|db:migrate]` (api spawns the bundled
MCP server over stdio; `db:migrate` runs migrations). Domain `https://moneypulse.home.manikantar.com`.

## 🚀 Epic: AI Financial Advisor (#36)

Private, self-hosted advisor over real finances. **LLM is the interface; deterministic code is the math engine; every number is traceable.** Aggregates-only leave the NAS.

| Phase | Issue | Status |
|---|---|---|
| Phase 0 — MCP server (semantic layer, user-scoped tools) | #37 | ✅ Merged (#41) |
| Phase 1 — Ask-your-money NL chat (web + Telegram) | #38 | ✅ Merged (#49) — deployed |
| Phase 2 — Weekly digest (proactive) | #39 | ✅ Merged (#51) — deployed |
| Phase 3 — Goal planners (car / college / safe-to-spend) | #40 | ⏳ Planned |

### Providers (advisor is provider-agnostic — Settings → AI Advisor)
Claude (#49) · OpenAI (#49) · **Gemini** (#57, `@google/genai`, thought_signature handled #59).
Key precedence: env (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GOOGLE_API_KEY`) → encrypted DB key
(needs `ENCRYPTION_KEY`). Default models: `claude-opus-4-8` / `gpt-4o` / `gemini-2.5-flash`.
**To use: set a provider key in Settings → AI Advisor (stored encrypted) or NAS `.env`.**

## 🔧 Advisor tool-coverage expansion (in progress)

MCP tools the advisor can call (aggregates-only allowlist in `mcp-client.service.ts`):
`get_account_balances`, `get_spending_summary`, `get_category_breakdown` (+parent subtotals #61),
`get_budget_status`, `compare_periods`, `get_recurring_expenses`, `get_merchant_breakdown` (#63),
`get_cashflow_summary` · `get_income_breakdown` · `get_net_worth` (#65, +investments #75),
`get_upcoming_bills` · `get_subscriptions` (#75). Row-level
`get_transactions`/`search_transactions` are **excluded** from the cloud allowlist.

Providers use **per-provider keys** (#73/#74): each of Claude/OpenAI/Gemini stores its own
encrypted key; inline switcher in the advisor header; active-provider badge; default
`gemini-3.5-flash`. Migration 0010 added the key columns.

| Batch | Tools | Status |
|---|---|---|
| 1a | cash flow + savings rate, income breakdown, net worth (current + trend) | ✅ #65 deployed |
| 1b-1 | net worth incl. investments, upcoming bills, subscriptions | ✅ #75 |
| 1b-2 | cash-flow forecast / safe-to-spend | ✅ #82 |
| 1c | category trend, budget history, unusual-charges feed | ✅ #85 |

Bills roll-forward (#84, done): daily sweep advances overdue `next_expected_date` to the next
future occurrence (+ runs once on boot) so `get_upcoming_bills` + forecast + digest bills work.

### Big features (own phases — need schema/design)
- **Loan payoff tracker** (mortgage + auto) — Phase 1 backend done (#88): `loans` table (migration 0011),
  amortization engine (`apps/mcp-server/src/lib/amortization.ts`), `get_loan_status` MCP tool (balance,
  principal/interest paid, extra principal, payoff date, "add $X/mo → months+interest saved"), CRUD `/loans`.
  **Next:** seed the user's loans via `POST /loans` (lender pattern, initial balance, apr_bps, start date,
  scheduled payment, extra-principal pattern); auto-split scheduled P+I vs extra-principal txns;
  missing-payment detection; Loans web page; payoff nudges in the digest.
- **Internet-trends weekly digest**: extend Phase-2 digest with web research (mortgage rates via FRED,
  savings tips) so it proactively makes the user "financially smarter."
- **Digest → Telegram (#79)**: add Telegram as a delivery channel for the weekly advisor recap +
  basic digests, per-user toggle, reuse `TELEGRAM_CHAT_MAP`. Two-way chat bot is already built
  (#49/#53) — just needs `TELEGRAM_BOT_TOKEN` in the NAS `.env`.
- Per-vendor breakdown within a category — **done** via `get_merchant_breakdown` (#63).
- Advisor chat renders markdown/GFM tables (#77, done).

### Locked design decisions
- Provider abstraction (#49/#57): one normalized LLM adapter; MCP tools as JSON-Schema; write-only key (AES-256-GCM); global config.
- Weekly digest (#51): deterministic signals → LLM ranks/narrates top 3–5 (no tools, no new numbers) → notifications + Home Assistant, ISO-week dedupe. Opt-in `user_settings.advisor_digest_enabled`.
- **Aggregates only** to cloud (raw statements/account numbers/descriptions stay on NAS); merchant tools use cleaned merchant names, never raw description.
- **Refuse-don't-guess**; LLM never does arithmetic; provenance on every number.
- Advisor prompt injects **today's date** (`ADVISOR_TIMEZONE`, default America/New_York) so relative periods resolve; match user wording to the category/parent names the tools actually return (#59/#61).
- External data via free APIs (FRED, BLS CE) for the trends digest.

### Infra / deploy notes
- MCP server is **bundled into the API image** (#43): `MCP_SERVER_ENTRY=/app/mcp-server/dist/index.js`, spawned over stdio, reuses the API's `DATABASE_URL`.
- Telegram advisor is **long-polling** (out-dial `getUpdates`, #53) — no inbound URL (LAN-only). Off until `TELEGRAM_BOT_TOKEN` set.
- `deploy-to-nas.sh` prunes `apps/`+`packages/` before extract (#54) so deleted files don't linger and break the build.

## ✅ Recently shipped
- #67 — transactions showed one day early (UTC-midnight dates rendered in local tz) — format in UTC
- #65 — advisor Batch 1a: cash flow + savings rate, income breakdown, net worth (current + trend)
- #63 — `get_merchant_breakdown` (top vendors, optional category filter)
- #61 — match category wording to real taxonomy + parent subtotals in get_category_breakdown
- #59 — Gemini thought_signature fix + inject current date into advisor prompt
- #57 — add Google Gemini provider
- #54 — deploy prune stale source · #53 — Telegram webhook → long-polling · #43 — bundle MCP into API image
- #51 — Phase 2 weekly digest · #49 — Phase 1 advisor + provider abstraction
- #50 — migration idempotency / NAS drift fix · #48 — forecast local-date parse

## Backlog (unscheduled)
- #42 — triage leftover sync-status/transactions branch
- #22 — Year-over-Year comparison · #27 — Dependabot deps bump
