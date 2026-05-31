import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MerchantNormalizerService } from '../merchant-normalizer.service';

function makeService() {
  const config = {
    get: (key: string) => {
      if (key === 'OLLAMA_URL') return 'http://localhost:11434';
      if (key === 'OLLAMA_MODEL') return 'llama3.2:3b';
      if (key === 'OLLAMA_TIMEOUT_MS') return '5000';
      return undefined;
    },
  };
  const ollamaHealth = { isAvailable: vi.fn().mockResolvedValue(true) };
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  };
  return new MerchantNormalizerService(db as any, config as any, ollamaHealth as any);
}

describe('MerchantNormalizerService.ruleBasedNormalize', () => {
  let svc: MerchantNormalizerService;

  beforeEach(() => {
    svc = makeService();
  });

  // ── 5 real-world examples from the spec ──────────────────────────────────

  it('Netflix.Com Los Gatos Ca Null → Netflix', () => {
    expect(svc.ruleBasedNormalize('Netflix.Com Los Gatos Ca Null')).toBe('Netflix');
  });

  it('Spectrum Mobile 855-707-7328 Mo → Spectrum Mobile', () => {
    expect(svc.ruleBasedNormalize('Spectrum Mobile 855-707-7328 Mo')).toBe('Spectrum Mobile');
  });

  it('Walmart.Com W+ Amex Bentonville Ar → Walmart', () => {
    expect(svc.ruleBasedNormalize('Walmart.Com W+ Amex Bentonville Ar')).toBe('Walmart');
  });

  it('Py *Evergreen Pest So → Evergreen Pest', () => {
    expect(svc.ruleBasedNormalize('Py *Evergreen Pest So')).toBe('Evergreen Pest');
  });

  it('Arlo Technologies Inc 408-638-3750 Ca → Arlo Technologies', () => {
    expect(svc.ruleBasedNormalize('Arlo Technologies Inc 408-638-3750 Ca')).toBe('Arlo Technologies');
  });

  // ── Existing ALL-UPPER behavior preserved ─────────────────────────────────

  it('WHOLE FOODS MARKET RICHMOND VA → Whole Foods Market', () => {
    expect(svc.ruleBasedNormalize('WHOLE FOODS MARKET RICHMOND VA')).toBe('Whole Foods Market');
  });

  it('SQ *STARBUCKS → Starbucks', () => {
    expect(svc.ruleBasedNormalize('SQ *STARBUCKS')).toBe('Starbucks');
  });

  // ── Negative: should NOT over-strip ──────────────────────────────────────

  it('Costco → Costco (co in Costco not stripped)', () => {
    expect(svc.ruleBasedNormalize('Costco')).toBe('Costco');
  });

  it('AT&T → At&t (title-cased since all-uppercase input)', () => {
    // All-uppercase input like "AT&T" gets title-cased; mixed-case "At&T" would preserve the &T
    expect(svc.ruleBasedNormalize('AT&T')).toBe('At&t');
  });

  it('returns raw input when blank', () => {
    expect(svc.ruleBasedNormalize('')).toBe('');
  });
});

describe('MerchantNormalizerService.isMessyResult', () => {
  let svc: MerchantNormalizerService;
  beforeEach(() => { svc = makeService(); });

  it('unchanged from raw → messy', () => {
    expect(svc.isMessyResult('Netflix.Com Los Gatos', 'Netflix.Com Los Gatos')).toBe(true);
  });

  it('contains digits → messy', () => {
    expect(svc.isMessyResult('Arlo Tech', 'Arlo Tech 408')).toBe(true);
  });

  it('>3 tokens → messy', () => {
    expect(svc.isMessyResult('A B C D raw', 'A B C D')).toBe(true);
  });

  it('clean 2-token result → not messy', () => {
    expect(svc.isMessyResult('Spectrum Mobile 855-707-7328 Mo', 'Spectrum Mobile')).toBe(false);
  });
});

describe('MerchantNormalizerService.aiNormalizeBatch', () => {
  let svc: MerchantNormalizerService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = makeService();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Map of cleaned names from Ollama JSON response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"Arlo Technologies Inc 408-638-3750 Ca": "Arlo Technologies", "Netflix.Com Los Gatos Ca Null": "Netflix"}',
      }),
    });

    const result = await svc.aiNormalizeBatch([
      'Arlo Technologies Inc 408-638-3750 Ca',
      'Netflix.Com Los Gatos Ca Null',
    ]);

    expect(result.get('Arlo Technologies Inc 408-638-3750 Ca')).toBe('Arlo Technologies');
    expect(result.get('Netflix.Com Los Gatos Ca Null')).toBe('Netflix');
    expect(result.size).toBe(2);
  });

  it('returns empty Map when Ollama is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await svc.aiNormalizeBatch(['some raw descriptor']);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when response has no JSON object', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'I cannot help with that.' }),
    });
    const result = await svc.aiNormalizeBatch(['some raw descriptor']);
    expect(result.size).toBe(0);
  });

  it('excludes entries where clean equals raw (no improvement)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"unchanged raw": "unchanged raw", "messy raw": "Messy Raw Clean"}',
      }),
    });
    const result = await svc.aiNormalizeBatch(['unchanged raw', 'messy raw']);
    expect(result.has('unchanged raw')).toBe(false);
    expect(result.get('messy raw')).toBe('Messy Raw Clean');
  });

  it('returns empty Map for empty input', async () => {
    const result = await svc.aiNormalizeBatch([]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
