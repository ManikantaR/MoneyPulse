'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type QueryParams } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncStatusCounts {
  pending: number;
  retry: number;
  delivered: number;
  dead_letter: number;
  policy_failed: number;
}

export interface SyncStatus {
  health: 'green' | 'yellow' | 'red';
  counts: SyncStatusCounts;
  pendingTotal: number;
  lastDeliveredAt: string | null;
  lastErrorMessage: string | null;
  config: {
    firebaseEndpointSet: boolean;
    aliasSecretSet: boolean;
    signingSecretSet: boolean;
  };
}

export interface OutboxEvent {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  user_id: string;
  status: 'pending' | 'retry' | 'delivered' | 'dead_letter' | 'policy_failed';
  attempts: number;
  created_at: string;
  delivered_at: string | null;
  last_error_message: string | null;
  last_error_code: string | null;
}

export interface SyncEventsResponse {
  data: OutboxEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BackfillInput {
  fromDate?: string;
  toDate?: string;
  accountId?: string;
  force?: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Poll pipeline health every 10 seconds. */
export function useSyncStatus() {
  return useQuery({
    queryKey: ['sync', 'status'],
    queryFn: () => api.get<{ data: SyncStatus }>('/sync/status'),
    refetchInterval: 10_000,
  });
}

/** Paginated outbox event list with optional filters. */
export function useSyncEvents(params?: {
  status?: OutboxEvent['status'];
  eventType?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['sync', 'events', params],
    queryFn: () =>
      api.get<SyncEventsResponse>('/sync/events', {
        params: {
          status: params?.status,
          eventType: params?.eventType,
          page: params?.page,
          limit: params?.limit,
        } as QueryParams,
      }),
  });
}

/** Manually trigger a delivery sweep. */
export function useTriggerSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ data: { processed: number } }>('/sync/trigger'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

/** Backfill historical transactions to the outbox. */
export function useBackfillSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BackfillInput) =>
      api.post<{ data: { enqueued: number; skipped: number; errors: number } }>('/sync/backfill', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

/** Backfill all categories to the outbox. */
export function useBackfillCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ data: { enqueued: number; errors: number } }>('/sync/backfill-categories'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

/** Reset dead-lettered events back to pending. */
export function useReplayDeadLetters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventIds?: string[]) =>
      api.post<{ data: { replayed: number } }>('/sync/replay', { eventIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}
