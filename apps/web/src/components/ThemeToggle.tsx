'use client';

import { useTheme } from 'next-themes';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)] p-1">
      {THEMES.map((t) => (
        <button
          key={t.value}
          onClick={() => setTheme(t.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all
            ${
              theme === t.value
                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
