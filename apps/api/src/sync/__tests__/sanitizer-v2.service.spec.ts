import { describe, it, expect } from 'vitest';
import { SanitizerV2Service } from '../sanitizer-v2.service';

describe('SanitizerV2Service', () => {
  const sanitizer = new SanitizerV2Service();

  it('rejects payloads containing banned fields', () => {
    const result = sanitizer.sanitizePayload({
      event: 'transaction.projected.v1',
      email: 'user@example.com',
    });

    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_BANNED_FIELD');
    expect(result.bannedField).toBe('email');
  });

  it('rejects payloads containing pii-like patterns', () => {
    const result = sanitizer.sanitizePayload({
      event: 'transaction.projected.v1',
      description: 'transfer to 123-45-6789',
    });

    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('passes and keeps safe payloads', () => {
    const result = sanitizer.sanitizePayload({
      event: 'transaction.projected.v1',
      merchantToken: 'merchant_9bc1',
      amountCents: 1250,
    });

    expect(result.policyPassed).toBe(true);
    expect(result.policyReason).toBe('POLICY_PASS');
    expect(result.sanitizedPayload).toEqual({
      event: 'transaction.projected.v1',
      merchantToken: 'merchant_9bc1',
      amountCents: 1250,
    });
  });
});
