'use client';

import { Bell, LogOut, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/hooks/useNotifications';
import { ThemeToggle } from './ThemeToggle';

/** Top bar with search, notifications, theme toggle, user info, and logout. */
export function TopBar() {
  const { user, logout } = useAuth();
  const { count: unreadCount } = useUnreadCount();

  return (
    <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--card)]/80 px-6 backdrop-blur-xl shadow-sm">
      {/* Search */}
      <div className="relative hidden sm:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="text"
          placeholder="Search..."
          className="h-9 w-56 rounded-full border border-[var(--border)] bg-[var(--muted)] pl-9 pr-4 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
        />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Notifications */}
        <button
          className="relative rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--destructive)] text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <ThemeToggle />

        <div className="h-6 w-px bg-[var(--border)]" />

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-bold text-[var(--primary-foreground)] ring-2 ring-[var(--primary)]/20">
            {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-none">
              {user?.displayName}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--muted-foreground)]">
              {user?.role ?? 'Member'}
            </p>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={() => logout()}
          className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          aria-label="Logout"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
