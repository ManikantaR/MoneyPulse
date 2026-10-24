/**
 * Phase 14 (Import Visibility) — shared reason taxonomy, remediation copy,
 * and alarm thresholds. Mirrored verbatim (not imported — the watcher is
 * Python) in `bank-statement-watcher/reasons.py` via
 * `packages/shared/fixtures/watcher-contract.v1.json`. A change here must
 * update that fixture and the watcher's copy in the same change window —
 * same rule as the AGENTS.md sync-contract mirror. See
 * specs/PHASE14-IMPORT-VISIBILITY-SPEC.md "File States and Reason Taxonomy".
 */

export const IMPORT_REASON = [
  'AGENT_SILENT',
  'NO_DOWNLOADS_ACCESS',
  'NO_LOCAL_NETWORK',
  'NAS_MOUNT_MISSING',
  'MISSED_WHILE_DOWN',
  'UNSUPPORTED_TYPE',
  'UNSTABLE_OR_TINY',
  'READ_ERROR',
  'UNKNOWN_BANK',
  'NO_ACCOUNT_MATCH',
  'RENAME_FAILED',
  'TRANSFER_RETRYING',
  'STAGED_NOT_INGESTED',
  'SLUG_NO_ACCOUNT',
  'PARSE_FAILED',
  'STALLED',
  'EMPTY',
  'ALL_DUPLICATES',
  'IGNORED_BY_USER',
] as const;

export type ImportReason = (typeof IMPORT_REASON)[number];

/**
 * Fixed remediation string per reason. Until S1b ships the signed helper
 * app, callers should substitute `diagnostics.processPath` for the literal
 * app name in the Files & Folders / Local Network lines (see spec: "Until
 * S1b ships, the remediation names the interpreter path").
 */
export const IMPORT_REASON_REMEDIATION: Record<ImportReason, string> = {
  AGENT_SILENT:
    'The laptop watcher has not checked in. Confirm the Mac is on and the watcher is running (`./restart.sh`).',
  NO_DOWNLOADS_ACCESS:
    'System Settings -> Privacy & Security -> Files & Folders (or Full Disk Access) -> enable BankWatcher, then run `./restart.sh`.',
  NO_LOCAL_NETWORK:
    'System Settings -> Privacy & Security -> Local Network -> enable BankWatcher.',
  NAS_MOUNT_MISSING:
    'Reconnect the NAS share in Finder (the watcher retries automatically).',
  MISSED_WHILE_DOWN:
    'The watcher was down when this file arrived; it will be picked up on the next scan once restarted.',
  UNSUPPORTED_TYPE:
    'This file type is not staged automatically. Upload it manually if it is a statement.',
  UNSTABLE_OR_TINY:
    'The file looked incomplete (still downloading or near-empty); it will be re-checked on the next scan.',
  READ_ERROR:
    'The watcher could not read this file. Check the watcher log for details.',
  UNKNOWN_BANK:
    'The file headers did not match a known bank format. Upload it manually or add a pattern for this bank.',
  NO_ACCOUNT_MATCH:
    'A bank was detected but no MoneyPulse account matches it yet. Assign an account from /imports.',
  RENAME_FAILED:
    'The watcher could not rename this file on disk. Check filesystem permissions in Downloads.',
  TRANSFER_RETRYING:
    'The file is queued to transfer to the NAS and will retry automatically.',
  STAGED_NOT_INGESTED:
    'The file reached the NAS but has not been ingested yet. Check /imports for the stalled job.',
  SLUG_NO_ACCOUNT:
    'The staged file is tagged with an account slug that no longer matches an account.',
  PARSE_FAILED:
    'The file was staged but failed to parse. Review the error on /imports and reprocess.',
  STALLED:
    'Processing started but did not finish. Reprocess the file from /imports.',
  EMPTY:
    'The file parsed with zero rows. Confirm it is the right statement and reprocess if not.',
  ALL_DUPLICATES:
    'Every row in this file already exists. No action needed.',
  IGNORED_BY_USER:
    'This file was marked ignored. Un-ignore it from /imports if that was a mistake.',
};

/** Decision 2 (2026-10-18): silence + unhealthy thresholds. */
export const WATCHER_SILENT_HOURS = 24;
export const WATCHER_SILENT_DUE_HOURS = 2;
export const WATCHER_SILENT_CRITICAL_HOURS = 72;
export const WATCHER_UNHEALTHY_MINUTES = 60;
export const WATCHER_UNHEALTHY_DUE_MINUTES = 15;
export const STUCK_AFTER_MINUTES = 30;
export const STUCK_CRITICAL_DAYS = 3;
export const STAGED_NOT_INGESTED_MINUTES = 15;

/** Decision 3: staged delivery ladder gap between steps. */
export const ESCALATION_STAGE_GAP_SECONDS = 60;

/** Heartbeat contract version. Bump alongside the watcher fixture. */
export const WATCHER_CONTRACT_SCHEMA_VERSION = 1;
