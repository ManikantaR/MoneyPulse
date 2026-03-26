import { sanitizeText, sanitizeForCloudAI } from '../pii-sanitizer';

describe('PII Sanitizer', () => {
  it('should strip SSN', () => {
    expect(sanitizeText('REF 123-45-6789 PAYMENT')).toBe('REF [SSN] PAYMENT');
  });

  it('should strip credit card numbers', () => {
    expect(sanitizeText('CARD 4111 1111 1111 1111')).toBe('CARD [CARD]');
    expect(sanitizeText('CARD 4111-1111-1111-1111')).toBe('CARD [CARD]');
  });

  it('should strip Amex credit card numbers (15-digit, 4-6-5)', () => {
    expect(sanitizeText('AMEX 3782 822463 10005')).toBe('AMEX [CARD]');
    expect(sanitizeText('AMEX 3782-822463-10005')).toBe('AMEX [CARD]');
  });

  it('should strip email addresses', () => {
    expect(sanitizeText('FROM user@example.com')).toBe('FROM [EMAIL]');
  });

  it('should strip phone numbers', () => {
    expect(sanitizeText('CALL (555) 123-4567')).toBe('CALL [PHONE]');
    expect(sanitizeText('CALL 555-123-4567')).toBe('CALL [PHONE]');
  });

  it('should strip routing numbers (9 digits) as [ROUTING]', () => {
    expect(sanitizeText('ROUTING 123456789')).toBe('ROUTING [ROUTING]');
  });

  it('should strip long account numbers', () => {
    expect(sanitizeText('ACCT 123456789012')).toBe('ACCT [ACCT]');
  });

  it('should not strip short numbers (amounts, store numbers)', () => {
    expect(sanitizeText('STARBUCKS STORE 12345 $5.75')).toBe(
      'STARBUCKS STORE 12345 $5.75',
    );
  });

  it('should sanitize transaction for cloud AI', () => {
    const result = sanitizeForCloudAI({
      date: '2026-03-15',
      description: 'PAYMENT FROM 123-45-6789',
      amountCents: 5000,
      isCredit: true,
      merchantName: 'ACCT 1234567890123',
    });
    expect(result.description).toBe('PAYMENT FROM [SSN]');
    expect(result.merchantName).toBe('ACCT [ACCT]');
    expect(result.amountCents).toBe(5000);
  });
});
