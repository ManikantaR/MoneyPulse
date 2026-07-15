import { describe, expect, it } from 'vitest';
import {
  getSyncPayloadSchema,
  syncPayloadSchemas,
} from '@moneypulse/shared';
import accountFixture from './fixtures/account.projected.v1.golden.json';
import budgetFixture from './fixtures/budget.projected.v1.golden.json';
import categoryFixture from './fixtures/category.projected.v1.golden.json';
import notificationFixture from './fixtures/notification.projected.v1.golden.json';
import transactionFixture from './fixtures/transaction.projected.v1.golden.json';

const RAW_UUID = '550e8400-e29b-41d4-a716-446655440000';

const fixtureCases = [
  {
    eventType: 'transaction.projected.v1',
    fixture: transactionFixture,
    aliasIdField: 'transactionAliasId',
  },
  {
    eventType: 'category.projected.v1',
    fixture: categoryFixture,
    aliasIdField: 'categoryId',
  },
  {
    eventType: 'account.projected.v1',
    fixture: accountFixture,
    aliasIdField: 'accountAliasId',
  },
  {
    eventType: 'budget.projected.v1',
    fixture: budgetFixture,
    aliasIdField: 'categoryId',
  },
  {
    eventType: 'notification.projected.v1',
    fixture: notificationFixture,
    aliasIdField: 'notificationAliasId',
  },
] as const;

describe('sync payload contracts', () => {
  it('captures every live sync event type in the shared registry', () => {
    expect(Object.keys(syncPayloadSchemas)).toEqual([
      'transaction.projected.v1',
      'category.projected.v1',
      'account.projected.v1',
      'budget.projected.v1',
      'notification.projected.v1',
    ]);
  });

  it.each(fixtureCases)(
    'accepts the golden fixture for %s',
    ({ eventType, fixture }) => {
      const schema = getSyncPayloadSchema(eventType);
      expect(schema).toBeDefined();
      expect(schema?.parse(fixture)).toEqual(fixture);
    },
  );

  it.each(fixtureCases)(
    'rejects undeclared fields for %s',
    ({ eventType, fixture }) => {
      const schema = getSyncPayloadSchema(eventType)!;
      const result = schema.safeParse({ ...fixture, unexpectedField: 'nope' });
      expect(result.success).toBe(false);
    },
  );

  it.each(fixtureCases)(
    'rejects raw UUIDs in alias-bound id fields for %s',
    ({ eventType, fixture, aliasIdField }) => {
      const schema = getSyncPayloadSchema(eventType)!;
      const result = schema.safeParse({ ...fixture, [aliasIdField]: RAW_UUID });
      expect(result.success).toBe(false);
    },
  );

  it('accepts the minimal transaction payload emitted during ingestion', () => {
    const schema = getSyncPayloadSchema('transaction.projected.v1')!;
    const minimalPayload = {
      transactionAliasId: 'a1_dddddddddddddddddddddddddddddddddddddddd',
      accountAliasId: 'a1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      amountCents: -2599,
      date: '2026-07-12T00:00:00.000Z',
      categoryId: null,
      isCredit: false,
      isTransfer: false,
      isManual: false,
      tags: [],
    };

    expect(schema.parse(minimalPayload)).toEqual(minimalPayload);
  });
});
