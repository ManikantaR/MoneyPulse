import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncDeliveryService } from '../sync-delivery.service';
import { SanitizerV2Service } from '../sanitizer-v2.service';
import { AliasMapperService } from '../alias-mapper.service';
import { SigningService } from '../signing.service';
import { SYNC_MAX_ATTEMPTS } from '../sync.constants';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-001',
    event_type: 'transaction.projected.v1',
    user_id: 'user-abc',
    payload_json: { amountCents: 500, isCredit: false, tags: [] },
    attempts: 0,
    idempotency_key: 'idem-xyz',
    ...overrides,
  };
}

function buildDb(overrides: Partial<ReturnType<typeof buildDb>> = {}) {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  const execute = vi.fn().mockResolvedValue({ rows: [] });

  return { execute, update, insert, set, where, insertValues, ...overrides };
}

function buildSanitizer(pass = true) {
  const sanitizer = new SanitizerV2Service();
  vi.spyOn(sanitizer, 'sanitizePayload').mockReturnValue(
    pass
      ? { policyPassed: true, policyReason: 'POLICY_PASS', sanitizedPayload: { amountCents: 500 } }
      : { policyPassed: false, policyReason: 'POLICY_FAIL_BANNED_FIELD', sanitizedPayload: {}, bannedField: 'email' },
  );
  return sanitizer;
}

function buildAliasMapper(fail = false) {
  const mapper = new AliasMapperService();
  if (fail) {
    vi.spyOn(mapper, 'toAliasId').mockImplementation(() => {
      throw new Error('ALIAS_SECRET must be set for sync alias mapping');
    });
  } else {
    vi.spyOn(mapper, 'toAliasId').mockReturnValue('a1_alias123');
  }
  return mapper;
}

function buildSigning(fail = false) {
  const signing = new SigningService();
  if (fail) {
    vi.spyOn(signing, 'signPayload').mockImplementation(() => {
      throw new Error('SYNC_SIGNING_SECRET must be set for sync payload signing');
    });
  } else {
    vi.spyOn(signing, 'signPayload').mockReturnValue({
      signature: 'sig-abc',
      keyId: 'sync-key-v1',
      timestamp: '2026-04-26T00:00:00.000Z',
      idempotencyKey: 'idem-xyz',
    });
  }
  return signing;
}

function buildService(
  db: ReturnType<typeof buildDb>,
  sanitizer: SanitizerV2Service,
  aliasMapper: AliasMapperService,
  signing: SigningService,
) {
  return new SyncDeliveryService(db as any, sanitizer, aliasMapper, signing);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncDeliveryService', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FIREBASE_SYNC_ENDPOINT = 'https://example.com/sync';
    process.env.ALIAS_SECRET = 'alias-secret-test';
    process.env.SYNC_SIGNING_SECRET = 'signing-secret-test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // deliverPending
  // -------------------------------------------------------------------------

  describe('deliverPending', () => {
    it('returns the count of processed rows', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({
        rows: [makeRow(), makeRow({ id: 'evt-002' })],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      const count = await service.deliverPending(10);

      expect(count).toBe(2);
    });

    it('returns 0 when no rows are due', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [] });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      const count = await service.deliverPending();

      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Policy-fail path
  // -------------------------------------------------------------------------

  describe('policy-fail path', () => {
    it('marks the event as policy_failed and writes an audit row', async () => {
      const db = buildDb();
      const sanitizer = buildSanitizer(false);
      const service = buildService(db, sanitizer, buildAliasMapper(), buildSigning());

      db.execute.mockResolvedValue({ rows: [makeRow()] });
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('policy_failed');
      expect(setArg.policyPassed).toBe(false);

      expect(db.insert).toHaveBeenCalledTimes(1);
      const auditArg = db.insertValues.mock.calls[0][0];
      expect(auditArg.policyPassed).toBe(false);
      expect(auditArg.errorCode).toBe('POLICY');
    });

    it('does not call fetch when policy fails', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const service = buildService(db, buildSanitizer(false), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Signing/alias error path (now wrapped in try/catch)
  // -------------------------------------------------------------------------

  describe('signing/alias error path', () => {
    it('marks the event as retry when alias mapping throws', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(true), buildSigning());
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('retry');
      expect(setArg.lastErrorCode).toBe('SIGNING_ERROR');
    });

    it('marks the event as retry when signing throws', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning(true));
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('retry');
      expect(setArg.lastErrorCode).toBe('SIGNING_ERROR');
    });

    it('does not call fetch when signing/alias fails', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const service = buildService(db, buildSanitizer(), buildAliasMapper(true), buildSigning());
      await service.deliverPending();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Endpoint-missing retry path
  // -------------------------------------------------------------------------

  describe('endpoint-missing path', () => {
    it('marks the event as retry with NO_ENDPOINT code when endpoint is empty', async () => {
      delete process.env.FIREBASE_SYNC_ENDPOINT;

      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('retry');
      expect(setArg.lastErrorCode).toBe('NO_ENDPOINT');
      expect(setArg.attempts).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Non-2xx retry path
  // -------------------------------------------------------------------------

  describe('non-2xx retry path', () => {
    it('marks the event as retry and records the HTTP status code', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('retry');
      expect(setArg.lastErrorCode).toBe('HTTP_503');
      expect(setArg.attempts).toBe(1);

      const auditArg = db.insertValues.mock.calls[0][0];
      expect(auditArg.httpStatus).toBe(503);
      expect(auditArg.policyPassed).toBe(false);
    });

    it('marks the event as retry on a network error', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('retry');
      expect(setArg.lastErrorCode).toBe('NETWORK_ERROR');
      expect(setArg.lastErrorMessage).toBe('Connection refused');
    });
  });

  // -------------------------------------------------------------------------
  // Max-attempt dead-letter path
  // -------------------------------------------------------------------------

  describe('dead-letter path', () => {
    it('marks the event as dead_letter when attempts reach SYNC_MAX_ATTEMPTS', async () => {
      const db = buildDb();
      const row = makeRow({ attempts: SYNC_MAX_ATTEMPTS - 1 });
      db.execute.mockResolvedValue({ rows: [row] });
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('dead_letter');
      expect(setArg.deadLetteredAt).toBeInstanceOf(Date);
      expect(setArg.attempts).toBe(SYNC_MAX_ATTEMPTS);
    });
  });

  // -------------------------------------------------------------------------
  // Successful delivery path
  // -------------------------------------------------------------------------

  describe('successful delivery path', () => {
    it('marks the event as delivered and increments attempts', async () => {
      const db = buildDb();
      const row = makeRow({ attempts: 2 });
      db.execute.mockResolvedValue({ rows: [row] });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = db.set.mock.calls[0][0];
      expect(setArg.status).toBe('delivered');
      expect(setArg.attempts).toBe(3);
      expect(setArg.deliveredAt).toBeInstanceOf(Date);
      expect(setArg.lastErrorCode).toBeNull();
      expect(setArg.lastErrorMessage).toBeNull();
    });

    it('writes an audit log row on successful delivery', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      expect(db.insert).toHaveBeenCalledTimes(1);
      const auditArg = db.insertValues.mock.calls[0][0];
      expect(auditArg.policyPassed).toBe(true);
      expect(auditArg.policyReason).toBe('POLICY_PASS');
      expect(auditArg.httpStatus).toBe(200);
      expect(auditArg.errorCode).toBeNull();
      expect(auditArg.attemptNo).toBe(1);
    });

    it('sends correct HTTP headers to the sync endpoint', async () => {
      const db = buildDb();
      db.execute.mockResolvedValue({ rows: [makeRow()] });
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchSpy;

      const service = buildService(db, buildSanitizer(), buildAliasMapper(), buildSigning());
      await service.deliverPending();

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['x-mp-signature']).toBe('sig-abc');
      expect(init.headers['x-mp-key-id']).toBe('sync-key-v1');
      expect(init.headers['x-mp-idempotency-key']).toBe('idem-xyz');
    });
  });
});
