'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type QueryParamValue } from '../api';
import type {
  Transaction,
  UpdateTransactionInput,
  BulkCategorizeInput,
  CreateTransactionInput,
} from '@moneypulse/shared';

/** Paginated response shape for transaction queries. */
export interface PaginatedTransactions {
  data: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Query parameters for the transactions list endpoint. */
export interface TransactionQueryParams {
  [key: string]: QueryParamValue;
  page?: number;
  pageSize?: number;
  search?: string;
  accountId?: string;
  categoryId?: string;
  uploadId?: string;
  from?: string;
  to?: string;
  sortBy?: 'date' | 'amount' | 'description' | 'category';
  sortOrder?: 'asc' | 'desc';
}

/** Fetch paginated, filtered, sortable transactions. */
export function useTransactions(params: TransactionQueryParams = {}) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.get<PaginatedTransactions>('/transactions', { params }),
  });
}

/** Update a single transaction (category, description, tags). */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTransactionInput & { id: string }) =>
      api.patch<{ data: Transaction }>(`/transactions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

/** Create a manual transaction. */
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTransactionInput) =>
      api.post<{ data: Transaction }>('/transactions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

/** Bulk-categorize multiple transactions at once. */
export function useBulkCategorize() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCategorizeInput) =>
      api.post<{ data: { updated: number } }>(
        '/transactions/bulk-categorize',
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

/** Auto-categorize all uncategorized transactions via AI + rule engine. */
export function useAutoCategorize() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{
        data: {
          total: number;
          categorizedByRule: number;
          categorizedByAi: number;
          suggested: number;
          uncategorized: number;
        };
      }>('/transactions/auto-categorize', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
