'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, TrendingUp, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { drawerItems } from '@/lib/nav-items';
import { useAuth } from '@/lib/auth';

interface MobileMoreDrawerProps {
  onClose: () => void;
}

export function MobileMoreDrawer({ onClose }: MobileMoreDrawerProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 md:hidden"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex flex-col rounded-t-2xl bg-[var(--card)] shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-label="More navigation"
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)]">
              <TrendingUp className="h-4 w-4" />
            </div>
            <span className="text-base font-extrabold text-[var(--primary)]">MoneyPulse</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav items grid */}
        <nav className="grid grid-cols-3 gap-2 px-4 py-2">
          {drawerItems.map((item) => {
            const isActive =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-medium transition-colors min-h-[44px] justify-center',
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
                )}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        {user && (
          <div className="mt-2 border-t border-[var(--border)] px-5 py-3 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-[var(--primary-foreground)]">
              {user.displayName?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.displayName}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{user.email}</p>
            </div>
            <button
              onClick={() => { logout(); onClose(); }}
              aria-label="Sign out"
              className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
