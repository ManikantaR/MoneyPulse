'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface SyncAuditLog {
  id: number;
  outbox_event_id: string;
  action: string;
  policy_passed: boolean;
  policy_reason: string | null;
  attempt_no: number | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SyncStats {
  pending: number;
  retry: number;
  delivered: number;
  policyFailed: number;
  deadLetter: number;
  lastDeliveredAt: string | null;
  recentAuditLogs: SyncAuditLog[];
}

export interface BackfillResult {
  enqueued: number;
  skipped: number;
  durationMs: number;
}

export function useSyncStats() {
  return useQuery({
    queryKey: ['sync', 'stats'],
    queryFn: () => api.get<SyncStats>('/sync/stats'),
    refetchInterval: 30_000,
  });
}

export function useSyncBackfill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<BackfillResult>('/sync/backfill', { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'stats'] });
    },
  });
}
