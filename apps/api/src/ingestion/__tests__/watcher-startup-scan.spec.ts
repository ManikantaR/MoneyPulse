/**
 * Phase 0 / BS-2: files already sitting in the watch folder when the API
 * (re)starts are never picked up by chokidar because the watcher is created
 * with `ignoreInitial: true` and there is no startup scan. These tests cover
 * the explicit reconciliation scan added to WatcherService that walks each
 * `<watchDir>/<slug>/` folder on boot and routes discovered files through the
 * same `handleNewFile()` path chokidar's live `add` event uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Dirent } from 'fs';
import * as schema from '../../db/schema';

vi.mock('../../common/crypto', () => ({
  decryptField: vi.fn((v: string) => v.replace(/^enc:/, '')),
  encryptField: vi.fn((v: string) => `enc:${v}`),
}));

const readdirMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('fs/promises', () => ({
  readdir: (...args: any[]) => readdirMock(...args),
  readFile: (...args: any[]) => readFileMock(...args),
}));

import { WatcherService } from '../watcher.service';

function dirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as Dirent;
}

describe('WatcherService startup reconciliation scan', () => {
  let service: WatcherService;
  let mockDb: any;
  let enqueueSpy: ReturnType<typeof vi.fn>;
  const watchDir = '/config/watch-folder';

  beforeEach(() => {
    readdirMock.mockReset();
    readFileMock.mockReset();

    // Watch dir layout:
    //   checking-1234/statement-may.csv   -> new, should enqueue
    //   checking-1234/statement-jun.csv   -> already known (dedup match), should skip
    //   checking-1234/.hidden.csv         -> dotfile, must be ignored
    //   checking-1234/notes.txt           -> non-data file, ignored by extension filter
    //   .archived/old.csv                 -> must never be scanned
    readdirMock.mockImplementation((dir: string) => {
      if (dir === watchDir) {
        return Promise.resolve([
          dirent('checking-1234', true),
          dirent('.archived', true),
        ]);
      }
      if (dir === `${watchDir}/checking-1234`) {
        return Promise.resolve([
          dirent('statement-may.csv', false),
          dirent('statement-jun.csv', false),
          dirent('.hidden.csv', false),
          dirent('notes.txt', false),
        ]);
      }
      throw new Error(`Unexpected readdir call: ${dir}`);
    });

    readFileMock.mockImplementation((filePath: string) => {
      // Distinct content per file so SHA-256 hashes differ deterministically.
      return Promise.resolve(Buffer.from(filePath));
    });

    enqueueSpy = vi.fn().mockResolvedValue(undefined);

    const account = {
      id: 'acct-1',
      userId: 'user-1',
      nickname: 'Checking',
      lastFour: 'enc:1234',
      deletedAt: null,
    };

    mockDb = {
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
        // Only the "already known" file's hash resolves to an existing row.
        if (this._table === schema.fileUploads) {
          const lastPath: string = readFileMock.mock.calls.at(-1)?.[0] ?? '';
          if (lastPath.includes('statement-jun.csv')) {
            return Promise.resolve([{ id: 'existing-upload', status: 'completed' }]);
          }
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
      insert: vi.fn(function (this: any) {
        return this;
      }),
      values: vi.fn(function (this: any) {
        return this;
      }),
      returning: vi.fn().mockResolvedValue([{ id: 'new-upload-1' }]),
      then: (resolve: (v: any) => any) => {
        // `findAccountBySlug` awaits the select chain directly (no .limit()).
        if (mockDb._table === schema.accounts) {
          return resolve([account]);
        }
        return resolve([]);
      },
    };

    const configMock = {
      get: vi.fn((key: string) => {
        if (key === 'WATCH_FOLDER_DIR') return watchDir;
        return undefined;
      }),
    };

    service = new WatcherService(configMock as any, mockDb, { add: enqueueSpy } as any);
  });

  it('enqueues new files, skips already-known files, and ignores .archived/dotfiles', async () => {
    await (service as any).scanExistingFiles();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const [, jobData] = enqueueSpy.mock.calls[0];
    expect(jobData.filePath).toContain('statement-may.csv');

    // The .archived directory must never be traversed.
    const scannedDirs = readdirMock.mock.calls.map((c) => c[0]);
    expect(scannedDirs).not.toContain(`${watchDir}/.archived`);

    // Dotfile and non-data-extension files must not trigger a read/hash attempt.
    const readFiles = readFileMock.mock.calls.map((c) => c[0]);
    expect(readFiles.some((p: string) => p.includes('.hidden.csv'))).toBe(false);
    expect(readFiles.some((p: string) => p.includes('notes.txt'))).toBe(false);
  });

  it('is idempotent — re-running the scan does not enqueue the already-known file again', async () => {
    await (service as any).scanExistingFiles();
    enqueueSpy.mockClear();

    // Simulate the previously-new file now being "known" too (as it would be
    // after the first scan's insert), so a second boot only sees dedup hits.
    readFileMock.mockImplementation((filePath: string) => Promise.resolve(Buffer.from(filePath)));
    mockDb.limit = vi.fn(function (this: any) {
      if (this._table === schema.fileUploads) {
        return Promise.resolve([{ id: 'existing-upload', status: 'completed' }]);
      }
      return Promise.resolve([]);
    });

    await (service as any).scanExistingFiles();

    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
