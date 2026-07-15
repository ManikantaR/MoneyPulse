import { describe, it, expect } from 'vitest';
import { SanitizerV2Service } from '../sanitizer-v2.service';

describe('SanitizerV2Service', () => {
  const sanitizer = new SanitizerV2Service();
  const eventType = 'transaction.projected.v1';

  const basePayload = {
    transactionAliasId: 'a1_1111111111111111111111111111111111111111',
    accountAliasId: 'a1_2222222222222222222222222222222222222222',
    amountCents: 1250,
    date: '2026-07-01T00:00:00.000Z',
    categoryId: 'a1_3333333333333333333333333333333333333333',
    isCredit: false,
    isTransfer: false,
    isManual: false,
    tags: ['groceries'],
  };

  it('rejects payloads containing banned fields after schema validation passes', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      email: 'user@example.com',
    });

    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_SCHEMA');
    expect(result.policyReasonDetail).toContain('Unrecognized key: "email"');
  });

  it('rejects payloads containing pii-like patterns', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      tags: ['123-45-6789'],
    });

    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('passes and keeps safe payloads', () => {
    const result = sanitizer.sanitizePayload(eventType, basePayload);

    expect(result.policyPassed).toBe(true);
    expect(result.policyReason).toBe('POLICY_PASS');
    expect(result.sanitizedPayload).toEqual(basePayload);
  });

  it('rejects unknown sync event types', () => {
    const result = sanitizer.sanitizePayload('unknown.projected.v1', basePayload);

    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_SCHEMA');
    expect(result.policyReasonDetail).toBe(
      'Unknown sync event type: unknown.projected.v1',
    );
  });
});
