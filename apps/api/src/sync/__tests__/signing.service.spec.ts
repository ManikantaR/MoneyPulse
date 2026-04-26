import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SigningService } from '../signing.service';

describe('SigningService', () => {
  const signing = new SigningService();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T19:15:00.000Z'));
    process.env.SYNC_SIGNING_SECRET = 'sync-secret-test';
    process.env.SYNC_SIGNING_KEY_ID = 'sync-key-v1';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SYNC_SIGNING_SECRET;
    delete process.env.SYNC_SIGNING_KEY_ID;
  });

  it('produces signature metadata for canonical payload', () => {
    const signed = signing.signPayload(
      { eventType: 'budget.projected.v1', amountCents: 5000 },
      'idem-123',
    );

    expect(signed.keyId).toBe('sync-key-v1');
    expect(signed.idempotencyKey).toBe('idem-123');
    expect(signed.signature).toHaveLength(64);
    expect(new Date(signed.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('produces the same signature for equivalent payloads with different key order', () => {
    const left = signing.signPayload(
      { eventType: 'budget.projected.v1', nested: { b: 2, a: 1 } },
      'idem-123',
    );
    const right = signing.signPayload(
      { nested: { a: 1, b: 2 }, eventType: 'budget.projected.v1' },
      'idem-123',
    );

    expect(left.timestamp).toBe('2026-04-19T19:15:00.000Z');
    expect(right.signature).toBe(left.signature);
  });
});
