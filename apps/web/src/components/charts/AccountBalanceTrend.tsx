'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { BalanceHistoryPoint } from '../../lib/hooks/useAnalytics';

interface AccountBalanceTrendProps {
  data: BalanceHistoryPoint[];
}

/** Format a YYYY-MM-DD date string as a short month label (e.g. "Jan 25"). */
function formatDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Line chart showing net account balance over time from stored snapshots. */
export function AccountBalanceTrend({ data }: AccountBalanceTrendProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
        <h3 className="mb-1 text-xl font-bold tracking-tight">Balance Trend</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          No snapshot data yet. Snapshots build up after daily imports.
        </p>
      </div>
    );
  }

  const formatted = data.map((d) => ({
    date: d.date,
    label: formatDate(d.date),
    balance: d.balanceCents / 100,
  }));

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">Balance Trend</h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">
        Net account balance over time
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
            width={70}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, 'Balance']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="balance"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
