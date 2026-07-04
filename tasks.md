# MoneyPulse — Roadmap & Tasks

Living index of in-flight work. GitHub issues are the source of truth; this is the map.

## 🚀 Epic: AI Financial Advisor (#36)

Private, self-hosted advisor over real finances. **LLM is the interface; deterministic code is the math engine; every number is traceable.** Aggregates-only leave the NAS.

| Phase | Issue | Status |
|---|---|---|
| Phase 0 — MCP server (semantic layer, 8 user-scoped tools) | #37 | ✅ Merged (#41) |
| Phase 1 — Ask-your-money NL chat (MVP) | #38 | ✅ Merged (#49) — deployed |
| Phase 2 — Weekly digest (proactive) | #39 | 🔀 In review (#51) |
| Phase 3 — Goal planners (car / college / safe-to-spend) | #40 | ⏳ Planned |

**Deferred / later:** real-time nudges, in-app insights feed, draft-actions-to-approve, mortgage & insurance modules.

### Supporting tasks
| Task | Issue | Status |
|---|---|---|
| Wire MCP server into NAS docker-compose | #43 | ⏳ Open |
| Triage leftover sync-status/transactions branch | #42 | ⏳ Open |

### Locked design decisions
- **Provider abstraction (shipped in #49):** Claude *or* OpenAI, selectable in Settings → AI Advisor. Single normalized LLM adapter layer; MCP tools passed as JSON-Schema to either. API key stored write-only (AES-256-GCM in DB via `ENCRYPTION_KEY`) with env-var precedence (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). Global (one config per app). Ollama skipped (weak tool-calling breaks grounding).
- **Weekly digest (#51):** deterministic signals (category WoW deltas, top drivers, upcoming bills, subscription price changes, anomalies from #32) → LLM ranks/narrates top 3–5 with **no tools**, no new numbers → notification center + Home Assistant, ISO-week dedupe. Opt-in via `user_settings.advisor_digest_enabled`; sweep gated on advisor configured. Cron `advisor-digest-weekly` Mon 13:00 UTC.
- Cloud Claude (`claude-opus-4-8`) default for reasoning; **aggregates only** to cloud (raw statements/account numbers stay on NAS).
- MCP tools = semantic layer; **refuse-don't-guess**, never free-form SQL, LLM never does arithmetic.
- Provenance on every number; independent verifier pass; "insights, not advice" framing.
- External data via free APIs (FRED, BLS CE); recurrence = merchant-group + modal-interval + tolerance + jitter (≥3).

## ✅ Recently shipped (notification thread)
- #49 — Advisor Phase 1 chat + provider abstraction (Claude/OpenAI, web-configurable, encrypted key)
- #50 — migration idempotency: made 0002/0003/0006 replay-safe + added 0007/0008; fixed NAS `__drizzle_migrations` drift (only 0000/0001 were recorded), so `db:migrate` now succeeds cleanly
- #48 — forecast bill dates parsed as local calendar dates (UTC off-by-one)
- #28 — notification dropdown opaque/readable
- #30 — Tailwind v4 `@theme` design tokens (fixed app-wide `bg-card` no-op)
- #32 — statistical spending-anomaly baselines (cut false positives)
- #34 — notification center v2 (dismiss, grouping, severity, timestamps)

## Backlog (unscheduled)
- #22 — Year-over-Year comparison
- #27 — Dependabot deps bump
