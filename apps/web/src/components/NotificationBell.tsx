'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllRead,
  useDismissNotification,
} from '@/lib/hooks/useNotifications';

/** Types whose alerts warrant a warning/destructive accent. */
const DESTRUCTIVE_TYPES = new Set([
  'large_debit',
  'spending_anomaly',
  'over_budget',
  'cashflow_low',
]);
const SUCCESS_TYPES = new Set(['savings_milestone', 'savings']);

/** CSS var for a notification's severity accent, derived from its type. */
function accentVar(type: string): string {
  if (DESTRUCTIVE_TYPES.has(type)) return 'var(--destructive)';
  if (SUCCESS_TYPES.has(type)) return 'var(--success)';
  return 'var(--primary)';
}

/** "2 hours ago" — tolerant of missing/invalid timestamps. */
function relativeTime(createdAt?: string): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true });
}

function NotificationRow({
  n,
  onRead,
  onDismiss,
}: {
  n: any;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <li
      className={`group relative flex items-start gap-2 p-3 border-l-2 hover:bg-[var(--muted)]/50 ${
        n.isRead ? '' : 'bg-[var(--primary)]/5'
      }`}
      style={{ borderLeftColor: n.isRead ? 'transparent' : accentVar(n.type) }}
    >
      <button
        type="button"
        onClick={() => !n.isRead && onRead(n.id)}
        className="flex-1 text-left cursor-pointer min-w-0"
      >
        <div className="flex items-center gap-2">
          {!n.isRead && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: accentVar(n.type) }}
              aria-hidden
            />
          )}
          <p className="text-sm font-medium truncate">{n.title}</p>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
          {n.message}
        </p>
        {relativeTime(n.createdAt) && (
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            {relativeTime(n.createdAt)}
          </p>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDismiss(n.id)}
        aria-label="Dismiss notification"
        className="shrink-0 p-1 rounded text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 hover:bg-[var(--muted)] transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: notificationsResponse, isLoading, isError } = useNotifications();
  const { count: unread } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();
  const dismiss = useDismissNotification();

  const notifications = notificationsResponse?.data ?? [];
  const shown = notifications.slice(0, 20);
  const unreadItems = shown.filter((n: any) => !n.isRead);
  const readItems = shown.filter((n: any) => n.isRead);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Toggle notifications"
        className="relative p-2 rounded-full hover:bg-accent transition-colors"
      >
        <Bell className="w-5 h-5" />
        {!!unread && unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed top-[4.5rem] left-2 right-2 w-auto max-w-none sm:absolute sm:top-auto sm:left-auto sm:right-0 sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-2rem)] bg-[var(--card)] text-[var(--card-foreground)] border border-[var(--border)] rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="p-3 border-b border-[var(--border)] flex items-center justify-between sticky top-0 bg-[var(--card)]">
            <h3 className="font-medium text-sm">Notifications</h3>
            {!!unread && unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="p-3 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5 animate-pulse">
                  <div className="h-3 w-1/2 rounded bg-[var(--muted)]" />
                  <div className="h-2.5 w-3/4 rounded bg-[var(--muted)]" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <p className="p-4 text-sm text-[var(--destructive)]">
              Couldn&apos;t load notifications. Try again shortly.
            </p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted-foreground)]">
              You&apos;re all caught up — no notifications.
            </p>
          ) : (
            <>
              {unreadItems.length > 0 && (
                <ul className="divide-y divide-[var(--border)]">
                  {unreadItems.map((n: any) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      onRead={(id) => markRead.mutate(id)}
                      onDismiss={(id) => dismiss.mutate(id)}
                    />
                  ))}
                </ul>
              )}
              {readItems.length > 0 && (
                <>
                  <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Earlier
                  </p>
                  <ul className="divide-y divide-[var(--border)]">
                    {readItems.map((n: any) => (
                      <NotificationRow
                        key={n.id}
                        n={n}
                        onRead={(id) => markRead.mutate(id)}
                        onDismiss={(id) => dismiss.mutate(id)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
