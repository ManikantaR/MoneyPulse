'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface StatementSchedule {
  id: string;
  accountId: string;
  cadence: 'monthly' | 'weekly' | 'biweekly' | 'custom';
  expectedDayOfMonth: number | null;
  cadenceDays: number | null;
  graceDays: number;
  lastSatisfiedAt: string | null;
  snoozedUntil: string | null;
  source: 'learned' | 'manual';
  enabled: boolean;
}

/** Import Pipeline Radar Phase 4 schedule, surfaced in the Phase 3 coverage grid editor. */
export function useStatementSchedule(accountId: string | null) {
  return useQuery({
    queryKey: ['statement-schedule', accountId],
    queryFn: () => api.get<{ data: StatementSchedule | null }>(`/accounts/${accountId}/statement-schedule`),
    enabled: !!accountId,
  });
}

export function useUpsertStatementSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      ...body
    }: {
      accountId: string;
      cadence: StatementSchedule['cadence'];
      expectedDayOfMonth?: number | null;
      cadenceDays?: number | null;
      graceDays?: number;
      enabled?: boolean;
    }) => api.put<{ data: StatementSchedule }>(`/accounts/${accountId}/statement-schedule`, body),
    onSuccess: (_data, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: ['statement-schedule', accountId] });
      queryClient.invalidateQueries({ queryKey: ['ingestion', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ingestion', 'pipeline-summary'] });
    },
  });
}

export function useSnoozeStatementSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, days }: { accountId: string; days: number }) =>
      api.post<{ data: StatementSchedule }>(`/accounts/${accountId}/statement-schedule/snooze`, { days }),
    onSuccess: (_data, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: ['statement-schedule', accountId] });
      queryClient.invalidateQueries({ queryKey: ['ingestion', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ingestion', 'pipeline-summary'] });
    },
  });
}
