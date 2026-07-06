# Phase 1 — Ask-your-money advisor chat (spec)

Part of the AI Financial Advisor epic (#36). Implements #38. Foundation merged in #41 (MCP server).

## Goal

Let the user ask natural-language questions about their finances ("how much did I
spend on dining in Q2?", "am I over budget?", "which subscriptions recur?") and get
a **grounded, cited** answer — or an honest refusal — over two surfaces: an in-app
web chat and a Telegram bot. Both ride one shared streaming advisor endpoint.

## North star (from research)

The **LLM is the interface; deterministic code is the math engine; every number is
traceable.** The model never writes SQL and never does arithmetic — it calls the
MCP tools (which compute in Postgres) and narrates their verified results.

## Locked decisions

- **Model:** `claude-opus-4-8`, adaptive thinking, **streaming**, manual tool-use loop.
- **Data access:** MCP client (agent-native). The advisor connects to the merged
  `@moneypulse/mcp-server` and passes its tools to Claude.
- **Aggregates-only to cloud:** of the 8 MCP tools, only the **6 aggregate** tools are
  exposed to the cloud model. `get_transactions` and `search_transactions` return
  raw rows and are **excluded** — enforced by an allowlist in the MCP client service.
- **Refuse-don't-guess:** no tool covers the question → say so; never fabricate a number.
- **Provenance + disclaimer:** answers reference the tool data behind each figure and
  carry a persistent "insights, not financial advice" note.
- **Surfaces:** in-app web chat **and** Telegram bot.

## Required secrets (NAS-only `.env`, user-provided)

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude provider key. **Optional** — can instead be set via the web Settings UI (stored encrypted). Env takes precedence over the DB value. |
| `OPENAI_API_KEY` | OpenAI provider key. Same rules as above. |
| `GOOGLE_API_KEY` | Google Gemini provider key (from Google AI Studio). Same rules as above. |
| `ENCRYPTION_KEY` | 64-char hex (32 bytes). Reused from PII encryption; **required to store a provider key via the web UI** (AES-256-GCM at rest). |
| `TELEGRAM_BOT_TOKEN` | Telegram bot (from @BotFather). The API **long-polls** (out-dials `getUpdates`) — no inbound URL is exposed (LAN-only deployment). |
| `TELEGRAM_CHAT_MAP` | Optional `chatId:userId,…` allowlist. If unset, single-user mode maps every chat to the sole user. |
| `TELEGRAM_DEFAULT_USER_ID` | Fallback user id for unmapped chats (single-user setups). |
| `MCP_SERVER_CMD` / `MCP_SERVER_ARGS` | How to spawn the MCP server over stdio (default: node on the built `apps/mcp-server`). |

### Provider selection

The advisor is provider-agnostic (Claude / OpenAI / Gemini), selectable from **Settings → AI Advisor**
(global, one config for the app). Provider/model/key resolve as: provider env key first,
then the encrypted DB key. The key is write-only in the UI (shown masked, never returned).
"Test connection" validates credentials before you rely on them.

## Architecture

```
Web chat  ─┐                         ┌─ MCP client (stdio) ─▶ @moneypulse/mcp-server ─▶ Postgres
Telegram  ─┴─▶ AdvisorService ──────▶│   (6 aggregate tools only)
                 │  Claude Opus 4.8 streaming tool-use loop
                 │  system prompt (aggregates-only, refuse-don't-guess, provenance, not-advice)
                 └─▶ AiLogsService (promptType 'advisor', PII flags)
```

## Backend (`apps/api/src/advisor/`)

- **`mcp-client.service.ts`** — lazily connects one MCP `Client` over `StdioClientTransport`.
  `listAdvisorTools()` returns MCP tools **filtered to the aggregate allowlist**
  (`get_account_balances`, `get_spending_summary`, `get_category_breakdown`,
  `get_budget_status`, `get_recurring_expenses`, `compare_periods`) mapped to Anthropic
  tool defs. `callTool(name, args)` proxies to the server (rejects non-allowlisted names).
  Graceful shutdown closes the transport.
- **`advisor.service.ts`** — `streamChat(userId, message, history?)` async generator.
  Builds the system prompt, runs the Claude streaming manual tool-use loop (append full
  `response.content`; return all `tool_result`s in one user turn; loop to `end_turn`),
  yields text deltas, and logs the turn to `AiLogsService`. Missing `ANTHROPIC_API_KEY`
  → a clear, non-crashing error surfaced to the caller.
- **`advisor.controller.ts`** — `POST /advisor/chat` (JWT-guarded) → SSE stream of
  `{ type: 'delta'|'done'|'error', text }`. `userId` from `@CurrentUser`.
- **`telegram.service.ts`** — long-polls the Bot API (`getUpdates`, out-dial only; no inbound
  endpoint). Maps `chat_id → userId` via the allowlist, sends a typing action, runs the advisor
  (collect the stream to a final message), and replies via the Bot API (`fetch`). Started/stopped
  on module init/destroy; `deleteWebhook` is called first so polling isn't blocked.
- **`advisor.module.ts`** — wires the above; imports `AiLogsModule`.
- **`ai-logs.service.ts`** — extend `promptType` union with `'advisor'`.

## Web (`apps/web/`)

- `lib/hooks/useAdvisorChat.ts` — POSTs to `/advisor/chat`, reads the SSE stream, exposes
  `messages`, `send`, `isStreaming`, `error`.
- `app/(protected)/advisor/page.tsx` — chat panel (message list, streaming assistant
  bubble, input, empty/error states) using the now-working design tokens (#30).
- Sidebar entry.

## Guardrails / system prompt (essentials)

- Answer **only** from tool results; if no tool fits, refuse honestly.
- **Never compute** — call a tool for every number; quote the tool's figure verbatim.
- Attach provenance ("based on your spending summary for …").
- Frame product/rate suggestions as options-with-tradeoffs; append the not-advice note.
- Keep raw account numbers / statement text out of the conversation (tools return aggregates).

## Testing

- **Vitest (api):** advisor.service tool-loop (mocked Anthropic + mocked MCP client) —
  grounded answer, refusal path, "narrated number == tool number", and **aggregates-only**
  (row-level tools never offered to Claude); telegram auth mapping + secret rejection;
  mcp-client allowlist filtering.
- **Build gate:** `nest build` + `next build`.
- **Live E2E is gated on the two secrets** — documented, not a CI gate.

## Out of scope (later phases)

Independent verifier pass (#38 follow-up), weekly digest (#39), goal planners (#40),
voice surface. MCP compose wiring is #43.
