'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  MonthlyFinancialSnapshot,
  PatchMonthlyCloseInput,
  ManualAsset,
  ManualAssetSnapshot,
  CreateManualAssetInput,
  UpdateManualAssetInput,
  PutManualAssetSnapshotInput,
  Loan,
  LoanBalanceSnapshot,
  PutLoanBalanceSnapshotInput,
} from '@moneypulse/shared';

const MONTHLY_CLOSE_KEY = ['monthly-close'];
const MANUAL_ASSETS_KEY = ['manual-assets'];

/** 6/12-month grid of monthly close snapshots, most recent first. */
export function useMonthlyCloses(months: 6 | 12) {
  return useQuery({
    queryKey: [...MONTHLY_CLOSE_KEY, months],
    queryFn: () =>
      api.get<{ data: MonthlyFinancialSnapshot[] }>('/monthly-close', { params: { months } }),
  });
}

/** One month's close (used after draft/confirm to refresh the active row). */
export function useMonthlyClose(month: string | null) {
  return useQuery({
    queryKey: [...MONTHLY_CLOSE_KEY, 'one', month],
    queryFn: () => api.get<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}`),
    enabled: !!month,
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: MONTHLY_CLOSE_KEY });
}

export function useCreateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) =>
      api.post<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}/draft`, {}),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRecalculate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) =>
      api.post<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}/recalculate`, {}),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function usePatchClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ month, ...body }: PatchMonthlyCloseInput & { month: string }) =>
      api.patch<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}`, body),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useConfirmClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) =>
      api.post<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}/confirm`, {}),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useReopenClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) =>
      api.post<{ data: MonthlyFinancialSnapshot }>(`/monthly-close/${month}/reopen`, {}),
    onSuccess: () => invalidateAll(queryClient),
  });
}

// ── Manual assets (home/car/gold) ───────────────────────────────

export function useManualAssets() {
  return useQuery({
    queryKey: MANUAL_ASSETS_KEY,
    queryFn: () => api.get<{ data: ManualAsset[] }>('/manual-assets'),
  });
}

export function useManualAssetSnapshots(assetId: string | null) {
  return useQuery({
    queryKey: [...MANUAL_ASSETS_KEY, assetId, 'snapshots'],
    queryFn: () =>
      api.get<{ data: ManualAssetSnapshot[] }>(`/manual-assets/${assetId}/snapshots`),
    enabled: !!assetId,
  });
}

export function useCreateManualAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateManualAssetInput) =>
      api.post<{ data: ManualAsset }>('/manual-assets', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MANUAL_ASSETS_KEY }),
  });
}

export function useUpdateManualAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateManualAssetInput & { id: string }) =>
      api.patch<{ data: ManualAsset }>(`/manual-assets/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MANUAL_ASSETS_KEY }),
  });
}

export function useUpsertManualAssetSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetId,
      month,
      ...body
    }: PutManualAssetSnapshotInput & { assetId: string; month: string }) =>
      api.put<{ data: ManualAssetSnapshot }>(
        `/manual-assets/${assetId}/snapshots/${month}`,
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANUAL_ASSETS_KEY });
      invalidateAll(queryClient);
    },
  });
}

// ── Loan verification (amortized vs manual statement balance) ───

export function useLoanBalanceSnapshots(loanId: string | null) {
  return useQuery({
    queryKey: ['loans', loanId, 'balance-snapshots'],
    queryFn: () =>
      api.get<{ data: LoanBalanceSnapshot[] }>(`/loans/${loanId}/balance-snapshots`),
    enabled: !!loanId,
  });
}

export function useUpsertLoanBalanceSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      loanId,
      month,
      ...body
    }: PutLoanBalanceSnapshotInput & { loanId: string; month: string }) =>
      api.put<{ data: LoanBalanceSnapshot }>(
        `/loans/${loanId}/balance-snapshots/${month}`,
        body,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['loans', variables.loanId, 'balance-snapshots'] });
      invalidateAll(queryClient);
    },
  });
}

export function useLoansForVerification() {
  return useQuery({
    queryKey: ['loans'],
    queryFn: () => api.get<{ data: Loan[] }>('/loans'),
  });
}
