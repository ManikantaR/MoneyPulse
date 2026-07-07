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

describe('AdvisorSettingsService (per-provider keys)', () => {
  it('resolve prefers the provider env key over the stored DB key', async () => {
    const row = {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      anthropicKeyCiphertext: encryptField('db-key'),
    };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY, ANTHROPIC_API_KEY: 'env-key' }, row);
    expect(await svc.resolve()).toMatchObject({
      provider: 'anthropic',
      apiKey: 'env-key',
      keySource: 'env',
    });
  });

  it('resolve falls back to the decrypted per-provider DB key', async () => {
    const row = {
      provider: 'openai',
      model: 'gpt-4o',
      openaiKeyCiphertext: encryptField('sk-db-secret'),
    };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    expect(await svc.resolve()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-db-secret',
      keySource: 'db',
    });
  });

  it('resolve returns null when the active provider has no key — even if another does', async () => {
    // The bug this fixes: provider switched to google, but only an OpenAI key is stored.
    const row = {
      provider: 'google',
      model: null,
      openaiKeyCiphertext: encryptField('sk-openai'),
    };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    expect(await svc.resolve()).toBeNull();
  });

  it('view masks each provider key and reports configured providers', async () => {
    const row = {
      provider: 'google',
      model: 'gemini-3.5-flash',
      openaiKeyCiphertext: encryptField('sk-abcdefgh1234'),
      googleKeyCiphertext: encryptField('AIzaSyXXXXwxyz'),
    };
    const { svc } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    const view = await svc.view();

    expect(view.enabled).toBe(true); // active = google, which has a key
    expect(view.provider).toBe('google');
    expect(view.model).toBe('gemini-3.5-flash');
    expect(view.configuredProviders.sort()).toEqual(['google', 'openai']);
    expect(view.providerStatus.openai.keyMasked).toBe('sk-…1234');
    expect(view.providerStatus.google.keyMasked).toBe('AIz…wxyz');
    expect(view.providerStatus.anthropic.hasKey).toBe(false);
    expect(JSON.stringify(view)).not.toContain('abcdefgh');
  });

  it('update stores the key in the selected provider column, leaving others untouched', async () => {
    const row = { provider: 'openai', model: 'gpt-4o', openaiKeyCiphertext: encryptField('sk-old') };
    const { svc, db } = make({ ENCRYPTION_KEY: HEX_KEY }, row);
    await svc.update({ provider: 'google', model: 'gemini-3.5-flash', apiKey: 'AIza-new' });
    const stored = (db as any).captured.values;
    expect(stored.provider).toBe('google');
    expect(stored.model).toBe('gemini-3.5-flash');
    expect(stored.googleKeyCiphertext).toContain(':'); // iv:tag:ciphertext
    expect(stored.googleKeyCiphertext).not.toBe('AIza-new');
    expect(stored.openaiKeyCiphertext).toBeUndefined(); // not overwritten
  });

  it('switching provider without a key leaves all keys untouched', async () => {
    const { svc, db } = make({ ENCRYPTION_KEY: HEX_KEY });
    await svc.update({ provider: 'anthropic' });
    const stored = (db as any).captured.values;
    expect(stored.provider).toBe('anthropic');
    expect(stored.anthropicKeyCiphertext).toBeUndefined();
  });

  it('update refuses to store a key when ENCRYPTION_KEY is absent', async () => {
    const { svc } = make({});
    await expect(svc.update({ provider: 'openai', apiKey: 'sk-x' })).rejects.toThrow(
      /ENCRYPTION_KEY/,
    );
  });
});
