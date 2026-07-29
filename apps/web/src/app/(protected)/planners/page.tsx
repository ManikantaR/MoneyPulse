'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

// 40.4 — Simple dedicated forms for the three goal-planner engines (#40.1–#40.3),
// mirroring the same allowlisted MCP tools the advisor chat calls, so the numbers
// shown here always match what the chat narrates. Each result panel echoes the
// assumptions used, per epic #36's "show the math + stated assumptions" bar.

type Tab = 'safe-to-spend' | 'car' | 'college';

const TABS: { id: Tab; label: string }[] = [
  { id: 'safe-to-spend', label: 'Safe to spend' },
  { id: 'car', label: 'Car affordability' },
  { id: 'college', label: 'College / 529' },
];

function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none';

// ── Safe to spend ────────────────────────────────────────────

interface SafeToSpendResult {
  safeToSpendCents: number;
  minProjectedCents: number;
  minDate: string | null;
  goalContributionsCents: number;
}

function SafeToSpendPanel() {
  const [horizonDays, setHorizonDays] = useState<30 | 60 | 90>(30);
  const [goalDollars, setGoalDollars] = useState('0');
  const [result, setResult] = useState<SafeToSpendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const goalContributionsCents = Math.round((parseFloat(goalDollars) || 0) * 100);
      const { data } = await api.get<{ data: SafeToSpendResult }>('/analytics/safe-to-spend', {
        params: { horizonDays, goalContributionsCents },
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to compute safe-to-spend.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Horizon">
        <select
          className={inputClass}
          value={horizonDays}
          onChange={(e) => setHorizonDays(Number(e.target.value) as 30 | 60 | 90)}
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </Field>
      <Field label="Already earmarked toward goals ($)">
        <input
          className={inputClass}
          type="number"
          min={0}
          step="0.01"
          value={goalDollars}
          onChange={(e) => setGoalDollars(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        disabled={loading}
        className="w-fit rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Calculating…' : 'Calculate'}
      </button>
      {error && <ErrorBanner message={error} />}
      {result && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="text-lg font-semibold">{dollars(result.safeToSpendCents)} safe to spend</p>
          <p className="mt-1 text-gray-600">
            Lowest projected combined balance over the next {horizonDays} days is{' '}
            {dollars(result.minProjectedCents)}
            {result.minDate ? ` (around ${result.minDate})` : ''}, already net of every recurring
            bill due in that window, minus {dollars(result.goalContributionsCents)} earmarked for
            goals.
          </p>
        </div>
      )}
    </form>
  );
}

// ── Car affordability ────────────────────────────────────────

function CarAffordabilityPanel() {
  const [form, setForm] = useState({
    priceDollars: '30000',
    downPaymentDollars: '6000',
    loanTermMonths: '48',
    loanAprPercent: '6.5',
    grossMonthlyIncomeDollars: '',
    insuranceAmountDollars: '1200',
    maintenanceAmountDollars: '600',
    annualMileage: '12000',
    mpg: '30',
    gasPriceDollarsPerGallon: '3.50',
    ownershipYears: '5',
    estimatedResaleValueDollars: '12000',
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<{ data: any }>('/car-affordability/calculate', {
        priceDollars: parseFloat(form.priceDollars),
        downPaymentDollars: parseFloat(form.downPaymentDollars),
        loanTermMonths: parseInt(form.loanTermMonths, 10),
        loanAprPercent: parseFloat(form.loanAprPercent),
        grossMonthlyIncomeDollars: parseFloat(form.grossMonthlyIncomeDollars),
        insuranceAmountDollars: parseFloat(form.insuranceAmountDollars),
        insuranceFrequency: 'annual',
        maintenanceAmountDollars: parseFloat(form.maintenanceAmountDollars),
        maintenanceFrequency: 'annual',
        annualMileage: parseFloat(form.annualMileage),
        mpg: parseFloat(form.mpg),
        gasPriceDollarsPerGallon: parseFloat(form.gasPriceDollarsPerGallon),
        ownershipYears: parseFloat(form.ownershipYears),
        estimatedResaleValueDollars: parseFloat(form.estimatedResaleValueDollars),
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to calculate car affordability.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle price ($)">
          <input className={inputClass} type="number" value={form.priceDollars} onChange={(e) => set('priceDollars', e.target.value)} />
        </Field>
        <Field label="Down payment ($)">
          <input className={inputClass} type="number" value={form.downPaymentDollars} onChange={(e) => set('downPaymentDollars', e.target.value)} />
        </Field>
        <Field label="Loan term (months)">
          <input className={inputClass} type="number" value={form.loanTermMonths} onChange={(e) => set('loanTermMonths', e.target.value)} />
        </Field>
        <Field label="Loan APR (%)">
          <input className={inputClass} type="number" step="0.01" value={form.loanAprPercent} onChange={(e) => set('loanAprPercent', e.target.value)} />
        </Field>
        <Field label="Gross monthly income ($)">
          <input className={inputClass} type="number" required value={form.grossMonthlyIncomeDollars} onChange={(e) => set('grossMonthlyIncomeDollars', e.target.value)} />
        </Field>
        <Field label="Annual insurance ($)">
          <input className={inputClass} type="number" value={form.insuranceAmountDollars} onChange={(e) => set('insuranceAmountDollars', e.target.value)} />
        </Field>
        <Field label="Annual maintenance ($)">
          <input className={inputClass} type="number" value={form.maintenanceAmountDollars} onChange={(e) => set('maintenanceAmountDollars', e.target.value)} />
        </Field>
        <Field label="Annual mileage">
          <input className={inputClass} type="number" value={form.annualMileage} onChange={(e) => set('annualMileage', e.target.value)} />
        </Field>
        <Field label="MPG">
          <input className={inputClass} type="number" value={form.mpg} onChange={(e) => set('mpg', e.target.value)} />
        </Field>
        <Field label="Gas price ($/gal)">
          <input className={inputClass} type="number" step="0.01" value={form.gasPriceDollarsPerGallon} onChange={(e) => set('gasPriceDollarsPerGallon', e.target.value)} />
        </Field>
        <Field label="Ownership period (years)">
          <input className={inputClass} type="number" value={form.ownershipYears} onChange={(e) => set('ownershipYears', e.target.value)} />
        </Field>
        <Field label="Estimated resale value ($)">
          <input className={inputClass} type="number" value={form.estimatedResaleValueDollars} onChange={(e) => set('estimatedResaleValueDollars', e.target.value)} />
        </Field>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-fit rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Calculating…' : 'Calculate'}
      </button>
      {error && <ErrorBanner message={error} />}
      {result && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="text-lg font-semibold">
            20/4/10 rule: {result.rule204010.passes ? 'Passes' : 'Fails'}
          </p>
          <ul className="mt-2 space-y-1 text-gray-700">
            <li>Total monthly vehicle cost: {dollars(result.tco.monthlyLoanPaymentCents + result.tco.monthlyInsuranceCents + result.tco.monthlyMaintenanceCents + result.tco.monthlyFuelCents)}</li>
            <li>Monthly loan payment: {dollars(result.tco.monthlyLoanPaymentCents)}</li>
            <li>Total cost of ownership: {dollars(result.tco.totalCostCents)}</li>
          </ul>
          {result.buyVsLease && (
            <p className="mt-2 text-gray-700">
              Buy vs lease over {result.buyVsLease.comparisonMonths} months: {result.buyVsLease.cheaperOption} is
              cheaper by {dollars(Math.abs(result.buyVsLease.costDifferenceCents))}.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

// ── College / 529 ────────────────────────────────────────────

function CollegePlannerPanel() {
  const [form, setForm] = useState({
    currentAnnualCostDollars: '30000',
    yearsUntilStart: '10',
    currentSavingsDollars: '5000',
    monthlyIncomeCapacityDollars: '',
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<{ data: any }>('/college-planner/calculate', {
        currentAnnualCostCents: Math.round(parseFloat(form.currentAnnualCostDollars) * 100),
        yearsUntilStart: parseInt(form.yearsUntilStart, 10),
        currentSavingsCents: Math.round(parseFloat(form.currentSavingsDollars) * 100),
        ...(form.monthlyIncomeCapacityDollars
          ? { monthlyIncomeCapacityDuringSchoolCents: Math.round(parseFloat(form.monthlyIncomeCapacityDollars) * 100) }
          : {}),
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to calculate college plan.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Current annual cost ($, today's dollars)">
        <input className={inputClass} type="number" value={form.currentAnnualCostDollars} onChange={(e) => set('currentAnnualCostDollars', e.target.value)} />
      </Field>
      <Field label="Years until student starts">
        <input className={inputClass} type="number" value={form.yearsUntilStart} onChange={(e) => set('yearsUntilStart', e.target.value)} />
      </Field>
      <Field label="Current 529 / savings balance ($)">
        <input className={inputClass} type="number" value={form.currentSavingsDollars} onChange={(e) => set('currentSavingsDollars', e.target.value)} />
      </Field>
      <Field label="Monthly income you could redirect during school ($, optional)">
        <input className={inputClass} type="number" value={form.monthlyIncomeCapacityDollars} onChange={(e) => set('monthlyIncomeCapacityDollars', e.target.value)} />
      </Field>
      <button
        type="submit"
        disabled={loading}
        className="w-fit rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Calculating…' : 'Calculate'}
      </button>
      {error && <ErrorBanner message={error} />}
      {result && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="text-lg font-semibold">
            Projected total cost: {dollars(result.totalProjectedCostCents)}
          </p>
          <ul className="mt-2 space-y-1 text-gray-700">
            <li>
              Required monthly savings:{' '}
              {result.requiredMonthlyContributionCents != null
                ? dollars(result.requiredMonthlyContributionCents)
                : `${dollars(result.immediateLumpSumNeededCents ?? 0)} needed now (no time left to save monthly)`}
            </li>
            <li>
              One-third rule — savings: {dollars(result.oneThirdRule.savingsThirdCents)}, income during
              school: {dollars(result.oneThirdRule.incomeThirdCents)}, loans: {dollars(result.oneThirdRule.loansThirdCents)}
            </li>
            <li>On track for two-thirds (savings + income)? {result.oneThirdRule.onTrackForTwoThirds ? 'Yes' : 'No'}</li>
          </ul>
        </div>
      )}
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function PlannersPage() {
  const [tab, setTab] = useState<Tab>('safe-to-spend');

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-1 text-xl font-semibold">Goal Planners</h1>
      <p className="mb-4 text-sm text-gray-600">
        Informational insights based on your own data — not personalized financial advice. You
        can also ask the Advisor chat questions like &quot;can I afford this car?&quot; or
        &quot;am I on track for college?&quot; and it will call the same calculations.
      </p>
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'safe-to-spend' && <SafeToSpendPanel />}
      {tab === 'car' && <CarAffordabilityPanel />}
      {tab === 'college' && <CollegePlannerPanel />}
    </div>
  );
}
