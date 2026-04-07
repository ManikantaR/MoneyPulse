'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Calendar, ChevronDown } from 'lucide-react';
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  subDays,
  format,
} from 'date-fns';

/** Predefined date range option. */
interface Preset {
  label: string;
  from: Date;
  to: Date;
}

/** Props for the PeriodSelector component. */
interface PeriodSelectorProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}

const presets: Preset[] = [
  {
    label: 'This Month',
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  },
  {
    label: 'Last Month',
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(subMonths(new Date(), 1)),
  },
  {
    label: 'Last 90 Days',
    from: subDays(new Date(), 90),
    to: new Date(),
  },
  {
    label: 'Year to Date',
    from: startOfYear(new Date()),
    to: new Date(),
  },
  {
    label: 'Last 12 Months',
    from: subMonths(new Date(), 12),
    to: new Date(),
  },
];

/** Date range selector with preset options and custom date inputs. */
export function PeriodSelector({
  from,
  to,
  onChange,
  className,
}: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);

  /** Format ISO date string for display. */
  const displayLabel = `${format(new Date(from + 'T00:00:00'), 'MMM d, yyyy')} — ${format(new Date(to + 'T00:00:00'), 'MMM d, yyyy')}`;

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <Calendar className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span>{displayLabel}</span>
        <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl">
          {/* Presets */}
          <div className="space-y-0.5">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  onChange(
                    format(preset.from, 'yyyy-MM-dd'),
                    format(preset.to, 'yyyy-MM-dd'),
                  );
                  setOpen(false);
                }}
                className="w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium hover:bg-[var(--muted)] transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-[var(--border)]" />

          {/* Custom range */}
          <div className="space-y-2">
            <label className="block px-1 text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Custom Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => onChange(e.target.value, to)}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-2 py-1.5 text-xs"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => onChange(from, e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-2 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
