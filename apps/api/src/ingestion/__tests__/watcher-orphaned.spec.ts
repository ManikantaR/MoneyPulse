/**
 * Import Pipeline Radar Phase 1 / BS-3 & BS-4: a file staged under a
 * watch-folder slug that matches no MoneyPulse account (or is an unsupported
 * file type) was previously silently dropped — no `file_uploads` row, no
 * error, no visibility anywhere. These tests cover recording an `orphaned`
 * row instead, without ever enqueueing a parse job for it, and deduping so a
 * re-scan doesn't pile up duplicate rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as schema from '../../db/schema';

vi.mock('../../common/crypto', () => ({
  decryptField: vi.fn((v: string) => v.replace(/^enc:/, '')),
  encryptField: vi.fn((v: string) => `enc:${v}`),
}));

const readFileMock = vi.fn();
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: (...args: any[]) => readFileMock(...args),
}));

import { WatcherService } from '../watcher.service';

describe('WatcherService orphaned-file handling', () => {
  let service: WatcherService;
  let mockDb: any;
  let enqueueSpy: ReturnType<typeof vi.fn>;
  let insertValues: ReturnType<typeof vi.fn>;
  const watchDir = '/config/watch-folder';

  function makeDb({ noAccounts = true, existingOrphan = false } = {}) {
    insertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'orphan-1' }]),
    });

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
        if (this._table === schema.fileUploads) {
          return Promise.resolve(existingOrphan ? [{ id: 'existing-orphan' }] : []);
        }
        return Promise.resolve([]);
      }),
      insert: vi.fn(function (this: any, table: any) {
        this._table = table;
        return this;
      }),
      values: (...args: any[]) => {
        insertValues(...args);
        return { returning: vi.fn().mockResolvedValue([{ id: 'orphan-1' }]) };
      },
      delete: vi.fn(function (this: any) {
        return this;
      }),
      then: (resolve: (v: any) => any) => {
        if (db._table === schema.accounts) {
          return resolve(noAccounts ? [] : [{
            id: 'acct-1',
            userId: 'user-1',
            nickname: 'Checking',
            lastFour: 'enc:1234',
            deletedAt: null,
          }]);
        }
        return resolve([]);
      },
    };
    return db;
  }

  beforeEach(() => {
    readFileMock.mockReset();
    readFileMock.mockResolvedValue(Buffer.from('irrelevant'));
    enqueueSpy = vi.fn().mockResolvedValue(undefined);
  });

  it('records an orphaned row (no account matches the slug) and does not enqueue a parse job', async () => {
    mockDb = makeDb({ noAccounts: true });
    const configMock = { get: vi.fn((k: string) => (k === 'WATCH_FOLDER_DIR' ? watchDir : undefined)) };
    service = new WatcherService(configMock as any, mockDb, { add: enqueueSpy } as any);

    const result = await (service as any).handleNewFile(
      `${watchDir}/unknown-slug-9999/statement.csv`,
    );

    expect(result).toBe('skipped');
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted.status).toBe('orphaned');
    expect(inserted.watcherSlug).toBe('unknown-slug-9999');
    expect(inserted.originalFilename).toBe('statement.csv');
    expect(inserted.errorLog[0].error).toMatch(/no moneypulse account matches slug/i);
  });

  it('records an orphaned row for an unsupported file type under a slug folder, without reading the file', async () => {
    mockDb = makeDb({ noAccounts: false });
    const configMock = { get: vi.fn((k: string) => (k === 'WATCH_FOLDER_DIR' ? watchDir : undefined)) };
    service = new WatcherService(configMock as any, mockDb, { add: enqueueSpy } as any);

    const result = await (service as any).handleNewFile(
      `${watchDir}/checking-1234/notes.docx`,
    );

    expect(result).toBe('skipped');
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues.mock.calls[0][0].status).toBe('orphaned');
  });

  it('does not create a second orphaned row for the same slug + filename on a re-scan', async () => {
    mockDb = makeDb({ noAccounts: true, existingOrphan: true });
    const configMock = { get: vi.fn((k: string) => (k === 'WATCH_FOLDER_DIR' ? watchDir : undefined)) };
    service = new WatcherService(configMock as any, mockDb, { add: enqueueSpy } as any);

    await (service as any).handleNewFile(`${watchDir}/unknown-slug-9999/statement.csv`);

    expect(insertValues).not.toHaveBeenCalled();
  });
});
