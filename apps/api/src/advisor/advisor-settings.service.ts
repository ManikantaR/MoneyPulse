import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { advisorSettings } from '../db/schema';
import { encryptField, decryptField } from '../common/crypto';
import { DEFAULT_MODELS, type LlmProviderId } from './llm/types';

const PROVIDERS: LlmProviderId[] = ['anthropic', 'openai', 'google'];

/** Env var that carries the API key for each provider (takes precedence over DB). */
const ENV_KEY: Record<LlmProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

/** Row column holding each provider's encrypted key. */
const KEY_COLUMN: Record<LlmProviderId, string> = {
  anthropic: 'anthropicKeyCiphertext',
  openai: 'openaiKeyCiphertext',
  google: 'googleKeyCiphertext',
};

/** What the advisor loop needs to run: which provider, which model, and the key. */
export interface ResolvedAdvisorConfig {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
  keySource: 'env' | 'db';
}

/** Per-provider key state (no secret — just whether/where a key exists + a mask). */
export interface ProviderKeyStatus {
  hasKey: boolean;
  keySource: 'env' | 'db' | null;
  keyMasked: string | null;
}

/** Public, key-free view of the current settings for the web UI. */
export interface AdvisorSettingsView {
  provider: LlmProviderId;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  keySource: 'env' | 'db' | null;
  keyMasked: string | null;
  canStoreKey: boolean;
  providers: LlmProviderId[];
  defaultModels: Record<LlmProviderId, string>;
  /** Per-provider key state so the UI can show configured providers + drive the switcher. */
  providerStatus: Record<LlmProviderId, ProviderKeyStatus>;
  /** Providers that currently have a key (env or DB) — ready to be selected. */
  configuredProviders: LlmProviderId[];
}

/**
 * Reads/writes the global advisor settings singleton and resolves the effective
 * provider/model/key. Each provider has its own encrypted key so switching provider
 * never sends the wrong key. Key precedence: provider env var first, then the
 * (decrypted) per-provider DB value. Keys are never returned to callers.
 */
@Injectable()
export class AdvisorSettingsService {
  private readonly logger = new Logger(AdvisorSettingsService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_CONNECTION) private readonly db: any,
  ) {}

  private isProvider(v: string): v is LlmProviderId {
    return (PROVIDERS as string[]).includes(v);
  }

  private canStoreKey(): boolean {
    const hex = this.config.get<string>('ENCRYPTION_KEY');
    return !!hex && hex.length === 64;
  }

  private async loadRow(): Promise<any | null> {
    const rows = await this.db
      .select()
      .from(advisorSettings)
      .where(eq(advisorSettings.id, 1))
      .limit(1);
    return rows[0] ?? null;
  }

  private envKey(provider: LlmProviderId): string | undefined {
    return this.config.get<string>(ENV_KEY[provider]);
  }

  private ciphertext(row: any | null, provider: LlmProviderId): string | null {
    return (row?.[KEY_COLUMN[provider]] as string | null) ?? null;
  }

  /** Effective key for a provider (env → per-provider DB), or null. */
  private keyFor(
    row: any | null,
    provider: LlmProviderId,
  ): { apiKey: string; keySource: 'env' | 'db' } | null {
    const env = this.envKey(provider);
    if (env) return { apiKey: env, keySource: 'env' };
    const ct = this.ciphertext(row, provider);
    if (ct && this.canStoreKey()) {
      try {
        const apiKey = decryptField(ct);
        if (apiKey) return { apiKey, keySource: 'db' };
      } catch (err: any) {
        this.logger.error(`Failed to decrypt ${provider} advisor key: ${err.message}`);
      }
    }
    return null;
  }

  private activeProvider(row: any | null): LlmProviderId {
    return row && this.isProvider(row.provider) ? row.provider : 'anthropic';
  }

  /** Resolve the effective config for the active provider, or null if it has no key. */
  async resolve(): Promise<ResolvedAdvisorConfig | null> {
    const row = await this.loadRow();
    const provider = this.activeProvider(row);
    const model = row?.model || DEFAULT_MODELS[provider];
    const key = this.keyFor(row, provider);
    return key ? { provider, model, apiKey: key.apiKey, keySource: key.keySource } : null;
  }

  /** Resolve for a specific provider (used to test a provider's stored key). */
  async resolveFor(
    provider: LlmProviderId,
    model?: string,
  ): Promise<{ model: string; apiKey: string } | null> {
    const row = await this.loadRow();
    const key = this.keyFor(row, provider);
    if (!key) return null;
    return { model: model?.trim() || row?.model || DEFAULT_MODELS[provider], apiKey: key.apiKey };
  }

  /** Key-free settings view for the web UI. */
  async view(): Promise<AdvisorSettingsView> {
    const row = await this.loadRow();
    const provider = this.activeProvider(row);
    const model = row?.model || DEFAULT_MODELS[provider];

    const providerStatus = {} as Record<LlmProviderId, ProviderKeyStatus>;
    for (const p of PROVIDERS) {
      const key = this.keyFor(row, p);
      providerStatus[p] = {
        hasKey: !!key,
        keySource: key?.keySource ?? null,
        keyMasked: key ? this.mask(key.apiKey) : null,
      };
    }
    const active = providerStatus[provider];
    const configuredProviders = PROVIDERS.filter((p) => providerStatus[p].hasKey);

    return {
      provider,
      model,
      enabled: active.hasKey,
      hasKey: active.hasKey,
      keySource: active.keySource,
      keyMasked: active.keyMasked,
      canStoreKey: this.canStoreKey(),
      providers: PROVIDERS,
      defaultModels: DEFAULT_MODELS,
      providerStatus,
      configuredProviders,
    };
  }

  /**
   * Update the active provider/model, and optionally a key. A provided apiKey is stored
   * (encrypted) in the *selected provider's* column; omitting it leaves keys untouched —
   * so switching provider never overwrites or misuses another provider's key.
   */
  async update(input: {
    provider?: string;
    model?: string;
    apiKey?: string;
  }): Promise<AdvisorSettingsView> {
    const row = await this.loadRow();
    const provider =
      input.provider && this.isProvider(input.provider)
        ? input.provider
        : this.activeProvider(row);

    const model =
      input.model !== undefined ? input.model.trim() || null : (row?.model ?? null);

    const keyUpdate: Record<string, string> = {};
    if (input.apiKey !== undefined && input.apiKey.trim()) {
      if (!this.canStoreKey()) {
        throw new Error(
          'Cannot store an API key: ENCRYPTION_KEY is not configured on the server.',
        );
      }
      keyUpdate[KEY_COLUMN[provider]] = encryptField(input.apiKey.trim());
    }

    await this.db
      .insert(advisorSettings)
      .values({ id: 1, provider, model, ...keyUpdate, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: advisorSettings.id,
        set: { provider, model, ...keyUpdate, updatedAt: new Date() },
      });

    return this.view();
  }

  private mask(key: string): string {
    if (key.length <= 8) return '…';
    return `${key.slice(0, 3)}…${key.slice(-4)}`;
  }
}
