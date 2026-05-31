'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  InvestmentAccount,
  InvestmentSnapshot,
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
  AddSnapshotInput,
} from '@moneypulse/shared';

const KEYS = {
  list: ['investments'] as const,
  snapshots: (id: string) => ['investments', id, 'snapshots'] as const,
};

/** List all investment accounts with latest snapshot value. */
export function useInvestments() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: () => api.get<{ data: InvestmentAccount[] }>('/investments'),
    select: (res) => res.data,
  });
}

/** Snapshot history for a single investment account. */
export function useInvestmentSnapshots(accountId: string) {
  return useQuery({
    queryKey: KEYS.snapshots(accountId),
    queryFn: () =>
      api.get<{ data: InvestmentSnapshot[] }>(`/investments/${accountId}/snapshots`),
    select: (res) => res.data,
    enabled: Boolean(accountId),
  });
}

/** Create a new investment account. */
export function useCreateInvestment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvestmentAccountInput) =>
      api.post<{ data: InvestmentAccount }>('/investments', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

/** Update an investment account. */
export function useUpdateInvestment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInvestmentAccountInput) =>
      api.patch<{ data: InvestmentAccount }>(`/investments/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

/** Soft-delete an investment account. */
export function useDeleteInvestment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ data: { deleted: boolean } }>(`/investments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

/** Record a value snapshot for an investment account. */
export function useAddSnapshot(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddSnapshotInput) =>
      api.post<{ data: InvestmentSnapshot }>(`/investments/${accountId}/snapshots`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.list });
      qc.invalidateQueries({ queryKey: KEYS.snapshots(accountId) });
      // Net worth depends on investment totals — invalidate analytics
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
