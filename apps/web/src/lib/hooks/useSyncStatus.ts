'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface SyncAuditLog {
  id: number;
  outboxEventId: string;
  action: string;
  policyPassed: boolean;
  attemptNo: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface PolicyFailure {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  policyReason: string | null;
  attempts: number;
  updatedAt: string;
}

export interface PolicyFailureReason {
  reason: string;
  count: number;
}

export interface SyncStats {
  pending: number;
  retry: number;
  delivered: number;
  policyFailed: number;
  deadLetter: number;
  lastDeliveredAt: string | null;
  recentAuditLogs: SyncAuditLog[];
  policyFailures: PolicyFailure[];
  policyFailureReasons: PolicyFailureReason[];
}

export interface BackfillResult {
  enqueued: number;
  skipped: number;
  categoriesEnqueued: number;
  categoriesSkipped: number;
  budgetsEnqueued: number;
  budgetsSkipped: number;
  durationMs: number;
}

export function useSyncStats() {
  return useQuery({
    queryKey: ['sync', 'stats'],
    queryFn: () => api.get<SyncStats>('/sync/stats'),
    refetchInterval: 30_000,
  });
}

export interface BackfillParams {
  userId: string;
  batchSize?: number;
}

export function useSyncBackfill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, batchSize }: BackfillParams) =>
      api.post<BackfillResult>('/sync/backfill', { userId, batchSize }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'stats'] });
    },
  });
}

export interface LinkStatus {
  linked: boolean;
  firebaseUid: string | null;
}

export function useLinkStatus() {
  return useQuery({
    queryKey: ['sync', 'link-status'],
    queryFn: () => api.get<LinkStatus>('/sync/link-status'),
    staleTime: 60_000,
  });
}

export function useSyncForceResync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ reset: number; durationMs: number }>('/sync/force-resync', { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'stats'] });
    },
  });
}

export function useLinkFirebase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (firebaseUid: string) =>
      api.post<LinkStatus>('/sync/link-firebase', { firebaseUid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'link-status'] });
    },
  });
}
