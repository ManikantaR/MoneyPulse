import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncDeliveryProcessor } from '../sync-delivery.processor';
import type { Job } from 'bullmq';

function makeJob(name: string): Job {
  return { name, id: 'job-1', data: {} } as unknown as Job;
}

describe('SyncDeliveryProcessor', () => {
  let processor: SyncDeliveryProcessor;
  let syncDeliveryMock: { deliverPending: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    syncDeliveryMock = { deliverPending: vi.fn() };
    processor = new SyncDeliveryProcessor(syncDeliveryMock as any);
  });

  it('calls deliverPending and logs result for deliver-pending-sync job', async () => {
    syncDeliveryMock.deliverPending.mockResolvedValue(5);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process(makeJob('deliver-pending-sync'));

    expect(syncDeliveryMock.deliverPending).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('5'),
    );
  });

  it('skips deliverPending for unknown job names and logs a warning', async () => {
    const warnSpy = vi.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);

    await processor.process(makeJob('unknown-job'));

    expect(syncDeliveryMock.deliverPending).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown-job'));
  });

  it('does not throw when deliverPending returns 0', async () => {
    syncDeliveryMock.deliverPending.mockResolvedValue(0);
    vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await expect(
      processor.process(makeJob('deliver-pending-sync')),
    ).resolves.toBeUndefined();
  });
});
