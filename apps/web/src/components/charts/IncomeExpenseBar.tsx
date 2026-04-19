'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/** Props for the income vs. expense bar chart. */
interface IncomeExpenseBarProps {
  data: Array<{ period: string; income: number; expenses: number }>;
  onBarClick?: (period: string) => void;
}

/** Clustered bar chart showing income vs expenses over time. */
export function IncomeExpenseBar({ data, onBarClick }: IncomeExpenseBarProps) {
  /** Convert cents to dollar values for display. */
  const formatted = data.map((d) => ({
    period: d.period,
    Income: d.income / 100,
    Expenses: d.expenses / 100,
  }));

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">
        Income vs Expenses
      </h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">Click a month to drill down</p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={formatted}
          barGap={4}
          onClick={(state) => {
            if (state?.activeLabel && onBarClick) {
              onBarClick(String(state.activeLabel));
            }
          }}
          style={{ cursor: onBarClick ? 'pointer' : undefined }}
        >
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
          <Legend />
          <Bar dataKey="Income" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Expenses" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
