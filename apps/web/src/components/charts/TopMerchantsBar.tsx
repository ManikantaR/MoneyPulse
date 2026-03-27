'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/** Top merchant data row. */
interface TopMerchantData {
  merchantName: string;
  totalCents: number;
  transactionCount: number;
}

/** Props for the top merchants horizontal bar chart. */
interface TopMerchantsBarProps {
  data: TopMerchantData[];
}

/** Horizontal bar chart ranking merchants by total spend. */
export function TopMerchantsBar({ data }: TopMerchantsBarProps) {
  const formatted = data.map((d) => ({
    merchant: d.merchantName || 'Unknown',
    total: d.totalCents / 100,
    count: d.transactionCount,
  }));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
        Top Merchants
      </h3>
      {formatted.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No merchant data</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, formatted.length * 40)}>
          <BarChart data={formatted} layout="vertical" barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
            />
            <YAxis
              type="category"
              dataKey="merchant"
              width={130}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(v, _name, props) => [
                `$${Number(v ?? 0).toLocaleString()} (${(props as any)?.payload?.count ?? 0} txns)`,
                'Total',
              ]}
            />
            <Bar dataKey="total" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
