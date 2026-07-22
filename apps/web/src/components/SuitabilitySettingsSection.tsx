'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

interface TargetAllocationEntry {
  assetClass: string;
  targetPercent: number;
}

interface SuitabilitySettingsView {
  version: number;
  emergencyFundTargetMonths: number;
  liquidityHorizonMonths: number | null;
  riskTolerance: RiskTolerance | null;
  taxState: string | null;
  monthlyInvestingTargetCents: number | null;
  targetAllocation: TargetAllocationEntry[];
  tickerAssetClassMap: Record<string, string>;
  dcaDayOfMonth: number | null;
  dcaAmountCents: number | null;
}

const DEFAULTS = {
  emergencyFundTargetMonths: 6,
  liquidityHorizonMonths: '',
  riskTolerance: '' as RiskTolerance | '',
  taxState: '',
  monthlyInvestingTargetCents: '',
  dcaDayOfMonth: '',
  dcaAmountCents: '',
};

/**
 * 12.4 — suitability settings & investment policy. Every save creates a NEW
 * version server-side (never overwrites); this UI always shows/edits the current
 * (latest) version. These fields feed future automated recommendations (Investment
 * Coach, #122) — the gate there refuses to guess a missing field rather than
 * fabricating advice, so filling these in unlocks more specific recommendations.
 */
export function SuitabilitySettingsSection() {
  const [current, setCurrent] = useState<SuitabilitySettingsView | null>(null);
  const [form, setForm] = useState(DEFAULTS);
  const [allocation, setAllocation] = useState<TargetAllocationEntry[]>([]);
  const [tickerMap, setTickerMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () =>
    api
      .get<{ data: SuitabilitySettingsView | null }>('/suitability-settings')
      .then(({ data }) => {
        if (!data) return;
        setCurrent(data);
        setForm({
          emergencyFundTargetMonths: data.emergencyFundTargetMonths,
          liquidityHorizonMonths: data.liquidityHorizonMonths?.toString() ?? '',
          riskTolerance: data.riskTolerance ?? '',
          taxState: data.taxState ?? '',
          monthlyInvestingTargetCents:
            data.monthlyInvestingTargetCents != null
              ? (data.monthlyInvestingTargetCents / 100).toString()
              : '',
          dcaDayOfMonth: data.dcaDayOfMonth?.toString() ?? '',
          dcaAmountCents:
            data.dcaAmountCents != null ? (data.dcaAmountCents / 100).toString() : '',
        });
        setAllocation(data.targetAllocation ?? []);
        setTickerMap(data.tickerAssetClassMap ?? {});
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.put<{ data: SuitabilitySettingsView }>(
        '/suitability-settings',
        {
          emergencyFundTargetMonths: Number(form.emergencyFundTargetMonths) || 6,
          liquidityHorizonMonths: form.liquidityHorizonMonths
            ? Number(form.liquidityHorizonMonths)
            : null,
          riskTolerance: form.riskTolerance || null,
          taxState: form.taxState || null,
          monthlyInvestingTargetCents: form.monthlyInvestingTargetCents
            ? Math.round(Number(form.monthlyInvestingTargetCents) * 100)
            : null,
          targetAllocation: allocation,
          tickerAssetClassMap: tickerMap,
          dcaDayOfMonth: form.dcaDayOfMonth ? Number(form.dcaDayOfMonth) : null,
          dcaAmountCents: form.dcaAmountCents
            ? Math.round(Number(form.dcaAmountCents) * 100)
            : null,
        },
      );
      setCurrent(data);
      setMessage(`Saved as version ${data.version}.`);
    } catch (err: any) {
      setMessage(err.message || 'Failed to save suitability settings');
    } finally {
      setBusy(false);
    }
  }

  function updateAllocationRow(i: number, patch: Partial<TargetAllocationEntry>) {
    setAllocation((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-[var(--primary)]" />
        <h2 className="text-lg font-bold">Investment Policy &amp; Suitability</h2>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        These answers let future automated recommendations (which account/vehicle to
        use, how much to invest) be specific to your situation. If a field here is
        left blank, a recommendation that needs it will say exactly what&apos;s
        missing instead of guessing. Changes are versioned — this is version{' '}
        {current?.version ?? '(none yet)'}; older versions stay on record so past
        recommendations can be traced to the policy in effect at the time.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            Emergency fund target (months of expenses)
          </span>
          <p className="text-xs text-[var(--muted-foreground)]">
            Used to gate investing recommendations — the coach won&apos;t suggest
            investing until this buffer is funded.
          </p>
          <input
            type="number"
            min={0}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.emergencyFundTargetMonths}
            onChange={(e) =>
              setForm((f) => ({ ...f, emergencyFundTargetMonths: e.target.value as any }))
            }
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Liquidity horizon (months)</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            How soon you might need cash beyond the emergency fund (e.g. a house
            down payment) — keeps that money out of anything illiquid.
          </p>
          <input
            type="number"
            min={0}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.liquidityHorizonMonths}
            onChange={(e) =>
              setForm((f) => ({ ...f, liquidityHorizonMonths: e.target.value }))
            }
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Risk tolerance</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            Shapes which vehicles get recommended and how aggressively drift gets
            corrected.
          </p>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.riskTolerance}
            onChange={(e) =>
              setForm((f) => ({ ...f, riskTolerance: e.target.value as RiskTolerance | '' }))
            }
          >
            <option value="">Not set</option>
            <option value="conservative">Conservative</option>
            <option value="moderate">Moderate</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Tax state</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            Two-letter state code — used to frame Treasury/muni state-tax exemption
            in evidence.
          </p>
          <input
            type="text"
            maxLength={2}
            placeholder="e.g. NY"
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 uppercase"
            value={form.taxState}
            onChange={(e) =>
              setForm((f) => ({ ...f, taxState: e.target.value.toUpperCase() }))
            }
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Monthly investing target ($)</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            Leave blank to let the future Investment Coach propose an amount from
            your surplus instead of fixing one yourself.
          </p>
          <input
            type="number"
            min={0}
            step="0.01"
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.monthlyInvestingTargetCents}
            onChange={(e) =>
              setForm((f) => ({ ...f, monthlyInvestingTargetCents: e.target.value }))
            }
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">DCA day of month</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            The day recurring contributions land — informs (never executes) the
            dollar-cost-averaging policy.
          </p>
          <input
            type="number"
            min={1}
            max={28}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.dcaDayOfMonth}
            onChange={(e) => setForm((f) => ({ ...f, dcaDayOfMonth: e.target.value }))}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">DCA amount ($)</span>
          <p className="text-xs text-[var(--muted-foreground)]">
            Leave blank if contributions are irregular.
          </p>
          <input
            type="number"
            min={0}
            step="0.01"
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            value={form.dcaAmountCents}
            onChange={(e) => setForm((f) => ({ ...f, dcaAmountCents: e.target.value }))}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Target allocation</span>
          <button
            type="button"
            onClick={() => setAllocation((a) => [...a, { assetClass: '', targetPercent: 0 }])}
            className="text-xs font-semibold text-[var(--primary)] hover:underline"
          >
            + Add asset class
          </button>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          e.g. US equity 70%, international 20%, bonds 10%. Drives allocation-drift
          comparisons against your actual holdings.
        </p>
        {allocation.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="asset class (e.g. us_equity)"
              className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              value={row.assetClass}
              onChange={(e) => updateAllocationRow(i, { assetClass: e.target.value })}
            />
            <input
              type="number"
              min={0}
              max={100}
              placeholder="%"
              className="w-24 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              value={row.targetPercent}
              onChange={(e) =>
                updateAllocationRow(i, { targetPercent: Number(e.target.value) || 0 })
              }
            />
            <button
              type="button"
              onClick={() => setAllocation((a) => a.filter((_, idx) => idx !== i))}
              className="text-xs text-[var(--destructive)] hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {message && (
        <p
          className={`text-sm ${
            message.toLowerCase().includes('fail') ? 'text-[var(--destructive)]' : 'text-[var(--primary)]'
          }`}
        >
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? 'Saving...' : 'Save Suitability Settings'}
      </button>
    </section>
  );
}
