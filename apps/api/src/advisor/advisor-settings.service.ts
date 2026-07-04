import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { advisorSettings } from '../db/schema';
import { encryptField, decryptField } from '../common/crypto';
import { DEFAULT_MODELS, type LlmProviderId } from './llm/types';

const PROVIDERS: LlmProviderId[] = ['anthropic', 'openai'];

/** Env var that carries the API key for each provider (takes precedence over DB). */
const ENV_KEY: Record<LlmProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/** What the advisor loop needs to run: which provider, which model, and the key. */
export interface ResolvedAdvisorConfig {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
  /** Where the key came from — surfaced (not the key) so the UI can explain state. */
  keySource: 'env' | 'db';
}

/** Public, key-free view of the current settings for the web UI. */
export interface AdvisorSettingsView {
  provider: LlmProviderId;
  model: string;
  enabled: boolean;
  /** True when a key is available from either env or the DB. */
  hasKey: boolean;
  keySource: 'env' | 'db' | null;
  /** Masked hint like `sk-…a1b2`, or null. Never the full key. */
  keyMasked: string | null;
  /** True when at-rest key storage is possible (ENCRYPTION_KEY present). */
  canStoreKey: boolean;
  providers: LlmProviderId[];
  defaultModels: Record<LlmProviderId, string>;
}

/**
 * Reads/writes the global advisor settings singleton and resolves the effective
 * provider/model/key. Precedence for the key: provider env var first, then the
 * (decrypted) DB value — so ops can always pin a key via the NAS .env while the
 * web UI stays a convenience layer. The key is never returned to callers.
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

  /** Load the singleton row (id=1), or null if never saved. */
  private async loadRow(): Promise<{
    provider: string;
    model: string | null;
    apiKeyCiphertext: string | null;
  } | null> {
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

  /** Resolve the effective config, or null if no key is available anywhere. */
  async resolve(): Promise<ResolvedAdvisorConfig | null> {
    const row = await this.loadRow();
    const provider: LlmProviderId =
      row && this.isProvider(row.provider) ? row.provider : 'anthropic';
    const model = row?.model || DEFAULT_MODELS[provider];

    const envKey = this.envKey(provider);
    if (envKey) {
      return { provider, model, apiKey: envKey, keySource: 'env' };
    }
    if (row?.apiKeyCiphertext && this.canStoreKey()) {
      try {
        const apiKey = decryptField(row.apiKeyCiphertext);
        if (apiKey) return { provider, model, apiKey, keySource: 'db' };
      } catch (err: any) {
        this.logger.error(`Failed to decrypt advisor API key: ${err.message}`);
      }
    }
    return null;
  }

  /** Key-free settings view for the web UI. */
  async view(): Promise<AdvisorSettingsView> {
    const row = await this.loadRow();
    const provider: LlmProviderId =
      row && this.isProvider(row.provider) ? row.provider : 'anthropic';
    const model = row?.model || DEFAULT_MODELS[provider];

    const envKey = this.envKey(provider);
    const hasDbKey = !!row?.apiKeyCiphertext && this.canStoreKey();
    const keySource: 'env' | 'db' | null = envKey ? 'env' : hasDbKey ? 'db' : null;

    let keyMasked: string | null = null;
    if (envKey) {
      keyMasked = this.mask(envKey);
    } else if (hasDbKey) {
      try {
        keyMasked = this.mask(decryptField(row!.apiKeyCiphertext!));
      } catch {
        keyMasked = null;
      }
    }

    return {
      provider,
      model,
      enabled: keySource !== null,
      hasKey: keySource !== null,
      keySource,
      keyMasked,
      canStoreKey: this.canStoreKey(),
      providers: PROVIDERS,
      defaultModels: DEFAULT_MODELS,
    };
  }

  /**
   * Update provider/model, and optionally the API key. Passing an apiKey stores
   * it encrypted; omitting it leaves the stored key untouched (write-only field).
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
        : row && this.isProvider(row.provider)
          ? row.provider
          : 'anthropic';

    // Empty string ⇒ leave model default (null); non-empty ⇒ set it.
    const model =
      input.model !== undefined ? input.model.trim() || null : (row?.model ?? null);

    let apiKeyCiphertext = row?.apiKeyCiphertext ?? null;
    if (input.apiKey !== undefined && input.apiKey.trim()) {
      if (!this.canStoreKey()) {
        throw new Error(
          'Cannot store an API key: ENCRYPTION_KEY is not configured on the server.',
        );
      }
      apiKeyCiphertext = encryptField(input.apiKey.trim());
    }

    await this.db
      .insert(advisorSettings)
      .values({ id: 1, provider, model, apiKeyCiphertext, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: advisorSettings.id,
        set: { provider, model, apiKeyCiphertext, updatedAt: new Date() },
      });

    return this.view();
  }

  private mask(key: string): string {
    if (key.length <= 8) return '…';
    return `${key.slice(0, 3)}…${key.slice(-4)}`;
  }
}
