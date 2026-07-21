'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  PaycheckProfile,
  CreatePaycheckProfileInput,
  UpdatePaycheckProfileInput,
} from '@moneypulse/shared';

/** List paycheck profiles for the current user, most recent effective date first. */
export function usePaycheckProfiles() {
  return useQuery({
    queryKey: ['paycheck-profiles'],
    queryFn: () => api.get<{ data: PaycheckProfile[] }>('/paycheck-profiles'),
  });
}

/** Create a new effective-dated paycheck profile. */
export function useCreatePaycheckProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePaycheckProfileInput) =>
      api.post<{ data: PaycheckProfile }>('/paycheck-profiles', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paycheck-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'budget-plan'] });
    },
  });
}

/** Update (correct) an existing paycheck profile. */
export function useUpdatePaycheckProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePaycheckProfileInput & { id: string }) =>
      api.patch<{ data: PaycheckProfile }>(`/paycheck-profiles/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paycheck-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'budget-plan'] });
    },
  });
}

/** Soft-delete a paycheck profile. */
export function useDeletePaycheckProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/paycheck-profiles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paycheck-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'budget-plan'] });
    },
  });
}
