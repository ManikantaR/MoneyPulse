'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/** Props for the spending trend area chart. */
interface SpendingTrendLineProps {
  data: Array<{ period: string; income: number; expenses: number }>;
}

/** Filled area chart showing income and expense trends over time. */
export function SpendingTrendLine({ data }: SpendingTrendLineProps) {
  /** Convert cents to dollars for display. */
  const formatted = data.map((d) => ({
    period: d.period,
    Income: d.income / 100,
    Expenses: d.expenses / 100,
  }));

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">
        Spending Trend
      </h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">Income vs expenses over time</p>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, undefined]}
          />
          <Area
            type="monotone"
            dataKey="Income"
            stroke="hsl(var(--chart-1))"
            fill="url(#incomeGradient)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="Expenses"
            stroke="hsl(var(--chart-5))"
            fill="url(#expenseGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
