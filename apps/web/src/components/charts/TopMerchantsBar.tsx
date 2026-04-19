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
  onMerchantClick?: (merchantName: string) => void;
}

/** Truncate text to maxLen characters with ellipsis. */
function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/** Horizontal bar chart ranking merchants by total spend (sorted highest first). */
export function TopMerchantsBar({ data, onMerchantClick }: TopMerchantsBarProps) {
  const formatted = [...data]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((d) => ({
      merchant: d.merchantName || 'Unknown',
      label: truncate(d.merchantName || 'Unknown', 22),
      total: d.totalCents / 100,
      count: d.transactionCount,
    }));

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">
        Top Merchants
      </h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">Click a bar to view transactions</p>
      {formatted.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No merchant data</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, formatted.length * 44)}>
          <BarChart
            data={formatted}
            layout="vertical"
            barSize={18}
            margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
            onClick={(state) => {
              const payload = (state as Record<string, unknown>)?.activePayload as Array<{ payload: { merchant: string } }> | undefined;
              if (payload?.[0]?.payload?.merchant && onMerchantClick) {
                onMerchantClick(payload[0].payload.merchant);
              }
            }}
            style={{ cursor: onMerchantClick ? 'pointer' : undefined }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={160}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.merchant ?? _label}
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
