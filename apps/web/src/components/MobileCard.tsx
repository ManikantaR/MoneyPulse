'use client';

import { cn } from '@/lib/utils';

export interface CardField {
  label?: string;
  value: React.ReactNode;
  /** Primary field — rendered in the card header, bold, larger text. */
  primary?: boolean;
  /** Amount field — rendered right-aligned in the card header. */
  amount?: boolean;
  /** If true, this field is omitted from the label/value grid. */
  headerOnly?: boolean;
  /** Apply text-[var(--secondary)] green for income or text-[var(--foreground)] default. */
  amountColor?: string;
}

interface MobileCardProps {
  fields: CardField[];
  onClick?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Reusable mobile card for replacing table rows on small screens.
 * Renders a header row (primary field + amount) followed by a label/value grid.
 * Use alongside `hidden md:block` on the desktop table wrapper and `md:hidden` on this list.
 */
export function MobileCard({ fields, onClick, actions, className }: MobileCardProps) {
  const primaryField = fields.find((f) => f.primary);
  const amountField = fields.find((f) => f.amount);
  const gridFields = fields.filter((f) => !f.primary && !f.amount && !f.headerOnly);

  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm',
        onClick && 'cursor-pointer active:bg-[var(--muted)]/40 transition-colors',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* Card header: primary field + amount */}
      {(primaryField || amountField) && (
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
          {primaryField && (
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--foreground)]">
              {primaryField.value}
            </p>
          )}
          {amountField && (
            <p
              className={cn(
                'shrink-0 text-sm font-extrabold tabular-nums',
                amountField.amountColor ?? 'text-[var(--foreground)]',
              )}
            >
              {amountField.value}
            </p>
          )}
        </div>
      )}

      {/* Label/value grid */}
      {gridFields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 pb-3 pt-1">
          {gridFields.map((field, i) => (
            <div key={i} className="min-w-0">
              {field.label && (
                <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                  {field.label}
                </dt>
              )}
              <dd className="mt-0.5 min-w-0 truncate text-xs text-[var(--foreground)]">
                {field.value ?? <span className="text-[var(--muted-foreground)]">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Actions row */}
      {actions && (
        <div
          className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
