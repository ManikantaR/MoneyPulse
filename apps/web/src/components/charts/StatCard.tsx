import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** Props for the StatCard summary widget. */
interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  accentColor?: 'primary' | 'secondary' | 'tertiary';
  className?: string;
}

/** KPI summary card displayed at the top of the dashboard. */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'primary',
  className,
}: StatCardProps) {
  const accentStyles = {
    primary: 'from-[var(--primary)]/50 text-[var(--primary)]',
    secondary: 'from-[var(--secondary)]/50 text-[var(--secondary)]',
    tertiary: 'from-[var(--destructive)]/50 text-[var(--destructive)]',
  };

  const badgeStyles = {
    primary: 'text-[var(--primary)] bg-[var(--accent)]',
    secondary: 'text-[var(--secondary)] bg-[var(--secondary)]/10',
    tertiary: 'text-[var(--destructive)] bg-[var(--destructive)]/10',
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-[var(--surface-container-low)] p-6 transition-shadow hover:shadow-md',
        className,
      )}
    >
      {/* Icon + trend badge row */}
      <div className="mb-4 flex items-start justify-between">
        {Icon && (
          <Icon className={cn('h-5 w-5 opacity-80', accentStyles[accentColor])} />
        )}
        {trend && (
          <span
            className={cn(
              'rounded px-2 py-1 text-xs font-bold',
              badgeStyles[accentColor],
            )}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Label + value */}
      <p className="mb-1 text-sm font-medium text-[var(--muted-foreground)]">
        {title}
      </p>
      <p className="text-3xl font-extrabold tracking-tight">{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{subtitle}</p>
      )}

      {/* Bottom accent bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r to-transparent',
          accentStyles[accentColor],
        )}
      />
    </div>
  );
}
