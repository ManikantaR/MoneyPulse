import { describe, it, expect } from 'vitest';
import { SanitizerV2Service } from '../sanitizer-v2.service';

describe('SanitizerV2Service — policy guard: banned fields', () => {
  const sanitizer = new SanitizerV2Service();
  const eventType = 'transaction.projected.v1';
  const basePayload = {
    transactionAliasId: 'a1_1111111111111111111111111111111111111111',
    accountAliasId: 'a1_2222222222222222222222222222222222222222',
    amountCents: 2500,
    date: '2026-07-01T00:00:00.000Z',
    categoryId: 'a1_3333333333333333333333333333333333333333',
    isCredit: false,
    isTransfer: false,
    isManual: false,
    tags: ['groceries'],
  };

  const bannedCases: Array<[string, Record<string, unknown>]> = [
    ['email', { ...basePayload, email: 'user@example.com' }],
    ['accountNumber', { ...basePayload, accountNumber: '12345678' }],
    ['routingNumber', { ...basePayload, routingNumber: '021000021' }],
    ['lastFour', { ...basePayload, lastFour: '4242' }],
    ['originalDescriptionRaw', { ...basePayload, originalDescriptionRaw: 'raw text' }],
    ['promptText', { ...basePayload, promptText: 'what is...' }],
    ['outputText', { ...basePayload, outputText: 'categorized as food' }],
  ];

  it.each(bannedCases)(
    'rejects payload containing banned field: %s',
    (field, payload) => {
      const result = sanitizer.sanitizePayload(eventType, payload);
      expect(result.policyPassed).toBe(false);
      expect(result.policyReason).toBe('POLICY_FAIL_SCHEMA');
      expect(result.policyReasonDetail).toContain(`Unrecognized key: "${field}"`);
    },
  );

  it('rejects banned field nested in object', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      tags: ['groceries'],
      metadata: { email: 'hidden@example.com' },
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_SCHEMA');
    expect(result.policyReasonDetail).toContain('Unrecognized key: "metadata"');
  });

  it('rejects banned field nested in array', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      tags: ['ok', '555-55-5555'],
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('rejects payload containing SSN-like pattern', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      tags: ['ssn 123-45-6789'],
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('rejects payload containing email-like pattern in value', () => {
    const result = sanitizer.sanitizePayload(eventType, {
      ...basePayload,
      tags: ['contact user@private.com for info'],
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('passes safe payload with no banned fields or PII patterns', () => {
    const result = sanitizer.sanitizePayload(eventType, basePayload);
    expect(result.policyPassed).toBe(true);
    expect(result.policyReason).toBe('POLICY_PASS');
    expect(result.sanitizedPayload).toMatchObject({ amountCents: 2500 });
  });
});
