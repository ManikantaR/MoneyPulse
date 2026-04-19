'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllRead,
} from '@/lib/hooks/useNotifications';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: notificationsResponse } = useNotifications();
  const { count: unread } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const notifications = notificationsResponse?.data ?? [];

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
        <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium text-sm">Notifications</h3>
            {!!unread && unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {notifications.slice(0, 20).map((n: any) => (
              <div
                key={n.id}
                className={`p-3 cursor-pointer hover:bg-muted/50 ${!n.isRead ? 'bg-primary/5' : ''}`}
                onClick={() => {
                  if (!n.isRead) markRead.mutate(n.id);
                }}
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {n.message}
                </p>
              </div>
            ))}
            {notifications.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No notifications
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
