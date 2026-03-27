import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** Props for the StatCard summary widget. */
interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
}

/** KPI summary card displayed at the top of the dashboard. */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            {title}
          </p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className="rounded-lg bg-[var(--accent)] p-2.5">
            <Icon className="h-5 w-5 text-[var(--primary)]" />
          </div>
        )}
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          <span
            className={cn(
              'font-semibold',
              trend.value >= 0 ? 'text-emerald-500' : 'text-red-500',
            )}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value.toFixed(1)}%
          </span>
          <span className="text-[var(--muted-foreground)]">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
