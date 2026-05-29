'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CategoryOption {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
}

interface CategoryGroup {
  id: string;
  name: string;
  icon: string;
  children: CategoryOption[];
}

interface CategoryComboboxProps {
  categories: CategoryOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Extra options prepended before categories (e.g. "All Categories", "Uncategorized"). */
  extraOptions?: { value: string; label: string }[];
  /** Size variant */
  size?: 'sm' | 'md';
}

export function CategoryCombobox({
  categories,
  value,
  onChange,
  placeholder = 'Select category...',
  className,
  extraOptions,
  size = 'md',
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build groups
  const groups = useMemo(() => {
    const parents = categories.filter((c) => !c.parentId);
    const childMap = new Map<string, CategoryOption[]>();
    for (const c of categories) {
      if (c.parentId) {
        const arr = childMap.get(c.parentId) ?? [];
        arr.push(c);
        childMap.set(c.parentId, arr);
      }
    }
    return parents.map((p) => ({
      ...p,
      children: childMap.get(p.id) ?? [],
    }));
  }, [categories]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const term = search.toLowerCase();
    const result: CategoryGroup[] = [];
    for (const g of groups) {
      const parentMatch = g.name.toLowerCase().includes(term);
      const matchingChildren = g.children.filter((c) =>
        c.name.toLowerCase().includes(term),
      );
      if (parentMatch) {
        result.push(g); // show parent + all children
      } else if (matchingChildren.length > 0) {
        result.push({ ...g, children: matchingChildren });
      }
    }
    return result;
  }, [groups, search]);

  // Resolve display label for current value
  const displayLabel = useMemo(() => {
    if (!value) return '';
    const extra = extraOptions?.find((o) => o.value === value);
    if (extra) return extra.label;
    const cat = categories.find((c) => c.id === value);
    return cat ? `${cat.icon} ${cat.name}` : '';
  }, [value, categories, extraOptions]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  function select(val: string) {
    onChange(val);
    setOpen(false);
    setSearch('');
  }

  const sizeClasses =
    size === 'sm'
      ? 'px-3 py-1 text-xs'
      : 'px-3 py-2.5 text-sm';

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={placeholder}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] font-medium transition-all',
          'hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30',
          sizeClasses,
          size === 'sm' && 'rounded-full bg-[var(--surface-container-low)]',
        )}
      >
        <span className={cn('truncate', !displayLabel && 'text-[var(--muted-foreground)]')}>
          {displayLabel || placeholder}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setSearch('');
                }
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div ref={listRef} role="listbox" className="max-h-[280px] overflow-y-auto p-1">
            {/* Extra options (All Categories, Uncategorized, etc.) */}
            {extraOptions && !search && extraOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => select(opt.value)}
                className={cn(
                  'flex w-full items-center rounded-lg px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors',
                  value === opt.value && 'bg-[var(--accent)] font-medium',
                )}
              >
                {opt.label}
              </button>
            ))}

            {extraOptions && !search && filtered.length > 0 && (
              <div className="my-1 border-t border-[var(--border)]" />
            )}

            {/* Grouped categories */}
            {filtered.map((g) => (
              <div key={g.id}>
                {g.children.length > 0 ? (
                  <>
                    {/* Parent as group header — also clickable */}
                    <button
                      type="button"
                      onClick={() => select(g.id)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors mt-1',
                        value === g.id && 'bg-[var(--accent)] text-[var(--foreground)]',
                      )}
                    >
                      <span>{g.icon}</span>
                      <span>{g.name}</span>
                    </button>
                    {g.children.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => select(c.id)}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 pl-7 text-sm hover:bg-[var(--muted)] transition-colors',
                          value === c.id && 'bg-[var(--accent)] font-medium',
                        )}
                      >
                        <span>{c.icon}</span>
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => select(g.id)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors',
                      value === g.id && 'bg-[var(--accent)] font-medium',
                    )}
                  >
                    <span>{g.icon}</span>
                    <span>{g.name}</span>
                  </button>
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">
                No categories match &ldquo;{search}&rdquo;
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
