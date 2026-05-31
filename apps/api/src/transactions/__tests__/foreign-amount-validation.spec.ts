import { describe, it, expect } from 'vitest';
import { createTransactionSchema, updateTransactionSchema } from '@moneypulse/shared';

const validBase = {
  accountId: '550e8400-e29b-41d4-a716-446655440000',
  date: '2026-05-01',
  description: 'Family support',
  amountCents: 60000,
  isCredit: false,
};

describe('createTransactionSchema — foreign amount validation', () => {
  it('accepts a transaction without foreign amount fields', () => {
    const result = createTransactionSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('accepts a valid INR foreign amount pair', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 5000000,
      currencyCode: 'INR',
    });
    expect(result.success).toBe(true);
  });

  it('rejects currencyCode with fewer than 3 characters', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 5000000,
      currencyCode: 'IN',
    });
    expect(result.success).toBe(false);
  });

  it('rejects currencyCode with more than 3 characters', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 5000000,
      currencyCode: 'INRR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lowercase currencyCode', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 5000000,
      currencyCode: 'inr',
    });
    expect(result.success).toBe(false);
  });

  it('rejects originalAmountCents without currencyCode', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 5000000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects currencyCode without originalAmountCents', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      currencyCode: 'INR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero originalAmountCents', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: 0,
      currencyCode: 'INR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative originalAmountCents', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: -100,
      currencyCode: 'INR',
    });
    expect(result.success).toBe(false);
  });

  it('accepts clearing both fields to null', () => {
    const result = createTransactionSchema.safeParse({
      ...validBase,
      originalAmountCents: null,
      currencyCode: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('updateTransactionSchema — foreign amount validation', () => {
  it('accepts update with both foreign fields set', () => {
    const result = updateTransactionSchema.safeParse({
      originalAmountCents: 5000000,
      currencyCode: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('accepts update with both foreign fields cleared', () => {
    const result = updateTransactionSchema.safeParse({
      originalAmountCents: null,
      currencyCode: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects update with originalAmountCents but no currencyCode', () => {
    const result = updateTransactionSchema.safeParse({
      originalAmountCents: 5000000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects update with currencyCode but no originalAmountCents', () => {
    const result = updateTransactionSchema.safeParse({
      currencyCode: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid currency code in update', () => {
    const result = updateTransactionSchema.safeParse({
      originalAmountCents: 5000000,
      currencyCode: 'eu',
    });
    expect(result.success).toBe(false);
  });
});
