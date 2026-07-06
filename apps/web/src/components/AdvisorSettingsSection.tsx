'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';

type Provider = 'anthropic' | 'openai' | 'google';

interface AdvisorSettingsView {
  provider: Provider;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  keySource: 'env' | 'db' | null;
  keyMasked: string | null;
  canStoreKey: boolean;
  providers: Provider[];
  defaultModels: Record<Provider, string>;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  google: 'Gemini (Google)',
};

/** Global AI-advisor provider/model/key configuration (see /advisor). */
export function AdvisorSettingsSection() {
  const [view, setView] = useState<AdvisorSettingsView | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () =>
    api
      .get<{ data: AdvisorSettingsView }>('/advisor/settings')
      .then(({ data }) => {
        setView(data);
        setProvider(data.provider);
        setModel(data.model);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const isError = message.toLowerCase().includes('fail') || message.includes('✗');

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.put<{ data: AdvisorSettingsView }>('/advisor/settings', {
        provider,
        model,
        // Only send the key when the user typed a new one (write-only field).
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setView(data);
      setApiKey('');
      setMessage('Saved.');
    } catch (err: any) {
      setMessage(err.message || 'Failed to save advisor settings');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.post<{ data: { ok: boolean; error?: string } }>(
        '/advisor/settings/test',
        {
          provider,
          model,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      );
      setMessage(data.ok ? '✓ Connection OK' : `✗ ${data.error ?? 'Connection failed'}`);
    } catch (err: any) {
      setMessage(err.message || 'Failed to test connection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-[var(--primary)]" />
        <h2 className="text-lg font-bold">AI Advisor</h2>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        Choose the model that powers the Advisor chat. Your API key is stored encrypted and
        never shown again. An <code>ANTHROPIC_API_KEY</code>/<code>OPENAI_API_KEY</code> set in
        the server environment takes precedence.
      </p>

      <div>
        <label htmlFor="advisor-provider" className="block text-sm font-semibold">
          Provider
        </label>
        <select
          id="advisor-provider"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as Provider;
            setProvider(p);
            // Offer the provider's default model as a starting point.
            if (view) setModel(view.defaultModels[p]);
          }}
          className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
        >
          {(view?.providers ?? (['anthropic', 'openai', 'google'] as Provider[])).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="advisor-model" className="block text-sm font-semibold">
          Model
        </label>
        <input
          id="advisor-model"
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={view?.defaultModels[provider]}
          className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm font-mono placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
        />
      </div>

      <div>
        <label htmlFor="advisor-key" className="block text-sm font-semibold">
          API key
        </label>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {view?.keySource === 'env'
            ? `Using the server environment key (${view.keyMasked}). Entering one here has no effect while the env var is set.`
            : view?.hasKey
              ? `A key is saved (${view.keyMasked}). Enter a new one to replace it.`
              : view?.canStoreKey === false
                ? 'Set ENCRYPTION_KEY on the server to store a key here, or use the environment variable.'
                : 'No key saved yet.'}
        </p>
        <input
          id="advisor-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={view?.hasKey ? '•••••••• (unchanged)' : 'sk-…'}
          autoComplete="off"
          className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm font-mono placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
        />
      </div>

      {message && (
        <p
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            isError
              ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]'
              : 'bg-[var(--secondary)]/10 text-[var(--secondary)]'
          }`}
        >
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Save advisor settings'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={test}
          className="rounded-full border border-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary)] hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)] transition-colors disabled:opacity-50"
        >
          Test connection
        </button>
      </div>
    </section>
  );
}
