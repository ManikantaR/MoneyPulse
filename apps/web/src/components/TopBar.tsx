'use client';

import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/hooks/useNotifications';
import { ThemeToggle } from './ThemeToggle';

/** Top bar with user info, notification bell, theme toggle, and logout. */
export function TopBar() {
  const { user, logout } = useAuth();
  const { count: unreadCount } = useUnreadCount();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-6">
      <div />
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button
          className="relative rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
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

        {/* User */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-bold text-white">
            {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <span className="text-sm font-medium hidden sm:inline">
            {user?.displayName}
          </span>
        </div>

        {/* Logout */}
        <button
          onClick={() => logout()}
          className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          aria-label="Logout"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
