# MoneyPulse - Phase 14: Import Visibility Spec

> **Status**: Spec drafted; decisions partly resolved (see Resolved Decisions and Open Questions)
> **Created**: 2026-10-18
> **Repos**: `~/repo/MyMoney` (NAS API, web, shared, DB) **and** `~/repo/bank-statement-watcher` (laptop watcher agent). A small Home Assistant package change (owner's HA `/config` and the `HomeAssistant-scripts` repo) is listed separately.
> **Depends on**: Import Pipeline Radar phases 0-5a (PRs #240-#245: startup scan, stalled sweep, `file_uploads` as the pipeline spine, reprocess, visual pipeline, `statement_schedule` + `statement_overdue`, watcher-events), Phase 11.3 notification preferences, Phase 6 HA webhook.
> **Sync verdict**: `web: none`. No `apps/api/src/sync/` payload change. New notification types ride the existing `notification.projected.v1` contract (its `type` is a free string).
> **Constraint**: No secrets in code, specs, logs, or committed config. Fictional examples only (for example "Example Bank credit ••••1234", "Amy Example").

---

## Resolved Decisions (2026-10-18)

These were decided by the owner after the 2026-10-18 stuck-downloads diagnosis. **Where they conflict with anything below, these win.**

| # | Topic | Decision | Effect on the spec |
|---|---|---|---|
| 1 | Shape | Build the permanent fix as **Phase 14, slices S0-S6** (plus S1b). | Defines the Implementation Order. |
| 2 | Silence alarm | `watcher_silent` fires when the agent has been quiet **> 24h normally**, or **> 2h while any statement is due or overdue**. | Thresholds in `packages/shared` constants; sweep in S2. |
| 3 | Alert channels | **All three**: Telegram, Home Assistant phone push, and voice announcement (HA Voice PE and Alexa). Delivered **in sequence, 1 minute apart**, so HA and Alexa never speak at the same time. Dedupe and auto-resolve follow the Radar Phase 4 (`statement_overdue`, PR #243) conventions. | Staged Delivery Ladder (S2). |
| 4 | Python runtime | **Short term**: `brew pin python@3.14` (done 2026-10-18). **Long term**: a small **signed helper/wrapper app** is the TCC-responsible process, so privacy grants survive Python upgrades and the owner can stay on the latest Python. | Slice S1b. |
| 5 | Non-CSV downloads (PDF / XLS / XLSX) | **Recommended, pending owner confirmation**: stage to the NAS **only** when the filename or headers match a known bank/account pattern. Anything else is **ignored**: not reported individually, only counted in the heartbeat. Prevents unrelated personal PDFs from being pulled into MoneyPulse. | S1 detection rules; S2 heartbeat `ignoredCount`. |
| 6 | Bot-token hygiene | The watcher must **never log secrets**: drop urllib3/requests DEBUG logging and redact tokens in every log formatter. | S1 acceptance criterion. |

---

## North Star

**A bank statement that has reached the laptop is never invisible.** If it is not in MoneyPulse within minutes, MoneyPulse knows it exists, knows *why* it is stuck, says so on `/imports`, and reaches the owner on a channel that works even when the laptop agent itself is broken.

The 2026-10-18 incident is the acceptance test for the whole phase: four statement CSVs sat in `~/Downloads` for hours, the watcher mislabeled a macOS permission error as "unknown bank", every report was dead-lettered by a second macOS privacy denial, the Uptime Kuma heartbeat had been red for 14 days with no notifier, and `/imports` said "every import is healthy".

---

## Problem Summary (from the 2026-10-18 diagnosis)

| Root cause | Evidence | Fixed in |
|---|---|---|
| RC1: TCC denies the launchd-spawned Homebrew `Python.app` access to `~/Downloads` (EPERM). Grants are keyed by the ad-hoc binary's cdhash and are lost on every `brew upgrade`. | `[Errno 1] Operation not permitted` on every read and quarantine move. | S0 (grant), S1b (stable identity) |
| RC2: macOS Local Network privacy denies the same process LAN access (`[Errno 65] No route to host`) since 2026-10-04, while other processes on the Mac reach the NAS. | 218 failed Kuma heartbeats; all watcher-event POSTs fail in ms. | S0, S1b |
| RC3a: `detector._read_headers` swallows EPERM, so the file is reported as "unrecognized CSV headers / unknown bank". | All dead-letter records carry the false reason. | S1 |
| RC3b: no retry or periodic rescan; the plist has no `--scan`. Files missed or failed once are never revisited. | Files stay in Downloads indefinitely. | S1 |
| RC3c: Phase 5b moved per-failure alerts into MoneyPulse, but MoneyPulse never dispatches on ingestion outcomes, and the POST path is the broken one. | `recordWatcherEvent` only writes rows. | S1 (direct fallback), S2 |
| RC3d: MoneyPulse has no notion of the agent, no liveness expectation, and no inventory. | No agent table; health covers DB/Redis/Ollama only. | S2, S3 |
| RC3e: key-authed `failed` events with `slug="unknown"` return 202 `unmatched` and are not stored; orphaned rows with `userId = null` are hidden by user-scoped queries. | `ingestion.controller.ts` unmatched branch; `ingestion.service.ts` scoping. | S2 |
| RC3f: instant alerts in quiet hours (22:00-08:00) are silently dropped for external channels (`TODO(11.4)`). | `notifications.service.ts` dispatch. | S2 (deferral for Phase 14 types), S6 (general brief queue) |
| RC3g: the UI asserts health it cannot see; coverage shows "missing" even when the statement is on the laptop or failed on the NAS. | `/imports` empty state; `CoverageGrid`. | S2, S5 |
| Security (found in passing): the watcher's root logger is DEBUG, so urllib3 writes full Telegram bot and Kuma push URLs (with tokens) into local logs. | `watcher.py` root logger `setLevel(DEBUG)`. | S0 (rotate), S1 (never log) |

---

## Architecture Principles

1. **Local-first unchanged.** Laptop → NAS traffic stays inside the home network. Nothing new leaves the house except the generic notification text that Telegram and FCM already carry.
2. **The watcher is a reporting agent; MoneyPulse is the single judge of "stuck".** Matches the Phase 5 decision that MoneyPulse is the one alert spine.
3. **Absence is detected server-side.** The only signal that works when the agent is crashed, sandboxed, asleep, or offline is "expected heartbeat not received". The server holds the expectation.
4. **Pull, never push, to the laptop.** The Mac sleeps and has no inbound port. Commands ride on the heartbeat response.
5. **Minimum metadata.** Content hash, masked display name, size, mtime, extension, detected bank, slug. Never file contents or rows.
6. **Honest errors.** Every failure carries a reason code from one shared taxonomy, with a fixed remediation string. A permission error is never reported as a format error.
7. **Alerts follow the Radar Phase 4 rules.** Deterministic detector → dedupe key → notification row; consolidated per user per day; escalating severity; auto-resolve silently on the next healthy signal; snooze honored.
8. **Secrets never reach a log line**, in either repo.

---

## Rubber-Duck Review

Applied per `docs/agentic/rule-set.md` to this spec.

1. **Problem.** A statement downloaded to the laptop can fail before it reaches the NAS, and today nothing in MoneyPulse can see that it exists, why it failed, or that the watcher itself is broken. The owner learns about it only by noticing missing data.
2. **Smallest change that solves it.** Make the watcher honest about errors and permissions (S1, S1b), give MoneyPulse a heartbeat with diagnostics and a server-side silence alarm delivered through the staged ladder (S2). S2 alone would have caught the 2026-10-18 incident (agent silent > 2h while statements were due → Telegram, push, voice). S3-S5 add per-file visibility, actions, and correlation; S6 is optional.
3. **Invariants.**
   - The local-first boundary holds: no file contents leave the Mac; no filenames, slugs, or digits leave the house.
   - No `apps/api/src/sync/` payload shape changes (so no golden-fixture or moneypulse-web mirror work is triggered).
   - Every new notification type is registered in the `notification_type` enum and `DEFAULT_PREFERENCES` (the completeness spec stays green; see the 2026-08-22 regression where unregistered types were silently downgraded to in-app).
   - HA and Alexa never speak at the same time for a Phase 14 alarm.
   - Existing watcher-event and `file_uploads` flows keep working with an old watcher (new fields are optional).
4. **Validation.** Replay the incident: revoke the watcher's Downloads access and Local Network access, drop a fictional Example Bank CSV in Downloads, and confirm (a) the watcher's local status and direct Telegram fallback name the right System Settings pane, (b) MoneyPulse turns the strip red and runs the ladder once within the threshold, (c) restoring access processes the file and auto-resolves the alarm with no "resolved" spam. Plus unit/contract tests listed per slice.
5. **Next likely regression.**
   - Alert noise from a sleeping laptop (mitigated by the 24h normal threshold, per-episode dedupe, and the daily consolidation).
   - A new type that misses enum/preference registration and silently loses Telegram/HA.
   - Overlapping voice when two alarms open in the same minute (mitigated by a per-user voice lock, see the ladder).
   - TCC breaking again after a helper rebuild with a different signing identity (mitigated by the S1b designated-requirement check).
   - Privacy leak of last-4 digits in Telegram/FCM text, since `SYNC_PII_PATTERNS` does not catch 4-digit runs; mitigated by a producer-side unit test.

**Review outcome.** The review changed four things in the draft: (1) the S1 direct alert fallback goes to Telegram first, because Local Network denial blocks HA (LAN) but not Telegram (internet); (2) the voice stage is split into Voice PE then Alexa, because the existing `script.announce_all_media` fans out in parallel and would make them speak together; (3) `watcher_agents` gets a nullable key-hash column up front, so either answer to Open Question 2 needs no extra migration; (4) Phase 14 types get a narrow quiet-hours deferral in S2 instead of waiting for the general `TODO(11.4)` brief queue, so a night-time alarm is deferred, not dropped.

---

## File States and Reason Taxonomy

### States a statement file can be in

| # | State | Lives in | Visible today | Visible after |
|---|---|---|---|---|
| L0 | In Downloads; watcher never saw it (down/asleep at download time) | nowhere | No | S1 (rescan), S3 (inventory) |
| L1 | In Downloads, not CSV (xlsx/xls/pdf) | nowhere | No | S1 (staged if pattern matches, else counted), S3 |
| L2 | Seen, unstable or < 100 bytes, skipped once | `watcher.log` | No | S1 (re-checked next scan), S3 |
| L3 | Read failed (EPERM / encoding), mislabeled unknown bank | log, dead-letter | No | S1 (correct reason), S2/S3 |
| L4 | Quarantined `unknown-bank/` (or left in Downloads when the move failed) | quarantine dir | No | S3 |
| L5 | `failed` event with `slug="unknown"` | dropped by API (202 unmatched) | No | S2 (stored, owned) |
| L6 | Bank detected, no account match, quarantined `no-account-match/` | quarantine dir | No | S3, S4 (assign account) |
| L7 | Renamed, transfer retrying (mount missing) | `retry-queue.json` | Only after max retries | S2 (diagnostics), S3 |
| L8 | Report undeliverable (API unreachable) | `dead-letter.jsonl` | No | S2 (silence alarm), S1 (direct fallback) |
| L9-L10 | Staged on NAS, slug matches no account / unsupported ext | `file_uploads` orphaned, `userId` null | Stored but hidden | S2 (owner visibility) |
| L11-L15 | pending / processing / stalled / failed / empty / completed | `file_uploads` | Yes | unchanged; S5 adds coverage states |
| A0 | Never downloaded | absence + `statement_schedule` | `statement_overdue` | S5 (correlated text) |

### Reason taxonomy (shared enum)

Defined once in `packages/shared/src/constants/import-visibility.ts` as `IMPORT_REASON` and mirrored in the watcher (`reasons.py`) via a version-pinned JSON fixture (see Contracts):

`AGENT_SILENT, NO_DOWNLOADS_ACCESS, NO_LOCAL_NETWORK, NAS_MOUNT_MISSING, MISSED_WHILE_DOWN, UNSUPPORTED_TYPE, UNSTABLE_OR_TINY, READ_ERROR, UNKNOWN_BANK, NO_ACCOUNT_MATCH, RENAME_FAILED, TRANSFER_RETRYING, STAGED_NOT_INGESTED, SLUG_NO_ACCOUNT, PARSE_FAILED, STALLED, EMPTY, ALL_DUPLICATES, IGNORED_BY_USER`

Each reason maps to one fixed remediation string in `IMPORT_REASON_REMEDIATION`, for example:

- `NO_DOWNLOADS_ACCESS`: "System Settings → Privacy & Security → Files & Folders (or Full Disk Access) → enable *BankWatcher*, then run `./restart.sh`."
- `NO_LOCAL_NETWORK`: "System Settings → Privacy & Security → Local Network → enable *BankWatcher*."
- `NAS_MOUNT_MISSING`: "Reconnect the NAS share in Finder (the watcher retries automatically)."

Until S1b ships, the remediation names the interpreter path the heartbeat reports (`diagnostics.processPath`) instead of *BankWatcher*.

---

## Contracts

### Agent heartbeat (laptop → NAS), S2

`POST /api/ingestion/agent/heartbeat`, guarded by `IngestKeyOrJwtGuard` (per-agent key if Open Question 2 is accepted). Sent on start, on wake, every 5 minutes, and immediately after a scan that changes the inventory.

```jsonc
{
  "schemaVersion": 1,
  "agentId": "6f1c…",                 // random UUID persisted locally; never the hostname
  "version": "watcher@<git-sha>",
  "startedAt": "2026-10-18T09:00:00Z",
  "sentAt": "2026-10-18T09:05:00Z",
  "diagnostics": {
    "downloadsReadable": false,        // os.scandir(watch_dir) + 1-byte read probe
    "downloadsReason": "NO_DOWNLOADS_ACCESS",
    "nasMountPresent": true,           // mount dir exists + write-probe .probe file
    "deadLetterDepth": 3, "retryQueueDepth": 0, "quarantineDepth": 1,
    "ignoredCount": 7,                 // non-statement files skipped this scan (Decision 5)
    "lastScanAt": "…", "lastStagedAt": "…",
    "processPath": "~/Applications/BankWatcher.app",   // home dir collapsed to ~
    "pythonVersion": "3.14.x"
  },
  "inventory": []                      // S3; omitted or [] before S3
}
```

Response: `{ "commands": [] }` (populated from S4). An old watcher that never sends heartbeats keeps working; it simply shows as "never checked in".

### Inventory item (S3)

```jsonc
{
  "fileKey": "<sha256 of content>",       // equals file_uploads.fileHash after staging
  "displayName": "ExampleBank_Activity_••••.csv",   // digit runs ≥ 3 masked on the Mac
  "ext": "csv", "sizeBytes": 18234, "mtime": "…", "firstSeenAt": "…",
  "localState": "stuck | quarantined | retrying | staged | ignored",
  "reason": "NO_ACCOUNT_MATCH",
  "bank": "example-bank", "slug": null
}
```

When `downloadsReadable` is false the agent sends an empty inventory, and the UI says "can't see your Downloads", never "no files".

### Watcher-event extension (S1 sends, S2 stores)

`watcherEventSchema` gains optional `reason` (one of `IMPORT_REASON`) and `agentId`. The current schema is a plain `z.object`, which strips unknown keys, so S1 can send `reason` before S2 lands without breaking anything.

### Cross-repo contract pinning

The watcher is Python and cannot import `packages/shared`. S2 adds `packages/shared/fixtures/watcher-contract.v1.json` (reason enum, heartbeat and inventory example payloads), generated from the shared TS source by a test. The watcher repo keeps a verbatim copy at `tests/fixtures/watcher-contract.v1.json` with the source MyMoney commit in a header field, and a pytest asserts that `reasons.py` and the payload builders match it. A schema change here must update the copy in the same change window (same rule as the AGENTS.md sync-contract mirror). **This is not a sync contract**: nothing here is projected to the outbox or to moneypulse-web.

---

## Alarms

New server-side sweep `import-visibility-check` (BullMQ scheduler in `jobs.module.ts`, every 15 minutes), plus evaluation on every heartbeat for transitions.

| Type | Condition | Severity | Slice |
|---|---|---|---|
| `watcher_silent` | Agent `lastSeenAt` older than **24h**, or older than **2h** while any enabled `statement_schedule` for the agent's owner is due or overdue (today ≥ expected date, not yet satisfied, not snoozed) | warning; critical at 72h or when combined with `statement_overdue` | S2 |
| `watcher_unhealthy` | Latest heartbeat has `downloadsReadable=false`, `nasMountPresent=false`, or `deadLetterDepth > 0`, persisting > 1h (or > 15 min while a statement is due) | warning | S2 |
| `staged_not_ingested` | A watcher `staged` event with no matching `file_uploads.fileHash` after 15 min | warning | S2 |
| `statement_stuck` | Inventory item in `stuck`, `quarantined`, or `retrying`, `firstSeenAt` > 30 min ago, not ignored | warning; critical after 3 days | S3 |
| `import_failed` | `file_uploads` moved to failed / stalled / orphaned / empty (including watcher lightweight rows) | info; consolidated daily | S2 |

Constants (`packages/shared/src/constants/import-visibility.ts`): `WATCHER_SILENT_HOURS = 24`, `WATCHER_SILENT_DUE_HOURS = 2`, `WATCHER_SILENT_CRITICAL_HOURS = 72`, `WATCHER_UNHEALTHY_MINUTES = 60`, `STUCK_AFTER_MINUTES = 30`, `STUCK_CRITICAL_DAYS = 3`, `ESCALATION_STAGE_GAP_SECONDS = 60`.

### Dedupe, episodes, and auto-resolve (Radar Phase 4 conventions)

- Alarm state is a row in `pipeline_alarms` (one open row per `userId + type + scopeKey`, where `scopeKey` is the `agentId` or `fileKey`). Opening a row is an **episode**.
- An episode opening, or a severity increase within an episode, sends **one instant message** through the Staged Delivery Ladder. `dedupeKey = <type>:<scopeKey>:<episodeOpenedAt>:<severity>`, checked with the existing `findByMetadata` helper.
- While any episode is open, the owner gets **one consolidated "Import pipeline" message per day** (`dedupeKey = import_pipeline:<userId>:<yyyy-mm-dd>`) listing every open alarm, through Telegram and HA push only (no voice).
- `import_failed` never runs the ladder; it appears only in the daily consolidated message and in-app.
- **Auto-resolve**: the next healthy heartbeat, or the import that clears the item, sets `resolvedAt` and cancels any pending ladder stages. No "resolved" push. The in-app row is marked resolved.
- **Snooze**: per-alarm snooze (1 day / 1 week) from `/imports`; a snoozed episode sends nothing until the snooze ends.

---

## Staged Delivery Ladder (Decision 3)

New `AlertEscalationService` (`apps/api/src/notifications/alert-escalation.service.ts`) and BullMQ queue `alert-escalation`. `createAndDispatch` keeps writing the in-app row and the outbox projection as today. For types whose preference has `delivery: 'staged'` (all Phase 14 alarm types), it hands the external channels to the ladder instead of the parallel fan-out.

| Step | Offset | Channel | Text rules |
|---|---|---|---|
| 0 | T+0 | Telegram (`telegram-push.service.ts`) | Generic: counts, account nickname at most. No filename, slug, or digits (cloud). |
| 1 | T+60s | HA phone push: webhook with `delivery: "push"` → HA `notify.mobile_app_<owner_phone>` | Local; nickname allowed, no digits. Tap opens `/imports`. |
| 2 | T+120s | HA voice, Voice PE: webhook with `delivery: "voice", voiceTarget: "voice_pe"` | `voiceSummary` only, no digits ("Two bank statements are stuck on your laptop"). |
| 3 | T+180s | Alexa: webhook with `delivery: "voice", voiceTarget: "alexa"` | Same `voiceSummary`. |

The decision asks for the three channels a minute apart so that HA and Alexa never speak together. The current `script.announce_all_media` speaks on both in parallel, so the voice channel is split into two steps a minute apart. If the owner prefers a single voice step on one speaker, set the voice targets preference to one device; the ladder skips the missing step without moving the others.

Rules:

- Each step is a delayed BullMQ job with `jobId = <notificationId>:<step>`, so retries and double-dispatches cannot duplicate a step.
- Before sending, each step re-reads the alarm. If it is resolved, snoozed, or acknowledged (the notification was marked read in-app), the step and all later steps are cancelled.
- **Per-user voice lock**: a Redis lock `voice:<userId>` held for `ESCALATION_STAGE_GAP_SECONDS`. If a second alarm's voice step lands while the lock is held, it is pushed back by one gap, so two alarms can never talk over each other.
- A failed step is logged and does not block later steps (best effort, same as today's dispatch).
- **Quiet hours (22:00-08:00)**: per Open Question 3's recommended default, steps 0-1 deliver and steps 2-3 are **deferred** to quiet-hours end (not dropped) and re-checked then. This is a narrow deferral for ladder steps only. The general `TODO(11.4)` brief queue stays in S6.
- Backward compatible: webhook calls without `delivery` keep today's HA behavior (persistent notification + `announce_all_media`) for every other type.

HA side (outside both repos, listed for completeness): `packages/moneypulse.yaml` routes on `delivery` / `voiceTarget`; new `script.announce_voice_pe` and `script.announce_alexa` (single target each, same quiet-hours and per-type mute gates); new `input_boolean.moneypulse_mute_import_pipeline`. Applied through the HA config API and committed to the `HomeAssistant-scripts` repo with entity IDs genericized.

---

## Surfacing (web)

- **`WatcherStatusStrip`** at the top of `/imports`: green / amber / red, last seen, version, failed probes with their remediation lines. Replaces the "every import is healthy" empty state, which becomes "Can't confirm: watcher last checked in 3 days ago" whenever the agent is silent or unhealthy. (S2)
- **"On your laptop"** group at the top of Needs attention: inventory items with reason badge and actions; watcher-originated failed rows and owner-visible orphaned rows also appear here. (S3, actions S4)
- **Swim-lane**: when a `file_uploads` row matches an inventory `fileKey`, Downloaded/Detected use real laptop timestamps; inventory-only items render a lane that stops at the failing node. (S3)
- **Coverage grid**: new cell states `stuck` and `failed`; clicking opens an explanation popover (Process now / Upload manually / Snooze) instead of a silent snooze; fixes red cells before an account's start month. (S5)
- **Dashboard banner** on `/`, reusing the `DashboardSetupBanner` pattern, shown only on red. (S2)
- **Bell click-through**: Phase 14 notifications carry `data.href = '/imports'`. (S2)
- **Weekly digest**: "Import pipeline" section (received / stuck / failed / overdue, agent last seen); the watcher's local `--digest` is retired. (S5)

---

## Data Model

All tables are user-scoped (`user_id` FK), like Phase 13. None are projected to the outbox.

```text
watcher_agents        (S2) id, user_id, agent_id (unique), key_hash NULL, version, process_path,
                           python_version, started_at, last_seen_at, last_diagnostics jsonb,
                           created_at, updated_at
pipeline_alarms       (S2) id, user_id, type, scope_key, severity, opened_at, last_notified_at,
                           snoozed_until NULL, resolved_at NULL, notification_id NULL
                           unique (user_id, type, scope_key) WHERE resolved_at IS NULL
watcher_inventory     (S3) id, user_id, agent_id, file_key, display_name, ext, size_bytes, mtime,
                           first_seen_at, last_seen_at, local_state, reason, bank, slug NULL,
                           upload_id NULL (FK file_uploads, linked by hash), ignored_at NULL
                           unique (agent_id, file_key)
watcher_commands      (S4) id, user_id, agent_id, file_key NULL, action, args jsonb,
                           status (pending|delivered|done|failed), result jsonb, created_at, updated_at
                           unique (agent_id, file_key, action) WHERE status IN ('pending','delivered')
```

`display_name` and `slug` are encrypted with the existing AES-GCM field helpers (same as `last_four`), pending Open Question 1.

Migrations (next free numbers after `0041_statement_schedule.sql`):

- `0042_watcher_agents_pipeline_alarms.sql`
- `0043_notification_type_import_visibility.sql`: enum rebuild (0036/0040 pattern, no `ALTER TYPE ADD VALUE` in a transaction) adding `watcher_silent`, `watcher_unhealthy`, `staged_not_ingested`, `statement_stuck`, `import_failed`, `import_pipeline_daily`
- `0044_watcher_inventory.sql`
- `0045_watcher_commands.sql`
- `db/migrations/meta/_journal.json` updated with each

---

## Slices

### S0 - Unblock today (operator, no code)

- Grant the daemon's interpreter **Files & Folders → Downloads** (or Full Disk Access) and **Local Network**; restart with `./restart.sh`. `brew pin python@3.14` is done (2026-10-18) so the grant holds until S1b.
- Run `watcher.py --scan-only` once to process files left in Downloads.
- Add a notification channel to the Kuma push monitor and send a test.
- Verify prod Telegram env (`TELEGRAM_BOT_TOKEN`, chat map) is set and `telegramNotificationsEnabled` is on for the owner, without printing values.
- **Rotate the Telegram bot token** and the Kuma push token (both were written to local watcher logs), then clear the old local log files.
- Document the TCC / Local Network / brew-upgrade gotcha in the watcher `README.md`.
- Land this spec and its `SPEC-INDEX.md` row.

**Acceptance**: dead-letter `watcher-event` lines flush to 0; every file stuck on 2026-10-18 reaches `file_uploads` (completed or a visible failure); the Kuma monitor is green and its test alert arrives; the rotated tokens work and the old ones are revoked.

### S1 - Watcher self-honesty (bank-statement-watcher)

- Always scan at startup and every 10 minutes (no `--scan` dependency); re-check unstable or tiny files on the next scan instead of dropping them.
- `_read_headers` re-raises `PermissionError`; EPERM maps to `NO_DOWNLOADS_ACCESS` (no quarantine attempt), other read errors to `READ_ERROR`. Every `failed` event and dead-letter record carries `reason`.
- Startup and per-heartbeat self-test: `os.scandir(watch_dir)` + 1-byte read, NAS mount write probe, TCP connect to the MoneyPulse host. Results go to `~/.local/share/bank-watcher/status.json` and `watcher.py --status`.
- **Direct alert fallback**: when the MoneyPulse POST fails, or the self-test finds `NO_DOWNLOADS_ACCESS` / `NO_LOCAL_NETWORK`, send **one alert per outage** directly via Telegram first (internet, works under Local Network denial), then HA (LAN), naming the System Settings pane. Phase 5b's "avoid double alert" applies only when the POST succeeded. The local macOS toast is also deduped to one per outage.
- Non-CSV (Decision 5, recommended): PDF / XLS / XLSX are staged only when the filename or headers match a configured bank/account pattern (`config.yaml` `statement_patterns`); everything else increments `ignoredCount` and is never logged by name.
- Collision-proof rename: `<slug>_MMDDYY_HHMMSS_<hash6>.<ext>`, and never overwrite an existing destination.
- **Secret hygiene (Decision 6)**: root logger at INFO; `urllib3`, `requests`, and `http.client` loggers pinned to WARNING; a `RedactingFormatter` on every handler masks Telegram bot tokens (`bot<id>:<token>` paths), Kuma push tokens, `X-Ingest-Key` values, and any `?token=` / `key=` query values.
- Plist: the committed `com.<owner>.bank-watcher.plist` template still names the retired anaconda interpreter; `install.sh` templates the real interpreter (S1) or the helper app (S1b) instead.

**Files** (watcher): modify `watcher.py`, `detector.py`, `reporter.py`, `alerts.py`, `notifier.py`, `transfer.py`, `config.yaml.example`, `com.<owner>.bank-watcher.plist`, `install.sh`, `README.md`, `tests/test_process_file.py`, `tests/test_reporter.py`; create `diagnostics.py`, `reasons.py`, `log_redaction.py`, `tests/test_diagnostics.py`, `tests/test_log_redaction.py`, `tests/test_scan.py`.

**Acceptance** (pytest unless noted):

1. An EPERM fixture on read yields reason `NO_DOWNLOADS_ACCESS`, no quarantine attempt, and the file is retried on the next scan.
2. A file present before start is processed with no CLI flags; an "unstable" file is processed on the next scan once stable.
3. A matched fictional Example Bank `.xlsx` is staged; an unmatched `.pdf` is not staged, not logged by name, and increments `ignoredCount`.
4. A failed POST plus `NO_LOCAL_NETWORK` sends exactly one direct Telegram alert per outage (mocked), and one more only after a recovery-then-failure.
5. **Secrets**: with DEBUG-level requests to a fake Telegram URL containing a token, the captured log output from every handler contains neither the token nor the Kuma push token nor the ingest key; urllib3 emits nothing below WARNING. Manual check: `grep` of `~/.local/share/bank-watcher/*.log` after a day of running finds no token pattern.
6. Two files for the same account within one second get distinct names; an existing destination is never overwritten.
7. `make test` passes.

### S1b - Signed helper app as the TCC-responsible process (bank-statement-watcher)

**Problem.** TCC and Local Network grants for an ad-hoc-signed Homebrew `Python.app` are keyed by its cdhash, which changes on every Python upgrade or rebuild. Pinning Python is a stopgap that keeps the owner off the latest Python.

**Design.**

- A minimal macOS app bundle, `BankWatcher.app` (Swift, single `main.swift`, no UI, `LSUIElement = YES`), installed to `~/Applications/`.
- Its executable spawns the venv interpreter (`~/.local/share/bank-watcher/venv/bin/python watcher.py …`) as a **child process without disclaiming responsibility**, forwards signals, and exits with the child's status (so launchd `KeepAlive` still works). macOS attributes the child's privacy access to the responsible app, so the grants attach to `BankWatcher.app`, not to Python.
- `Info.plist` includes `NSLocalNetworkUsageDescription` (and the Bonjour key only if needed) so the Local Network prompt names the app.
- Signed with a **stable identity**: a Developer ID certificate if the owner has one, otherwise a locally created self-signed code-signing certificate in the login keychain. TCC then keys the grant by the designated requirement (identifier + certificate), which is stable across rebuilds of the helper and across Python upgrades.
- launchd plists (`watcher`, `digest`) point at `BankWatcher.app/Contents/MacOS/BankWatcher` with the watcher arguments.
- `install.sh --helper` builds (`swiftc`), signs, and verifies (`codesign --verify --strict` and a check that the designated requirement matches the recorded one); `install.sh --rebuild-venv` recreates the venv on the newest installed Python without touching the helper.
- The heartbeat reports `processPath` = the helper path and `pythonVersion`; remediation strings name *BankWatcher*.
- After S1b is verified, `brew unpin python@3.14` and document the upgrade path in the README.

**Files** (watcher): create `helper/BankWatcher/main.swift`, `helper/BankWatcher/Info.plist`, `helper/build.sh`, `tests/test_helper_contract.py` (plist and install-script checks that run without signing); modify `install.sh`, `com.<owner>.bank-watcher.plist`, `com.<owner>.bank-watcher-digest.plist`, `restart.sh`, `Makefile`, `README.md`.

**Acceptance**:

1. With the helper installed and granted once, `brew unpin python@3.14 && brew upgrade python` (or installing a newer major Python and `install.sh --rebuild-venv`), then a reboot: the watcher reads Downloads and reaches the NAS with **no new grant** (heartbeat shows `downloadsReadable: true` and arrives on the NAS).
2. Rebuilding the helper with the same certificate keeps the grants; `install.sh` refuses to install a helper whose designated requirement differs from the recorded one unless `--accept-new-identity` is passed, and then prints the exact re-grant steps.
3. Killing the Python child makes the helper exit non-zero and launchd restarts it; `SIGTERM` to the helper stops the child cleanly.
4. System Settings → Privacy & Security lists *BankWatcher* (not Python) under Files & Folders and Local Network.
5. No secrets in the helper, its plist, or its build logs.

### S2 - Agent heartbeat, silence alarm, staged ladder, ownership fixes (MyMoney + small watcher change)

- Heartbeat endpoint, `WatcherAgentService` (upsert `watcher_agents`, evaluate transitions), sweep `import-visibility-check`, alarms `watcher_silent`, `watcher_unhealthy`, `staged_not_ingested`, `import_failed`, daily consolidated message.
- `AlertEscalationService` + `alert-escalation` queue implementing the ladder, voice lock, quiet-hours deferral, and cancel-on-resolve.
- Webhook payload gains optional `delivery`, `voiceTarget`; Telegram unchanged.
- Ownership: store key-authed `slug="unknown"` failed events (owned by the agent's user, or `INGEST_DEFAULT_USER_ID`); show owner-visible orphaned / null-user rows in `listUploads`, `getPipelineSummary`, `getUploadStatus`; add `xls` to the NAS startup scan.
- Shared: reason enum, remediation map, constants, heartbeat zod schema, contract fixture.
- Web: `WatcherStatusStrip`, honest empty state, dashboard red banner, bell click-through.
- Watcher: `reporter.send_heartbeat()`, heartbeat loop replaces the Kuma-only loop (Kuma ping is kept as a secondary signal).

**Files** (MyMoney):

- Create: `apps/api/src/ingestion/watcher-agent.service.ts`, `apps/api/src/ingestion/watcher-agent.controller.ts`, `apps/api/src/ingestion/import-visibility.detector.ts`, `apps/api/src/notifications/alert-escalation.service.ts`, `apps/api/src/ingestion/__tests__/watcher-agent.service.spec.ts`, `apps/api/src/ingestion/__tests__/import-visibility.detector.spec.ts`, `apps/api/src/notifications/__tests__/alert-escalation.service.spec.ts`, `apps/api/src/notifications/__tests__/import-visibility-privacy.spec.ts`, `packages/shared/src/constants/import-visibility.ts`, `packages/shared/fixtures/watcher-contract.v1.json`, `db/migrations/0042_watcher_agents_pipeline_alarms.sql`, `db/migrations/0043_notification_type_import_visibility.sql`, `apps/web/src/components/WatcherStatusStrip.tsx`, `apps/web/src/lib/hooks/useWatcherAgents.ts`, `apps/web/src/__tests__/watcher-status-strip.spec.tsx`
- Modify: `apps/api/src/db/schema.ts`, `db/migrations/meta/_journal.json`, `apps/api/src/ingestion/ingestion.controller.ts`, `apps/api/src/ingestion/ingestion.service.ts`, `apps/api/src/ingestion/ingestion.module.ts`, `apps/api/src/ingestion/watcher.service.ts`, `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/notifications/notification-preferences.service.ts`, `apps/api/src/notifications/webhook.service.ts`, `apps/api/src/notifications/notifications.module.ts`, `apps/api/src/jobs/jobs.module.ts`, `apps/api/src/jobs/alert-cron.processor.ts`, `packages/shared/src/types/index.ts`, `packages/shared/src/validation/index.ts`, `packages/shared/src/index.ts`, `apps/web/src/app/(protected)/imports/page.tsx`, `apps/web/src/components/DashboardSetupBanner.tsx` (or a sibling `PipelineHealthBanner.tsx`), `apps/web/src/components/NotificationBell.tsx`

**Files** (watcher): modify `reporter.py`, `watcher.py`, `notifier.py`; create `tests/test_heartbeat.py`, `tests/fixtures/watcher-contract.v1.json`, `tests/test_contract.py`.

**Files** (HA, outside both repos): `packages/moneypulse.yaml`, `packages/voice_announce.yaml` in `HomeAssistant-scripts` and live `/config`.

**Acceptance**:

1. Stop the watcher; with no statement due, nothing fires before 24h; with a fictional schedule due, `watcher_silent` opens after 2h. The strip turns red with "last seen".
2. The ladder delivers Telegram at T+0, HA push at T+60s, Voice PE at T+120s, Alexa at T+180s (fake timers in `alert-escalation.service.spec.ts`; manual check on real devices). No two voice steps overlap, including two alarms opened in the same minute.
3. Restarting the watcher auto-resolves the alarm: pending steps are cancelled, the strip turns green, and no "resolved" message is sent.
4. Marking the notification read in-app before T+120s cancels both voice steps.
5. An alarm opening at 23:00 delivers Telegram and push, defers both voice steps to 08:00, and drops them if resolved before then.
6. A heartbeat with `downloadsReadable:false` turns the strip amber with the `NO_DOWNLOADS_ACCESS` remediation; persisting > 1h opens `watcher_unhealthy`.
7. A key-authed `failed` event with `slug="unknown"` is stored, owned, and visible on `/imports`; an orphaned row is visible to its owner.
8. **Privacy**: a unit test asserts that Telegram text, FCM projection title/body, and `voiceSummary` for every Phase 14 type contain no filename, slug, or run of 3 or more digits.
9. `notification-type-completeness.spec.ts` is green; each new type is in `DEFAULT_PREFERENCES` with `delivery: 'staged'` (except `import_failed` and the daily message).
10. Contract test: the watcher fixture matches `packages/shared` (both repos).
11. `pnpm build`, `pnpm test`, `pnpm db:migrate` pass; the watcher's `make test` passes.

### S3 - Downloads inventory, "On your laptop", stuck alert

- Watcher `inventory.py`: enumerate top-level Downloads files with ext in {csv, xlsx, xls, pdf}; report only detected statements or pattern matches (Decision 5); mask digit runs ≥ 3 in display names; content sha256 as `fileKey`; send on change or every 6th heartbeat.
- API: upsert `watcher_inventory`, link to `file_uploads` by hash, auto-mark `ALL_DUPLICATES` / already imported; `GET /api/ingestion/agent/inventory`; `statement_stuck` alarm.
- Web: "On your laptop" group, inventory-backed swim-lane nodes.

**Files** (MyMoney): create `db/migrations/0044_watcher_inventory.sql`, `apps/web/src/components/LaptopInventoryList.tsx`, `apps/api/src/ingestion/__tests__/watcher-inventory.spec.ts`, `apps/web/src/__tests__/laptop-inventory.spec.tsx`; modify `schema.ts`, `_journal.json`, `watcher-agent.service.ts`, `watcher-agent.controller.ts`, `import-visibility.detector.ts`, `packages/shared/src/validation/index.ts`, `packages/shared/fixtures/watcher-contract.v1.json`, `apps/web/src/app/(protected)/imports/page.tsx`, `apps/web/src/components/ImportSwimLane.tsx`, `apps/web/src/lib/hooks/useWatcherAgents.ts`.

**Files** (watcher): create `inventory.py`, `tests/test_inventory.py`; modify `reporter.py`, `watcher.py`, `tests/fixtures/watcher-contract.v1.json`.

**Acceptance**:

1. A fictional Example Bank CSV with no matching account shows under "On your laptop" with `NO_ACCOUNT_MATCH` within one heartbeat, and opens `statement_stuck` after 30 min (one ladder run).
2. Once the account is added and the file processes, the item clears and the alarm resolves silently.
3. The inventory never contains file contents; display names are digit-masked (unit test in both repos).
4. With Downloads unreadable, the UI says "can't see your Downloads", not "no files".

### S4 - Actions (process, assign account, ignore, rescan, manual upload)

- `watcher_commands` queue delivered in the heartbeat response; ack via `POST /api/ingestion/agent/commands/:id/ack` or the next heartbeat.
- Actions: Process now / Retry; Assign account (forced slug, optional "remember" filename hint); Ignore (`ignored.json` on the Mac, `IGNORED_BY_USER` on the server); Rescan; Upload manually (`/upload?accountId=` prefill).
- Buttons are disabled with the remediation text when the agent is stale or a probe is red, so nothing is queued that cannot run.

**Files** (MyMoney): create `db/migrations/0045_watcher_commands.sql`, `apps/api/src/ingestion/__tests__/watcher-commands.spec.ts`; modify `schema.ts`, `_journal.json`, `watcher-agent.controller.ts`, `watcher-agent.service.ts`, `LaptopInventoryList.tsx`, `apps/web/src/app/(protected)/upload/page.tsx`, `useWatcherAgents.ts`, `packages/shared/src/validation/index.ts`.

**Files** (watcher): create `commands.py`, `tests/test_commands.py`; modify `watcher.py`, `matcher.py` (forced slug), `state.py` (`ignored.json`).

**Acceptance**:

1. Assign account on a `NO_ACCOUNT_MATCH` item stages the file under the chosen slug on the next awake heartbeat (≤ 5 min) and it imports.
2. Ignore survives rescans and restarts.
3. Double-click is idempotent (dedupe on `agent_id + file_key + action`).
4. With a stale agent, buttons are disabled and "Upload manually" is offered.

### S5 - Correlation (overdue text, coverage, digest)

- `statement_overdue` text branches: agent healthy and no inventory item → current text; inventory item matched → "Your {account nickname} statement is on your laptop but hasn't been processed: {reason}"; agent silent or unhealthy → "Your laptop watcher hasn't checked in since {time}; statements may be stuck there."
- Coverage cell states `stuck` and `failed`, explanation popover, pre-start-month fix.
- Weekly digest "Import pipeline" section and `voiceSummary`; retire the watcher's `--digest` and its launchd plist.

**Files** (MyMoney): modify `apps/api/src/analytics/statement-schedule.service.ts`, `apps/api/src/analytics/digest.service.ts`, `apps/api/src/analytics/__tests__/statement-schedule.service.spec.ts`, `apps/web/src/components/CoverageGrid.tsx`, `apps/web/src/lib/hooks/useStatementSchedule.ts`. **Files** (watcher): remove the digest plist and `--digest` path, update `install.sh` and `README.md`.

**Acceptance**: an overdue account with a matched stuck item says "on your laptop", not "download it"; a month with a failed upload renders `failed`, not `missing`; the weekly digest lists stuck / failed / overdue counts and agent last seen.

### S6 (optional) - One-tap from phone, general brief queue

- HA actionable notification on the push step → `rest_command` → MoneyPulse command API (needs an HA-held, per-agent-scoped key), **or** Telegram inline buttons (`callback_query` in `advisor/telegram.service.ts`). Recommendation: HA first, since it already works locally.
- Land the general `TODO(11.4)` brief queue so quiet-hours deferral covers every type, then fold the S2 narrow deferral into it.

**Acceptance**: tapping "Process now" on the phone push queues the same command as the UI button, and the action is idempotent; a non-Phase-14 instant notification in quiet hours is delivered at quiet-hours end instead of being dropped.

---

## Privacy and AGENTS.md Fit

- **Mac → NAS (inside the home)**: masked display name, content sha256, size, mtime, ext, detected bank, slug, diagnostics. Never file contents or rows. Filenames that do not match a statement pattern are never sent or logged (Decision 5).
- **Leaves the house**: only Telegram text and the FCM `notification.projected.v1` title/body, both generic (counts and nicknames at most). `SYNC_PII_PATTERNS` does not catch 4-digit runs, so the producer enforces it (S2 acceptance 8).
- **Sync contract**: no shape change, no golden fixture change, no moneypulse-web mirror trigger. A future web "pipeline health" glance would be a new `*.projected.v1` contract and would need the mirror.
- **Secrets**: none in the spec, code, plists, logs, or HA repo; watcher log redaction is an S1 gate; S0 rotates the tokens already exposed in local logs.

---

## Validation Plan

MyMoney:

```bash
pnpm --filter @moneypulse/api test ingestion
pnpm --filter @moneypulse/api test notifications
pnpm --filter @moneypulse/api test analytics
pnpm --filter @moneypulse/web test
pnpm db:migrate
pnpm build
pnpm test
```

bank-statement-watcher:

```bash
make test                      # pytest
./install.sh --helper          # S1b, on the Mac
python watcher.py --status     # local diagnostics
```

Manual incident replay (after S2; repeat after S3 and S1b):

1. Revoke the watcher's Downloads and Local Network access in System Settings.
2. Copy a fictional Example Bank CSV into `~/Downloads`.
3. Confirm: `--status` names both failures; one direct Telegram fallback arrives; after the threshold MoneyPulse runs the ladder once (Telegram, push, Voice PE, Alexa, one minute apart); `/imports` shows red with remediation.
4. Restore access; confirm the file imports, the alarm resolves with no extra message, and the strip turns green.

---

## Out of Scope

- Parsing new statement formats (QFX/OFX), bank-site scraping, or automatic downloading.
- Any moneypulse-web (Firestore) surface for pipeline health.
- Multiple laptops per household beyond what `watcher_agents` already allows (the schema supports it; the UI shows a list without special handling).
- Email delivery (`TODO(11.3)`).

---

## Open Questions

Each has a recommended default that implementation may assume unless the owner overrides it.

| # | Question | Recommended default |
|---|---|---|
| 1 | Store masked filenames on the NAS? | **Yes**, digit runs masked on the Mac, stored encrypted. |
| 2 | Per-agent watcher key vs the shared `INGEST_API_KEY`? | **Per-agent key bound to the user** (hash in `watcher_agents.key_hash`), issued from Settings → Laptop watcher; `INGEST_API_KEY` + `INGEST_DEFAULT_USER_ID` kept as a fallback. Also narrows the shared-key blast radius flagged in PR #245. |
| 3 | May stuck/silent alerts break quiet hours (22:00-08:00)? | **Telegram + phone push yes, voice no**: voice steps defer to 08:00. |
| 4 | One-tap from phone (S6)? | **Optional**; build after S4 if wanted, HA actionable first. |
| 5 | The 3 old quarantined files (1 unknown-bank, 2 no-account-match, from August-September)? | **Leave them in place** (never auto-delete). Once S3/S4 land they appear under "On your laptop" as quarantined items for Assign account or Ignore. Before then, the owner can upload them manually if wanted. |
| 6 | Non-CSV staging rule (Decision 5) | Recommended rule above, **pending owner confirmation**. |

---

## Implementation Order

1. **S0** operator unblock and this spec (no code).
2. **S1** watcher self-honesty and secret hygiene.
3. **S1b** signed helper app; then unpin Python.
4. **S2** heartbeat, silence alarm, staged ladder, ownership fixes (this alone catches a repeat of 2026-10-18).
5. **S3** inventory and "On your laptop".
6. **S4** actions.
7. **S5** correlation.
8. **S6** optional one-tap and the general brief queue.

S1 and S1b can proceed in parallel with S2 (S2's server side does not need the new watcher, only the heartbeat sender). Each slice lands as its own PR (or one PR per repo for cross-repo slices), with the watcher fixture and the shared fixture updated together.
