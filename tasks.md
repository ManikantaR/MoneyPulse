# MoneyPulse — Roadmap & Tasks

Living index of in-flight work. GitHub issues are the source of truth; this is the map.

## 🚀 Epic: AI Financial Advisor (#36)

Private, self-hosted advisor over real finances. **LLM is the interface; deterministic code is the math engine; every number is traceable.** Aggregates-only leave the NAS.

| Phase | Issue | Status |
|---|---|---|
| Phase 0 — MCP server (semantic layer, 8 user-scoped tools) | #37 | ✅ Merged (#41) |
| Phase 1 — Ask-your-money NL chat (MVP) | #38 | 🔜 In progress |
| Phase 2 — Weekly digest (proactive) | #39 | ⏳ Planned |
| Phase 3 — Goal planners (car / college / safe-to-spend) | #40 | ⏳ Planned |

**Deferred / later:** real-time nudges, in-app insights feed, draft-actions-to-approve, mortgage & insurance modules.

### Supporting tasks
| Task | Issue | Status |
|---|---|---|
| Wire MCP server into NAS docker-compose | #43 | ⏳ Open |
| Triage leftover sync-status/transactions branch | #42 | ⏳ Open |

### Locked design decisions
- Cloud Claude (`claude-opus-4-8`) for reasoning; **aggregates only** to cloud (raw statements/account numbers stay on NAS).
- MCP tools = semantic layer; **refuse-don't-guess**, never free-form SQL, LLM never does arithmetic.
- Provenance on every number; independent verifier pass; "insights, not advice" framing.
- External data via free APIs (FRED, BLS CE); recurrence = merchant-group + modal-interval + tolerance + jitter (≥3).

## ✅ Recently shipped (notification thread)
- #28 — notification dropdown opaque/readable
- #30 — Tailwind v4 `@theme` design tokens (fixed app-wide `bg-card` no-op)
- #32 — statistical spending-anomaly baselines (cut false positives)
- #34 — notification center v2 (dismiss, grouping, severity, timestamps)

## Backlog (unscheduled)
- #22 — Year-over-Year comparison
- #27 — Dependabot deps bump
