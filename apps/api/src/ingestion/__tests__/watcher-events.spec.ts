/**
 * Import Pipeline Radar Phase 1: POST /ingestion/watcher-events is the future
 * hand-off point for the laptop watcher to report pipeline-stage events
 * (detected/renamed/staged/failed). These tests cover:
 *   - a 'staged' event populating provenance columns on a matching row
 *   - a 'failed' event with no matching row creating a lightweight 'failed' row (BS-5)
 *   - the endpoint being guarded by JwtAuthGuard (same guard as other ingestion routes)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as schema from '../../db/schema';
import { IngestionService } from '../ingestion.service';
import { IngestionEventsController } from '../ingestion.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

vi.mock('../../common/crypto', () => ({
  encryptField: vi.fn((v: string) => `enc:${v}`),
  decryptField: vi.fn((v: string) => v),
}));

describe('POST /ingestion/watcher-events', () => {
  it('is guarded by JwtAuthGuard, same as other ingestion routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, IngestionEventsController);
    expect(guards).toContain(JwtAuthGuard);
  });

  describe('IngestionService.recordWatcherEvent', () => {
    let service: IngestionService;
    let mockDb: any;
    let updateSet: ReturnType<typeof vi.fn>;
    let insertValues: ReturnType<typeof vi.fn>;

    function makeDb(existingRow: any[] = []) {
      updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      insertValues = vi.fn().mockResolvedValue(undefined);

      const db: any = {
        _table: null,
        select: vi.fn(function (this: any) {
          return this;
        }),
        from: vi.fn(function (this: any, table: any) {
          this._table = table;
          return this;
        }),
        where: vi.fn(function (this: any) {
          return this;
        }),
        limit: vi.fn(() => Promise.resolve(existingRow)),
        update: vi.fn(function (this: any) {
          return { set: updateSet };
        }),
        insert: vi.fn(function (this: any) {
          return { values: insertValues };
        }),
      };
      return db;
    }

    beforeEach(() => {
      service = Object.create(IngestionService.prototype);
    });

    it('populates provenance columns on a matching row for a "staged" event', async () => {
      mockDb = makeDb([{ id: 'upload-1' }]);
      (service as any).db = mockDb;

      const result = await service.recordWatcherEvent({
        stage: 'staged',
        slug: 'citi-checking-1234',
        originalFilename: 'raw-export.csv',
        renamedFilename: 'citi-checking-1234-2026-09-05.csv',
        bank: 'citi',
        stagedAt: '2026-09-05T00:00:00.000Z',
      });

      expect(result).toBe('matched');
      expect(updateSet).toHaveBeenCalledTimes(1);
      const patch = updateSet.mock.calls[0][0];
      expect(patch.watcherSlug).toBe('citi-checking-1234');
      expect(patch.watcherBank).toBe('citi');
      expect(patch.stagedAt).toBeInstanceOf(Date);
      expect(patch.originalFilename).toBe('citi-checking-1234-2026-09-05.csv');
      expect(insertValues).not.toHaveBeenCalled();
    });

    it('creates a lightweight "failed" row when a failed event matches no existing upload (BS-5)', async () => {
      mockDb = makeDb([]);
      (service as any).db = mockDb;

      const result = await service.recordWatcherEvent({
        stage: 'failed',
        slug: 'amex-platinum-9999',
        originalFilename: 'raw-export.csv',
        error: 'copy to NAS failed: permission denied',
      });

      expect(result).toBe('created');
      expect(insertValues).toHaveBeenCalledTimes(1);
      const inserted = insertValues.mock.calls[0][0];
      expect(inserted.status).toBe('failed');
      expect(inserted.watcherSlug).toBe('amex-platinum-9999');
      expect(inserted.errorLog[0].error).toMatch(/permission denied/);
      expect(updateSet).not.toHaveBeenCalled();
    });

    it('returns "unmatched" and creates nothing for a non-failed event with no matching row', async () => {
      mockDb = makeDb([]);
      (service as any).db = mockDb;

      const result = await service.recordWatcherEvent({
        stage: 'detected',
        slug: 'unknown-slug',
        originalFilename: 'raw-export.csv',
      });

      expect(result).toBe('unmatched');
      expect(insertValues).not.toHaveBeenCalled();
      expect(updateSet).not.toHaveBeenCalled();
    });
  });
});
