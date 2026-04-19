import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SigningService } from '../signing.service';

describe('SigningService', () => {
  const signing = new SigningService();

  beforeEach(() => {
    process.env.SYNC_SIGNING_SECRET = 'sync-secret-test';
    process.env.SYNC_SIGNING_KEY_ID = 'sync-key-v1';
  });

  afterEach(() => {
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
});
