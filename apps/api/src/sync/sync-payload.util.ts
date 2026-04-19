import { createHash } from 'crypto';

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, normalizeValue(entryValue)]),
    );
  }

  return value;
}

export function canonicalizeSyncPayload(
  payload: Record<string, unknown>,
): string {
  return JSON.stringify(normalizeValue(payload));
}

export function hashSyncPayload(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalizeSyncPayload(payload))
    .digest('hex');
}