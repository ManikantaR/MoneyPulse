/**
 * Import Pipeline Radar Phase 2: reprocess + fix-and-rerun (reassign) let a
 * user re-run a failed/stalled/empty import, or correct the account/mapping
 * for an orphaned or misassigned import, without deleting and re-dropping
 * the file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as schema from '../../db/schema';

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

import { access } from 'fs/promises';
import { IngestionService } from '../ingestion.service';

describe('IngestionService.reprocessUpload / reassignUpload', () => {
  let service: IngestionService;
  let mockDb: any;
  let addSpy: ReturnType<typeof vi.fn>;
  let updateSetSpy: ReturnType<typeof vi.fn>;
  let deleteSpy: ReturnType<typeof vi.fn>;
  let uploadRow: any;
  let accountsFound: any[];

  function makeDb() {
    updateSetSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    deleteSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    const db: any = {
      _table: null as any,
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
      limit: vi.fn(function (this: any) {
        if (this._table === schema.fileUploads) return Promise.resolve([uploadRow]);
        if (this._table === schema.accounts) return Promise.resolve(accountsFound);
        return Promise.resolve([]);
      }),
      update: vi.fn(function (this: any, table: any) {
        this._table = table;
        return this;
      }),
      set: updateSetSpy,
      delete: deleteSpy,
    };
    return db;
  }

  const config = { get: vi.fn(() => undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    uploadRow = {
      id: 'upload-1',
      userId: 'user-1',
      accountId: 'acct-1',
      filename: 'statement.csv',
      fileType: 'csv',
      fileHash: 'abc123',
      status: 'failed',
      archivedPath: '/config/watch-folder/checking-1234/.archived/statement.csv_ts',
      watcherSlug: null,
      originalFilename: null,
    };
    accountsFound = [{ id: 'acct-2', userId: 'user-1', deletedAt: null }];
    mockDb = makeDb();
    addSpy = vi.fn().mockResolvedValue(undefined);
    service = new IngestionService(
      mockDb,
      { add: addSpy } as any,
      config as any,
    );
  });

  describe('reprocessUpload', () => {
    it('re-enqueues and resets status/counts/errorLog for a failed row with an archivedPath', async () => {
      (access as any).mockResolvedValue(undefined);

      await service.reprocessUpload('upload-1', 'user-1');

      expect(updateSetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          errorLog: [],
          rowsImported: 0,
          rowsSkipped: 0,
          rowsErrored: 0,
        }),
      );
      expect(addSpy).toHaveBeenCalledWith(
        'parse-file',
        expect.objectContaining({
          uploadId: 'upload-1',
          accountId: 'acct-1',
          filePath: uploadRow.archivedPath,
        }),
        expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }),
      );
    });

    it('rejects a completed row', async () => {
      uploadRow.status = 'completed';
      await expect(service.reprocessUpload('upload-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('returns a clear error when the file is missing on disk', async () => {
      (access as any).mockRejectedValue(new Error('ENOENT'));
      uploadRow.archivedPath = null;

      await expect(service.reprocessUpload('upload-1', 'user-1')).rejects.toThrow(
        /no longer available/i,
      );
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('does not double-enqueue on a second invocation while already pending', async () => {
      (access as any).mockResolvedValue(undefined);
      await service.reprocessUpload('upload-1', 'user-1');
      expect(addSpy).toHaveBeenCalledTimes(1);

      // Simulate the row now reflecting the reset status from the first call.
      uploadRow.status = 'pending';
      await expect(service.reprocessUpload('upload-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(addSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('reassignUpload', () => {
    it('sets accountId, clears orphaned status, deletes prior transactions, and re-enqueues under the new account', async () => {
      uploadRow.status = 'orphaned';
      uploadRow.userId = null;
      uploadRow.accountId = null;
      uploadRow.watcherSlug = 'checking-1234';
      uploadRow.originalFilename = 'statement.csv';
      uploadRow.archivedPath = null;
      (access as any).mockImplementation((p: string) =>
        p === '/config/watch-folder/checking-1234/statement.csv'
          ? Promise.resolve(undefined)
          : Promise.reject(new Error('ENOENT')),
      );

      await service.reassignUpload('upload-1', 'user-1', { accountId: 'acct-2' });

      expect(deleteSpy).toHaveBeenCalled();
      expect(updateSetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acct-2', userId: 'user-1' }),
      );
      expect(addSpy).toHaveBeenCalledWith(
        'parse-file',
        expect.objectContaining({ accountId: 'acct-2' }),
        expect.anything(),
      );
    });

    it('rejects an accountId not owned by the user', async () => {
      accountsFound = [];
      await expect(
        service.reassignUpload('upload-1', 'user-1', { accountId: 'not-mine' }),
      ).rejects.toThrow(NotFoundException);
      expect(addSpy).not.toHaveBeenCalled();
    });
  });
});
