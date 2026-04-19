# Phase 9 Sync Domain Spec - Local to Firebase Projection

## Purpose

Build a secure, one-way sync domain in the local MoneyPulse API that projects de-identified financial data to the Firebase web app.

## Non-Negotiable Constraints

1. Source of truth stays local.
2. No reverse-sync endpoint is exposed by local API.
3. No direct PII or account-number-derived values are sent.
4. Every outbound event is signed and auditable.
5. Failed deliveries are retryable and end in a dead-letter queue.

## Scope

### In Scope

- outbox_events table and lifecycle
- sanitizer-v2 service (strict allowlist and denylist)
- alias mapper service (deterministic pseudonyms)
- signing service (HMAC signatures)
- delivery worker with retry policy and DLQ
- policy tests and audit trail for sync decisions

### Out of Scope

- bi-directional data synchronization
- auto-apply cloud-origin edits to local data
- replication of raw AI prompt text

## Architecture

1. Domain producers write normalized event payloads to outbox_events in the same transaction as domain changes.
2. Delivery worker polls pending outbox rows in FIFO order.
3. Payload passes sanitizer-v2 and banned-field policy checks.
4. Alias mapper rewrites local identifiers to alias identifiers.
5. Signing service computes payload signature with nonce and timestamp.
6. Worker sends event to Firebase ingestion endpoint.
7. Result is recorded in sync audit logs and outbox status is updated.
8. Permanent failures move to dead-letter state for manual replay.

## Database Design

### Table: outbox_events

Suggested columns:

- id uuid primary key
- event_type varchar(80) not null
- aggregate_type varchar(80) not null
- aggregate_id uuid not null
- user_id uuid not null
- household_id uuid null
- payload_json jsonb not null
- payload_hash varchar(64) not null
- schema_version integer not null default 1
- idempotency_key varchar(128) not null unique
- status varchar(24) not null default pending
- policy_passed boolean null
- policy_reason text null
- attempts integer not null default 0
- next_attempt_at timestamptz not null default now()
- last_error_code varchar(64) null
- last_error_message text null
- delivered_at timestamptz null
- dead_lettered_at timestamptz null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Indexes:

- idx_outbox_status_next_attempt on (status, next_attempt_at)
- idx_outbox_user_created on (user_id, created_at desc)
- idx_outbox_aggregate on (aggregate_type, aggregate_id)

### Optional Table: alias_mappings

- id uuid primary key
- user_id uuid not null
- entity_type varchar(40) not null
- local_entity_id uuid not null
- alias_id varchar(64) not null
- alias_version integer not null default 1
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- unique(entity_type, local_entity_id)
- unique(entity_type, alias_id)

### Table: sync_audit_logs

- id bigserial primary key
- outbox_event_id uuid not null
- user_id uuid null
- action varchar(40) not null
- payload_hash varchar(64) not null
- policy_passed boolean not null
- policy_reason text null
- signature_kid varchar(64) null
- attempt_no integer not null
- http_status integer null
- error_code varchar(64) null
- error_message text null
- created_at timestamptz not null default now()

## Service Design

### sanitizer-v2 service

Path suggestion:

- apps/api/src/sync/sanitizer-v2.service.ts

Responsibilities:

1. Enforce outbound schema allowlist by event type.
2. Remove or reject banned fields.
3. Run advanced token scrub for:
- email, phone, account/routing patterns, address-like strings
- raw merchant free-text with potential identity markers
- any field tagged as pii in schema metadata
4. Emit policy decision with reason codes.

Required reason codes:

- POLICY_PASS
- POLICY_FAIL_BANNED_FIELD
- POLICY_FAIL_PATTERN_MATCH
- POLICY_FAIL_SCHEMA

### alias mapper service

Path suggestion:

- apps/api/src/sync/alias-mapper.service.ts

Responsibilities:

1. Map local IDs to deterministic alias IDs.
2. Never output local UUIDs in outbound payload.
3. Support alias versioning for key rotation.

Recommended alias formula:

- alias = base32url(HMAC_SHA256(ALIAS_SECRET_vN, entity_type + ':' + local_id))

### signing service

Path suggestion:

- apps/api/src/sync/signing.service.ts

Responsibilities:

1. Create canonical payload string.
2. Produce HMAC signature with key id.
3. Attach headers:
- x-mp-signature
- x-mp-key-id
- x-mp-timestamp
- x-mp-idempotency-key

### delivery worker

Path suggestion:

- apps/api/src/jobs/sync-delivery.processor.ts

Responsibilities:

1. Pull due events where status in (pending, retry).
2. Backoff strategy: exponential with jitter.
3. Max attempts: 8 before dead-letter.
4. Mark delivered on 2xx only.
5. Persist every attempt in sync_audit_logs.

Retry policy example:

- attempt 1: immediate
- 2: 30s
- 3: 2m
- 4: 10m
- 5: 30m
- 6: 2h
- 7: 8h
- 8: 24h then dead-letter

## API and Routing Rules

1. Local API must not expose any route that accepts Firebase-origin writes for financial entities.
2. Any future cloud-edit support must go through command mailbox, never direct mutation route.
3. Add test guard to fail if route patterns contain:
- /sync/import
- /sync/apply
- /firebase/pull

## Event Contracts

Minimum event types for MVP:

- account.projected.v1
- transaction.projected.v1
- category.projected.v1
- budget.projected.v1
- notification.projected.v1
- ai_summary.projected.v1

Each contract must include:

- event_id
- event_type
- schema_version
- occurred_at
- user_alias_id
- household_alias_id
- body

## Test Plan

### Policy tests

Path suggestions:

- apps/api/src/sync/__tests__/sanitizer-v2.spec.ts
- apps/api/src/sync/__tests__/policy-guard.spec.ts

Required cases:

1. Reject outbound payload containing banned field names:
- email
- accountNumber
- routingNumber
- lastFour
- originalDescriptionRaw
- promptText
- outputText
2. Reject outbound payload containing pattern-level PII.
3. Pass sanitized payload with expected reason POLICY_PASS.

### Routing tests

Path suggestion:

- apps/api/test/sync-no-reverse-route.e2e-spec.ts

Required case:

- Assert no reverse sync write endpoints are reachable.

### Worker tests

Path suggestion:

- apps/api/src/jobs/__tests__/sync-delivery.processor.spec.ts

Required cases:

1. Success path marks delivered and writes audit row.
2. Transient failure increments attempts and schedules retry.
3. Max-attempt failure dead-letters and records reason.
4. Signature header present and valid format.

## Observability

Metrics to expose:

- sync_outbox_pending_count
- sync_delivery_success_total
- sync_delivery_failure_total
- sync_dead_letter_total
- sync_policy_fail_total
- sync_delivery_latency_ms

Log fields per attempt:

- outbox_event_id
- event_type
- idempotency_key
- payload_hash
- policy_passed
- policy_reason
- attempt
- http_status
- duration_ms

## Implementation Order

1. DB migration for outbox_events and sync_audit_logs.
2. Add sync module skeleton and interfaces.
3. Implement sanitizer-v2 and alias mapper.
4. Implement signing service and outbound client.
5. Implement delivery processor and retry scheduling.
6. Add policy tests and no-reverse-route tests.
7. Add dashboards/metrics and operator runbook.

## Exit Criteria

1. Sync events delivered with signed headers and idempotency keys.
2. All outbound payloads pass sanitizer-v2 policies.
3. Banned-field and no-reverse-route tests pass in CI.
4. Audit log entries exist for every delivery attempt with payload hash and policy result.
5. Dead-letter workflow and manual replay runbook documented.
