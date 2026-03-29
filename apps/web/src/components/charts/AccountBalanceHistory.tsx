'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

/** Account balance row for the bar chart. */
interface AccountBalanceData {
  accountId: string;
  nickname: string;
  institution: string;
  accountType: string;
  balanceCents: number;
}

/** Props for the account balances bar chart. */
interface AccountBalanceHistoryProps {
  data: AccountBalanceData[];
}

/** Color map for different institution types. */
const institutionColors: Record<string, string> = {
  boa: 'hsl(var(--chart-1))',
  chase: 'hsl(var(--chart-3))',
  amex: 'hsl(var(--chart-2))',
  citi: 'hsl(var(--chart-4))',
  other: 'hsl(var(--chart-5))',
};

/** Horizontal bar chart showing current balance per account. */
export function AccountBalanceHistory({ data }: AccountBalanceHistoryProps) {
  const formatted = data.map((d) => ({
    ...d,
    balance: d.balanceCents / 100,
  }));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
        Account Balances
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 50)}>
        <BarChart data={formatted} layout="vertical" barSize={20}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            tickFormatter={(v) => `$${v.toLocaleString()}`}
          />
          <YAxis
            type="category"
            dataKey="nickname"
            width={120}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, 'Balance']}
          />
          <Bar dataKey="balance" radius={[0, 4, 4, 0]}>
            {formatted.map((entry, index) => (
              <Cell
                key={index}
                fill={institutionColors[entry.institution] || institutionColors.other}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
