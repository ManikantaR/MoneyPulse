'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Loan, CreateLoanInput, UpdateLoanInput } from '@moneypulse/shared';

/** Fetch all tracked loans for the current user. */
export function useLoans() {
  return useQuery({
    queryKey: ['loans'],
    queryFn: () => api.get<{ data: Loan[] }>('/loans'),
  });
}

/** Create a new tracked loan. */
export function useCreateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLoanInput) => api.post<{ data: Loan }>('/loans', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

/** Update a tracked loan. */
export function useUpdateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateLoanInput & { id: string }) =>
      api.patch<{ data: Loan }>(`/loans/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

/** Delete (soft) a tracked loan. */
export function useDeleteLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/loans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}
