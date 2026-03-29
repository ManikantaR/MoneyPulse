'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Notification } from '@moneypulse/shared';

/** Fetch all notifications for the current user (polls every 30s). */
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: Notification[] }>('/notifications'),
    refetchInterval: 30_000,
  });
}

/** Derive unread notification count from the notifications query. */
export function useUnreadCount() {
  const { data, ...rest } = useNotifications();
  const count = data?.data?.filter((n) => !n.isRead).length ?? 0;
  return { count, ...rest };
}

/** Mark a single notification as read. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<{ data: Notification }>(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Mark all notifications as read. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
