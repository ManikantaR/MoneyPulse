/**
 * Import Pipeline Radar Phase 1: POST /ingestion/watcher-events is the future
 * hand-off point for the laptop watcher to report pipeline-stage events
 * (detected/renamed/staged/failed). These tests cover:
 *   - a 'staged' event populating provenance columns on a matching row
 *   - a 'failed' event with no matching row creating a lightweight 'failed' row (BS-5)
 *   - the endpoint being guarded by IngestKeyOrJwtGuard (Phase 5a), other
 *     ingestion routes staying on JwtAuthGuard
 *
 * Phase 5a adds shared-API-key auth (for the headless laptop watcher, which
 * has no user login/JWT) alongside the existing JWT path:
 *   - IngestKeyOrJwtGuard: correct X-Ingest-Key with no JWT passes
 *   - IngestKeyOrJwtGuard: wrong/absent key with no JWT falls through to JWT
 *     and is rejected
 *   - IngestKeyOrJwtGuard: with INGEST_API_KEY unset, key path is disabled
 *     and JWT still works
 *   - the controller resolves the owning account from `slug` (reusing
 *     WatcherService.findAccountBySlug) when there is no req.user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UnauthorizedException } from '@nestjs/common';
import { IngestionService } from '../ingestion.service';
import { IngestionEventsController } from '../ingestion.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IngestKeyOrJwtGuard } from '../../common/guards/ingest-key-or-jwt.guard';
import * as cryptoUtil from '../../common/crypto';

vi.mock('../../common/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof cryptoUtil>();
  return {
    ...actual,
    encryptField: vi.fn((v: string) => `enc:${v}`),
    decryptField: vi.fn((v: string) => v),
    constantTimeEqual: vi.fn(actual.constantTimeEqual),
  };
});

// Unit tests exercise IngestKeyOrJwtGuard in isolation, without a real
// passport 'jwt' strategy registered — stub JwtAuthGuard's canActivate so
// "falls through to JWT" cases deterministically reject the way an
// unauthenticated request actually would (no Authorization header → 401),
// without depending on passport/module bootstrap.
const jwtCanActivate = vi.fn();
vi.mock('../../common/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: vi.fn(function (this: any) {
    this.canActivate = jwtCanActivate;
  }),
}));

function makeContext(headers: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as any;
}

describe('POST /ingestion/watcher-events', () => {
  it('is guarded by IngestKeyOrJwtGuard (Phase 5a), not the bare JwtAuthGuard', () => {
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      IngestionEventsController.prototype.watcherEvent,
    );
    expect(methodGuards).toContain(IngestKeyOrJwtGuard);
  });

  it('other ingestion routes (coverage) stay on JwtAuthGuard', () => {
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      IngestionEventsController.prototype.coverage,
    );
    expect(methodGuards).toContain(JwtAuthGuard);
  });

  describe('IngestKeyOrJwtGuard', () => {
    beforeEach(() => {
      jwtCanActivate.mockReset();
      jwtCanActivate.mockRejectedValue(new UnauthorizedException());
      vi.mocked(cryptoUtil.constantTimeEqual).mockClear();
    });

    function makeConfigService(value: string | undefined) {
      return { get: vi.fn(() => value) } as any;
    }

    it('accepts a request with a correct X-Ingest-Key and no JWT', async () => {
      const guard = new IngestKeyOrJwtGuard(makeConfigService('s3cret-key'));
      const context = makeContext({ 'x-ingest-key': 's3cret-key' });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(cryptoUtil.constantTimeEqual).toHaveBeenCalledWith('s3cret-key', 's3cret-key');
      expect(jwtCanActivate).not.toHaveBeenCalled();
    });

    it('rejects a wrong key when no JWT is present (falls through to JWT and fails)', async () => {
      const guard = new IngestKeyOrJwtGuard(makeConfigService('s3cret-key'));
      const context = makeContext({ 'x-ingest-key': 'wrong-key' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(jwtCanActivate).toHaveBeenCalledWith(context);
    });

    it('rejects an absent key when no JWT is present', async () => {
      const guard = new IngestKeyOrJwtGuard(makeConfigService('s3cret-key'));
      const context = makeContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(jwtCanActivate).toHaveBeenCalledWith(context);
    });

    it('disables the key path entirely when INGEST_API_KEY is unset (JWT-only)', async () => {
      const guard = new IngestKeyOrJwtGuard(makeConfigService(undefined));
      // Even a header matching what would otherwise be a plausible key must not pass.
      const context = makeContext({ 'x-ingest-key': 'anything' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(cryptoUtil.constantTimeEqual).not.toHaveBeenCalled();
      expect(jwtCanActivate).toHaveBeenCalledWith(context);
    });

    it('with INGEST_API_KEY unset, a valid JWT still passes', async () => {
      jwtCanActivate.mockResolvedValue(true);
      const guard = new IngestKeyOrJwtGuard(makeConfigService(undefined));
      const context = makeContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('uses the constant-time compare helper rather than ===', async () => {
      const guard = new IngestKeyOrJwtGuard(makeConfigService('s3cret-key'));
      const context = makeContext({ 'x-ingest-key': 's3cret-key' });

      await guard.canActivate(context);

      expect(cryptoUtil.constantTimeEqual).toHaveBeenCalledTimes(1);
    });
  });

  describe('IngestionEventsController.watcherEvent — account resolution for API-key auth', () => {
    let controller: IngestionEventsController;
    let recordWatcherEvent: ReturnType<typeof vi.fn>;
    let findAccountBySlug: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      recordWatcherEvent = vi.fn().mockResolvedValue('matched');
      findAccountBySlug = vi.fn();
      controller = Object.create(IngestionEventsController.prototype);
      (controller as any).logger = { warn: vi.fn() };
      (controller as any).ingestionService = { recordWatcherEvent };
      (controller as any).watcherService = { findAccountBySlug };
    });

    it('resolves the owning account from slug when there is no req.user (API-key auth)', async () => {
      findAccountBySlug.mockResolvedValue({ id: 'acct-1', userId: 'user-1' });
      const body = {
        stage: 'staged' as const,
        slug: 'citi-checking-1234',
        originalFilename: 'raw-export.csv',
      };

      const result = await controller.watcherEvent(body, undefined);

      expect(findAccountBySlug).toHaveBeenCalledWith('citi-checking-1234');
      expect(recordWatcherEvent).toHaveBeenCalledWith({
        ...body,
        resolvedAccount: { id: 'acct-1', userId: 'user-1' },
      });
      expect(result).toEqual({ data: { result: 'matched' } });
    });

    it('does not create a row when the slug resolves to no account (API-key auth)', async () => {
      findAccountBySlug.mockResolvedValue(null);
      const body = {
        stage: 'failed' as const,
        slug: 'unknown-slug',
        originalFilename: 'raw-export.csv',
        error: 'boom',
      };

      const result = await controller.watcherEvent(body, undefined);

      expect(recordWatcherEvent).not.toHaveBeenCalled();
      expect(result).toEqual({ data: { result: 'unmatched' } });
    });

    it('skips slug resolution and keeps current behavior when authed via JWT', async () => {
      const body = {
        stage: 'staged' as const,
        slug: 'citi-checking-1234',
        originalFilename: 'raw-export.csv',
      };
      const user = { sub: 'user-1' } as any;

      await controller.watcherEvent(body, user);

      expect(findAccountBySlug).not.toHaveBeenCalled();
      expect(recordWatcherEvent).toHaveBeenCalledWith({
        ...body,
        resolvedAccount: undefined,
      });
    });
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

    it('attaches the resolved account (userId/accountId) onto a created failed row (API-key auth)', async () => {
      mockDb = makeDb([]);
      (service as any).db = mockDb;

      await service.recordWatcherEvent({
        stage: 'failed',
        slug: 'amex-platinum-9999',
        originalFilename: 'raw-export.csv',
        error: 'boom',
        resolvedAccount: { id: 'acct-1', userId: 'user-1' },
      });

      const inserted = insertValues.mock.calls[0][0];
      expect(inserted.accountId).toBe('acct-1');
      expect(inserted.userId).toBe('user-1');
    });

    it('attaches the resolved account onto a matched row (API-key auth)', async () => {
      mockDb = makeDb([{ id: 'upload-1' }]);
      (service as any).db = mockDb;

      await service.recordWatcherEvent({
        stage: 'staged',
        slug: 'citi-checking-1234',
        originalFilename: 'raw-export.csv',
        resolvedAccount: { id: 'acct-1', userId: 'user-1' },
      });

      const patch = updateSet.mock.calls[0][0];
      expect(patch.accountId).toBe('acct-1');
      expect(patch.userId).toBe('user-1');
    });
  });
});
