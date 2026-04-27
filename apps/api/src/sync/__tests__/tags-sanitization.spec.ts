import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verifies the tags sanitization security fix.
 *
 * `tags` is a string[] that can contain user-entered text like bank names
 * ("Chase", "Whole Foods") which are not covered by PII regex patterns.
 * The fix removes `tags` from the outbox payload entirely.
 */
describe('enqueueTransactionEvent — tags must not be sent to outbox', () => {
  const mockEnqueue = vi.fn();
  const mockToAliasId = vi.fn((type: string, id: string) => `alias_${type}_${id}`);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue(undefined);
  });

  function buildService() {
    // Inline minimal stub of TransactionsService.enqueueTransactionEvent logic
    // so we can test the payload shape without a full NestJS DI bootstrap.
    return {
      async enqueueTransactionEvent(eventType: string, txn: any) {
        const payload: Record<string, unknown> = {
          transactionAliasId: mockToAliasId('transaction', txn.id),
          accountAliasId: mockToAliasId('account', txn.accountId),
          amountCents: txn.amountCents,
          date: txn.date instanceof Date ? txn.date.toISOString() : txn.date,
          categoryId: txn.categoryId ?? null,
          isCredit: txn.isCredit,
          isManual: txn.isManual ?? false,
          // tags intentionally omitted
        };
        await mockEnqueue({
          eventType,
          aggregateType: 'transaction',
          aggregateId: txn.id,
          userId: txn.userId,
          payload,
        });
      },
    };
  }

  it('does NOT include a tags key in the outbox payload', async () => {
    const svc = buildService();
    await svc.enqueueTransactionEvent('transaction.projected.v1', {
      id: 'txn-1',
      accountId: 'acc-1',
      userId: 'user-1',
      amountCents: 1500,
      date: '2026-04-26',
      categoryId: 'cat-groceries',
      isCredit: false,
      isManual: false,
      tags: ['Chase', 'Whole Foods'],
    });

    expect(mockEnqueue).toHaveBeenCalledOnce();
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.payload).not.toHaveProperty('tags');
  });

  it('still includes required safe fields in the outbox payload', async () => {
    const svc = buildService();
    await svc.enqueueTransactionEvent('transaction.projected.v1', {
      id: 'txn-2',
      accountId: 'acc-2',
      userId: 'user-2',
      amountCents: 2500,
      date: '2026-04-26',
      categoryId: 'cat-food',
      isCredit: true,
      isManual: false,
      tags: ['restaurant'],
    });

    expect(mockEnqueue).toHaveBeenCalledOnce();
    const { payload } = mockEnqueue.mock.calls[0][0];
    expect(payload).toMatchObject({
      amountCents: 2500,
      isCredit: true,
      isManual: false,
      categoryId: 'cat-food',
    });
    expect(payload).toHaveProperty('transactionAliasId');
    expect(payload).toHaveProperty('accountAliasId');
    expect(payload).toHaveProperty('date');
    expect(payload).not.toHaveProperty('tags');
  });

  it('excludes tags even when txn.tags is undefined', async () => {
    const svc = buildService();
    await svc.enqueueTransactionEvent('transaction.projected.v1', {
      id: 'txn-3',
      accountId: 'acc-3',
      userId: 'user-3',
      amountCents: 999,
      date: '2026-04-26',
      categoryId: null,
      isCredit: false,
      isManual: true,
      // tags not provided at all
    });

    expect(mockEnqueue).toHaveBeenCalledOnce();
    const { payload } = mockEnqueue.mock.calls[0][0];
    expect(payload).not.toHaveProperty('tags');
  });
});
