'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { RecurringBill, UpdateBillInput } from '@moneypulse/shared';

/** Fetch all recurring bills for the current user. */
export function useBills() {
  return useQuery({
    queryKey: ['bills'],
    queryFn: () => api.get<{ data: RecurringBill[] }>('/bills'),
  });
}

/** Fetch bills due within the next 7 days (for dashboard widget). */
export function useUpcomingBills() {
  return useQuery({
    queryKey: ['bills', 'upcoming'],
    queryFn: () => api.get<{ data: RecurringBill[] }>('/bills/upcoming'),
  });
}

/** Run recurring bill detection from transaction history. */
export function useDetectBills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ data: { detected: number; newBills: number; existingSkipped: number } }>(
        '/bills/detect',
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}

/** Check for missed/overdue bills and send notifications. */
export function useCheckMissedBills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ data: { missedCount: number; notified: number } }>(
        '/bills/check-missed',
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Confirm a detected bill to enable overdue alerts. */
export function useConfirmBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ data: RecurringBill }>(`/bills/${id}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}

/** Deactivate a recurring bill (soft disable). */
export function useDeactivateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ data: RecurringBill }>(`/bills/${id}/deactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}

/** Update recurring bill details. */
export function useUpdateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateBillInput & { id: string }) =>
      api.patch<{ data: RecurringBill }>(`/bills/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}

/** Delete a recurring bill. */
export function useDeleteBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/bills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}
