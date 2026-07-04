# @moneypulse/mcp-server

Read-only [MCP](https://modelcontextprotocol.io) server exposing MoneyPulse finances as
tools an AI client (Claude, etc.) can call. This is the **semantic layer** for the AI
Financial Advisor (epic #36) — each tool encapsulates one correct, user-scoped aggregation
so the model never writes SQL or does arithmetic.

## Tools (8)

| Tool | Returns |
|---|---|
| `get_account_balances` | Per-account computed balances + credit utilization (aggregate) |
| `get_spending_summary` | Spend by category for a date range (aggregate) |
| `get_category_breakdown` | Category/sub-category totals + counts (aggregate) |
| `get_budget_status` | Budget vs spent per category (aggregate) |
| `get_recurring_expenses` | Merchants with ≥N occurrences in a window (aggregate) |
| `compare_periods` | Per-category spend delta between two ranges (aggregate) |
| `get_transactions` | Recent transaction rows (**row-level**) |
| `search_transactions` | Transaction rows matching text (**row-level**) |

## Privacy boundary

Every tool is scoped to a single user (see below) and computes in Postgres. Six tools return
**aggregates only**; `get_transactions` / `search_transactions` return **raw rows** and are
intended for local use. When wiring the cloud advisor (Phase 1, #38), the "aggregates-only to
cloud" rule means: do **not** expose the two row-level tools to the cloud model, or redact
descriptions/merchant strings first.

## Configuration (env)

| Var | Purpose |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Postgres connection |
| `MONEYPULSE_USER_ID` | User to scope all tools to. If unset, the sole user in the DB is used; the server errors if the DB has multiple users. |
| `MCP_PORT` | Port for SSE mode (default 3100) |

## Run

```bash
pnpm --filter @moneypulse/mcp-server build
pnpm --filter @moneypulse/mcp-server start:stdio   # stdio transport (local MCP clients)
pnpm --filter @moneypulse/mcp-server start:sse     # HTTP/SSE transport
pnpm --filter @moneypulse/mcp-server test          # user-scoping guardrail
```

## Next steps

- Wire the container into the NAS `docker-compose` (deployment).
- Phase 1 (#38): advisor chat consuming these tools with the aggregates-only boundary.
