'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Category {
  id: string;
  name: string;
  icon: string | null;
  parentId: string | null;
}

interface CategoryGroup {
  id: string;
  name: string;
  icon: string | null;
  children: Category[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  categoryGroups: CategoryGroup[];
  className?: string;
}

export function CategorySelect({ value, onChange, categoryGroups, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allOptions = [
    { id: '', label: 'Uncategorized', group: null as string | null },
    ...categoryGroups.flatMap((g) =>
      g.children.length > 0
        ? g.children.map((c) => ({
            id: c.id,
            label: `${c.icon ?? ''} ${c.name}`.trim(),
            group: `${g.icon ?? ''} ${g.name}`.trim(),
          }))
        : [{ id: g.id, label: `${g.icon ?? ''} ${g.name}`.trim(), group: null as string | null }],
    ),
  ];

  const q = search.toLowerCase();
  const filtered = q
    ? allOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.group?.toLowerCase().includes(q) ?? false),
      )
    : allOptions;

  const selectedLabel =
    value === ''
      ? 'Uncategorized'
      : allOptions.find((o) => o.id === value)?.label ?? 'Uncategorized';

  const select = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus search input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Group filtered options by group header
  const grouped = filtered.reduce<{ group: string | null; items: typeof filtered }[]>(
    (acc, opt) => {
      const last = acc[acc.length - 1];
      if (last && last.group === opt.group) {
        last.items.push(opt);
      } else {
        acc.push({ group: opt.group, items: [opt] });
      }
      return acc;
    },
    [],
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-1 text-xs font-medium hover:border-[var(--primary)] transition-colors text-left"
      >
        <span className="truncate">{selectedLabel}</span>
        <svg className="h-3 w-3 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-container)] shadow-xl">
          {/* Search input */}
          <div className="border-b border-[var(--border)] px-2 py-1.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories..."
              className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No categories found</p>
            )}
            {grouped.map((section, si) => (
              <div key={si}>
                {section.group && (
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {section.group}
                  </p>
                )}
                {section.items.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => select(opt.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-[var(--accent)] ${
                      opt.id === value
                        ? 'bg-[var(--primary)]/10 font-semibold text-[var(--primary)]'
                        : ''
                    } ${section.group ? 'pl-5' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
