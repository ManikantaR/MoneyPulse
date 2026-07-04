import { describe, it, expect, beforeAll } from 'vitest';
import { AdvisorSettingsService } from '../advisor-settings.service';
import { encryptField } from '../../common/crypto';

const HEX_KEY = 'a'.repeat(64); // valid 32-byte hex for ENCRYPTION_KEY

beforeAll(() => {
  process.env.ENCRYPTION_KEY = HEX_KEY;
});

function fakeDb(row: any) {
  const captured: { values?: any } = {};
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }),
    }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: async () => {
          captured.values = v;
        },
      }),
    }),
    captured,
  };
  return db;
}

function make(env: Record<string, string | undefined>, row: any = null) {
  const config = { get: (k: string) => env[k] };
  const db = fakeDb(row);
  const svc = new AdvisorSettingsService(config as any, db as any);
  return { svc, db };
}

describe('AdvisorSettingsService', () => {
  it('resolve prefers the provider env key over the stored DB key', async () => {
    const row = { provider: 'anthropic', model: 'claude-opus-4-8', apiKeyCiphertext: encryptField('db-key') };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY, ANTHROPIC_API_KEY: 'env-key' }, row);
    const resolved = await svc.resolve();
    expect(resolved).toMatchObject({ provider: 'anthropic', apiKey: 'env-key', keySource: 'env' });
  });

  it('resolve falls back to the decrypted DB key when no env key', async () => {
    const row = { provider: 'openai', model: 'gpt-4o', apiKeyCiphertext: encryptField('sk-db-secret') };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    const resolved = await svc.resolve();
    expect(resolved).toMatchObject({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-db-secret', keySource: 'db' });
  });

  it('resolve returns null when no key is available anywhere', async () => {
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, { provider: 'anthropic', model: null, apiKeyCiphertext: null });
    expect(await svc.resolve()).toBeNull();
  });

  it('view masks the key and never returns it in full', async () => {
    const row = { provider: 'anthropic', model: null, apiKeyCiphertext: encryptField('sk-abcdefgh1234') };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    const view = await svc.view();
    expect(view.enabled).toBe(true);
    expect(view.keySource).toBe('db');
    expect(view.keyMasked).toBe('sk-…1234');
    expect(view.model).toBe('claude-opus-4-8'); // default filled in
    expect(JSON.stringify(view)).not.toContain('abcdefgh');
  });

  it('update encrypts the API key and persists provider/model', async () => {
    const { svc, db } = make({ ENCRYPTION_KEY: HEX_KEY });
    await svc.update({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-plaintext' });
    const stored = (db as any).captured.values;
    expect(stored.provider).toBe('openai');
    expect(stored.model).toBe('gpt-4o');
    expect(stored.apiKeyCiphertext).not.toBe('sk-plaintext');
    expect(stored.apiKeyCiphertext).toContain(':'); // iv:tag:ciphertext
  });

  it('update refuses to store a key when ENCRYPTION_KEY is absent', async () => {
    const { svc } = make({}); // canStoreKey() false
    await expect(svc.update({ provider: 'openai', apiKey: 'sk-x' })).rejects.toThrow(
      /ENCRYPTION_KEY/,
    );
  });
});
