'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: () => api.get<{ data: any[] }>('/budgets'),
    select: (res) => res.data,
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/budgets', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: any }) =>
      api.patch(`/budgets/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useSavingsGoals() {
  return useQuery({
    queryKey: ['savings-goals'],
    queryFn: () => api.get<{ data: any[] }>('/savings-goals'),
    select: (res) => res.data,
  });
}

export function useCreateSavingsGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/savings-goals', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings-goals'] }),
  });
}

export function useContributeSavingsGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) =>
      api.post(`/savings-goals/${id}/contribute`, { amountCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings-goals'] }),
  });
}

export function useDeleteSavingsGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/savings-goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings-goals'] }),
  });
}
