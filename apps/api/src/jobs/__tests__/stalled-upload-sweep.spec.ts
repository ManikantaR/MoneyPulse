/**
 * Phase 0 / BS-6: a `file_uploads` row can get stuck in 'processing' (or
 * 'pending' after enqueue) forever if the worker crashes or a BullMQ job is
 * lost, with no error and no visibility. These tests cover the periodic
 * stalled-upload sweep that flips old rows to 'failed' with an explanatory
 * errorLog, reusing the existing upload status enum (no new status added).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionProcessor, STALLED_UPLOAD_THRESHOLD_MS } from '../ingestion.processor';

vi.mock('../../common/crypto', () => ({
  encryptField: vi.fn((v: string) => `enc:${v}`),
  decryptField: vi.fn((v: string) => v),
}));

describe('IngestionProcessor stalled-upload sweep', () => {
  let mockDb: any;
  let updateUploadStatus: ReturnType<typeof vi.fn>;
  let processor: IngestionProcessor;

  beforeEach(() => {
    updateUploadStatus = vi.fn().mockResolvedValue(undefined);

    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
    };

    // Build a bare instance and inject only the two dependencies the sweep
    // uses, rather than threading 18 constructor args unrelated to this test
    // (matches the minimal-instantiation style used elsewhere for narrowly
    // scoped processor methods).
    processor = Object.create(IngestionProcessor.prototype);
    (processor as any).db = mockDb;
    (processor as any).ingestionService = { updateUploadStatus };
    (processor as any).logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  });

  it('flips a stalled "processing" row older than the threshold to "failed" with an errorLog', async () => {
    mockDb.where.mockResolvedValue([{ id: 'upload-stale', status: 'processing' }]);

    await (processor as any).processStalledUploadSweep();

    expect(updateUploadStatus).toHaveBeenCalledTimes(1);
    const [uploadId, data] = updateUploadStatus.mock.calls[0];
    expect(uploadId).toBe('upload-stale');
    expect(data.status).toBe('failed');
    expect(Array.isArray(data.errorLog)).toBe(true);
    expect(data.errorLog[0].error).toMatch(/stalled/i);
  });

  it('leaves a recent "processing" row alone (query excludes it via the updatedAt cutoff)', async () => {
    // The cutoff filtering happens in the DB query itself; simulate the DB
    // correctly excluding a fresh row by returning no results.
    mockDb.where.mockResolvedValue([]);

    await (processor as any).processStalledUploadSweep();

    expect(updateUploadStatus).not.toHaveBeenCalled();
  });

  it('uses a 15-minute threshold by default', () => {
    expect(STALLED_UPLOAD_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });
});
