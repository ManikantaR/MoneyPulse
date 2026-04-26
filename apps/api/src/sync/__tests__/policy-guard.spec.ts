import { describe, it, expect } from 'vitest';
import { SanitizerV2Service } from '../sanitizer-v2.service';

describe('SanitizerV2Service — policy guard: banned fields', () => {
  const sanitizer = new SanitizerV2Service();

  const bannedCases: Array<[string, Record<string, unknown>]> = [
    ['email', { email: 'user@example.com', amountCents: 100 }],
    ['accountNumber', { accountNumber: '12345678', amountCents: 100 }],
    ['routingNumber', { routingNumber: '021000021', amountCents: 100 }],
    ['lastFour', { lastFour: '4242', amountCents: 100 }],
    ['originalDescriptionRaw', { originalDescriptionRaw: 'raw text', amountCents: 100 }],
    ['promptText', { promptText: 'what is...', amountCents: 100 }],
    ['outputText', { outputText: 'categorized as food', amountCents: 100 }],
  ];

  it.each(bannedCases)(
    'rejects payload containing banned field: %s',
    (field, payload) => {
      const result = sanitizer.sanitizePayload(payload);
      expect(result.policyPassed).toBe(false);
      expect(result.policyReason).toBe('POLICY_FAIL_BANNED_FIELD');
      expect(result.bannedField).toBe(field);
    },
  );

  it('rejects banned field nested in object', () => {
    const result = sanitizer.sanitizePayload({
      body: { email: 'hidden@example.com' },
      amountCents: 500,
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_BANNED_FIELD');
    expect(result.bannedField).toBe('email');
  });

  it('rejects banned field nested in array', () => {
    const result = sanitizer.sanitizePayload({
      items: [{ accountNumber: '9999' }],
      amountCents: 500,
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_BANNED_FIELD');
    expect(result.bannedField).toBe('accountNumber');
  });

  it('rejects payload containing SSN-like pattern', () => {
    const result = sanitizer.sanitizePayload({
      note: 'ssn 123-45-6789',
      amountCents: 100,
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('rejects payload containing email-like pattern in value', () => {
    const result = sanitizer.sanitizePayload({
      note: 'contact user@private.com for info',
    });
    expect(result.policyPassed).toBe(false);
    expect(result.policyReason).toBe('POLICY_FAIL_PATTERN_MATCH');
  });

  it('passes safe payload with no banned fields or PII patterns', () => {
    const result = sanitizer.sanitizePayload({
      transactionAliasId: 'a1_abc123',
      accountAliasId: 'a1_def456',
      amountCents: 2500,
      isCredit: false,
      tags: ['groceries'],
      categoryId: 'some-uuid',
    });
    expect(result.policyPassed).toBe(true);
    expect(result.policyReason).toBe('POLICY_PASS');
    expect(result.sanitizedPayload).toMatchObject({ amountCents: 2500 });
  });
});
