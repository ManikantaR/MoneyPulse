'use client';

import { useState } from 'react';
import { Plus, Wallet, Trash2 } from 'lucide-react';
import {
  usePaycheckProfiles,
  useCreatePaycheckProfile,
  useDeletePaycheckProfile,
} from '@/lib/hooks/usePaycheckProfiles';
import { formatCents } from '@/lib/format';
import type { CreatePaycheckProfileInput } from '@moneypulse/shared';

/** Dollar-denominated form fields that get converted to *Cents on submit. */
const DOLLAR_FIELDS: { key: keyof CreatePaycheckProfileInput; label: string }[] = [
  { key: 'grossPayCents', label: 'Gross pay per paycheck ($)' },
  { key: 'federalTaxCents', label: 'Federal tax ($)' },
  { key: 'stateTaxCents', label: 'State tax ($)' },
  { key: 'socialSecurityCents', label: 'Social Security ($)' },
  { key: 'medicareCents', label: 'Medicare ($)' },
  { key: 'pretax401kCents', label: '401(k) pre-tax ($)' },
  { key: 'hsaCents', label: 'HSA ($)' },
  { key: 'medicalPremiumCents', label: 'Medical premium ($)' },
  { key: 'dentalPremiumCents', label: 'Dental premium ($)' },
  { key: 'visionPremiumCents', label: 'Vision premium ($)' },
  { key: 'commuterCents', label: 'Commuter ($)' },
  { key: 'parkingCents', label: 'Parking ($)' },
  { key: 'esppContributionCents', label: 'ESPP contribution ($)' },
  { key: 'employer401kMatchCents', label: 'Employer 401(k) match ($)' },
  { key: 'employerHealthContributionCents', label: 'Employer health contribution ($)' },
];

const EMPTY_FORM = {
  effectiveDate: '',
  payFrequency: 'biweekly' as const,
  esppDiscountPercent: '' as string,
  ...Object.fromEntries(DOLLAR_FIELDS.map((f) => [f.key, ''])),
};

/** Settings page: list, add paycheck profiles (effective-dated take-home pay history). */
export default function PaycheckProfilesPage() {
  const { data, isLoading } = usePaycheckProfiles();
  const createProfile = useCreatePaycheckProfile();
  const deleteProfile = useDeletePaycheckProfile();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const profiles = data?.data ?? [];

  function toCents(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.effectiveDate) {
      setError('Effective date is required');
      return;
    }
    const body: CreatePaycheckProfileInput = {
      effectiveDate: form.effectiveDate,
      payFrequency: form.payFrequency as CreatePaycheckProfileInput['payFrequency'],
      esppDiscountPercent: form.esppDiscountPercent
        ? Number(form.esppDiscountPercent)
        : null,
      ...Object.fromEntries(
        DOLLAR_FIELDS.map((f) => [f.key, toCents(form[f.key] ?? '')]),
      ),
    } as CreatePaycheckProfileInput;
    try {
      await createProfile.mutateAsync(body);
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Paycheck Profiles</h1>
          <p className="text-[var(--muted-foreground)]">
            Effective-dated take-home pay history, used to power the 50/30/20 dashboard.
            A pay change (raise, new deduction) should be added as a new profile, not an
            edit to an old one.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Profile
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm"
        >
          <h2 className="text-lg font-bold">New Paycheck Profile</h2>
          {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Effective Date</label>
              <input
                type="date"
                required
                value={form.effectiveDate}
                onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Pay Frequency</label>
              <select
                value={form.payFrequency}
                onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semi_monthly">Semi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {DOLLAR_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-sm font-semibold">{f.label}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="mb-1.5 block text-sm font-semibold">ESPP discount (%)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={form.esppDiscountPercent}
                onChange={(e) => setForm({ ...form, esppDiscountPercent: e.target.value })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createProfile.isPending}
              className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {createProfile.isPending ? 'Saving...' : 'Save Profile'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <Wallet className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No paycheck profiles yet. Add one to power the 50/30/20 dashboard.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
            >
              <div>
                <p className="text-sm font-bold">Effective {p.effectiveDate}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {p.payFrequency.replace('_', '-')} · Gross {formatCents(p.grossPayCents)}/paycheck
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm('Delete this paycheck profile?')) {
                    deleteProfile.mutate(p.id);
                  }
                }}
                className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)] transition-colors"
                aria-label="Delete paycheck profile"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
