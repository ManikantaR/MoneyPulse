'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import type { ForecastPoint } from '../../lib/hooks/useAnalytics';
import { formatCents } from '../../lib/format';

const LOW_BALANCE_THRESHOLD_CENTS = 100_000; // $1,000

interface CashFlowForecastChartProps {
  series: ForecastPoint[];
  lowBalanceDate?: string;
  title?: string;
}

/** Format YYYY-MM-DD as short label (e.g. "Jun 15"). */
function shortDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Line chart showing projected balance with danger-zone band below $1,000. */
export function CashFlowForecastChart({
  series,
  lowBalanceDate,
  title = 'Cash-Flow Forecast',
}: CashFlowForecastChartProps) {
  if (!series || series.length === 0) {
    return (
      <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
        <h3 className="mb-1 text-xl font-bold tracking-tight">{title}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">No forecast data available.</p>
      </div>
    );
  }

  const minBalance = Math.min(...series.map((p) => p.projectedCents));
  const maxBalance = Math.max(...series.map((p) => p.projectedCents));

  // Only show the danger zone band if balance can drop near the threshold
  const showDangerZone = minBalance < LOW_BALANCE_THRESHOLD_CENTS * 2;

  const formatted = series.map((p) => ({
    date: p.date,
    label: shortDate(p.date),
    balance: p.projectedCents / 100,
  }));

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <div className="mb-1 flex items-start justify-between">
        <h3 className="text-xl font-bold tracking-tight">{title}</h3>
        {lowBalanceDate && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Low by {shortDate(lowBalanceDate)}
          </span>
        )}
      </div>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">
        Dashed line = projected · $1,000 threshold shown
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />

          {/* Danger zone: red band below $1,000 */}
          {showDangerZone && (
            <ReferenceArea
              y1={minBalance / 100 < 0 ? minBalance / 100 : 0}
              y2={LOW_BALANCE_THRESHOLD_CENTS / 100}
              fill="hsl(0 84% 60% / 0.12)"
              ifOverflow="visible"
            />
          )}

          {/* $1,000 threshold line */}
          <ReferenceLine
            y={LOW_BALANCE_THRESHOLD_CENTS / 100}
            stroke="hsl(0 84% 60%)"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{ value: '$1k', position: 'insideTopRight', fontSize: 10, fill: 'hsl(0 84% 60%)' }}
          />

          {/* Low-balance date marker */}
          {lowBalanceDate && (
            <ReferenceLine
              x={shortDate(lowBalanceDate)}
              stroke="hsl(0 84% 60%)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
            />
          )}

          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
            width={70}
            domain={[
              Math.min(minBalance / 100 * 0.95, (LOW_BALANCE_THRESHOLD_CENTS / 100) * 0.5),
              maxBalance / 100 * 1.05,
            ]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(v) => [formatCents(Math.round(Number(v) * 100)), 'Projected']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="balance"
            stroke="hsl(var(--chart-2))"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
