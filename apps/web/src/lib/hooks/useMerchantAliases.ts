'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface MerchantAlias {
  id: string;
  userId: string | null;
  pattern: string;
  matchType: 'contains' | 'startsWith' | 'exact' | 'regex';
  displayName: string;
  createdAt: string;
}

export function useMerchantAliases() {
  return useQuery({
    queryKey: ['merchant-aliases'],
    queryFn: () => api.get<{ data: MerchantAlias[] }>('/merchant-aliases'),
  });
}

export function useCreateMerchantAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { pattern: string; matchType: string; displayName: string }) =>
      api.post<{ data: MerchantAlias }>('/merchant-aliases', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-aliases'] });
    },
  });
}

export function useUpdateMerchantAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; pattern?: string; matchType?: string; displayName?: string }) =>
      api.patch<{ data: MerchantAlias }>(`/merchant-aliases/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-aliases'] });
    },
  });
}

export function useDeleteMerchantAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/merchant-aliases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-aliases'] });
    },
  });
}
