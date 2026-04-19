'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCents } from '@/lib/format';

/** Single slice of the category donut chart. */
interface CategorySlice {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon?: string;
  totalCents: number;
  percentage: number;
}

/** Props for the category donut chart. */
interface CategoryDonutProps {
  data: CategorySlice[];
  onCategoryClick?: (categoryId: string, categoryName: string) => void;
}

/** Donut chart showing spending breakdown by category. */
export function CategoryDonut({ data, onCategoryClick }: CategoryDonutProps) {
  const total = data.reduce((sum, d) => sum + d.totalCents, 0);

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">
        Spending by Category
      </h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">Click a slice to drill down</p>
      <div className="flex items-center gap-6">
        {/* Donut */}
        <div className="h-[200px] w-[200px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="totalCents"
                nameKey="categoryName"
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="85%"
                paddingAngle={2}
                strokeWidth={0}
                onClick={(_, index) => {
                  const entry = data[index];
                  if (entry && onCategoryClick) {
                    onCategoryClick(entry.categoryId, entry.categoryName);
                  }
                }}
                style={{ cursor: onCategoryClick ? 'pointer' : undefined }}
              >
                {data.map((entry) => (
                  <Cell key={entry.categoryId} fill={entry.categoryColor} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value) => [formatCents(Number(value ?? 0)), undefined]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[200px]">
          {data.slice(0, 8).map((entry) => (
            <button
              key={entry.categoryId}
              onClick={() => onCategoryClick?.(entry.categoryId, entry.categoryName)}
              className="flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-[var(--muted)]"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: entry.categoryColor }}
              />
              <span className="text-[var(--muted-foreground)] truncate max-w-[100px]">
                {entry.categoryIcon && <span className="mr-1">{entry.categoryIcon}</span>}
                {entry.categoryName}
              </span>
              <span className="ml-auto font-medium tabular-nums">
                {entry.percentage.toFixed(0)}%
              </span>
            </button>
          ))}
          {data.length > 8 && (
            <span className="text-xs text-[var(--muted-foreground)]">
              +{data.length - 8} more
            </span>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
        Total: {formatCents(total)}
      </p>
    </div>
  );
}
